import { describe, expect, test } from 'vitest';
import { FakeRunner, type CommandResult } from '../src/exec.js';
import { observe } from '../src/observe.js';
import { planReconciliation, isReconciled } from '../src/reconcile.js';
import { applyPlan } from '../src/apply.js';
import { buildReport, formatReport } from '../src/doctor.js';
import { parseConfig, selectVariant } from '../src/config.js';
import type { Runner } from '../src/exec.js';

const config = (() => {
  const result = parseConfig({
    defaultVariant: 'development',
    variants: {
      development: {
        devClientPackage: 'com.example.app.development',
        reverses: [{ device: 8090, host: 80, label: 'backend' }],
      },
    },
  });
  if (!result.ok) throw new Error('fixture config is invalid');
  return result.config;
})();

const variant = selectVariant(config)!;
const env = { WSL_DISTRO_NAME: 'Ubuntu', REACT_NATIVE_PACKAGER_HOSTNAME: 'localhost' };

/**
 * A stateful fake of the whole machine.
 *
 * Commands mutate it the way the real ones would, so `up` genuinely changes the world the
 * next `observe` reads. That is what makes the idempotence assertion meaningful instead
 * of a tautology over a frozen script.
 */
class FakeMachine implements Runner {
  attached: boolean;
  serverUp = true;
  reverses = new Set<string>();
  packages = ['com.example.app.development'];
  readonly runner = new FakeRunner([]);

  constructor(options: { attached?: boolean } = {}) {
    this.attached = options.attached ?? false;
  }

  run(command: string, args: string[]): CommandResult {
    const line = [command, ...args].join(' ');
    this.runner.calls.push(line);

    if (line.startsWith('command -v')) return ok();

    if (line.includes('usbipd.exe state')) {
      return ok(
        JSON.stringify({
          Devices: [
            {
              BusId: '2-2',
              InstanceId: 'USB\\VID_2717&PID_FF88\\X',
              Description: 'Xiaomi Composite ADB Interface',
              ClientIPAddress: this.attached ? '172.20.0.1' : null,
              PersistedGuid: 'guid',
            },
          ],
        })
      );
    }
    if (line.includes('usbipd.exe bind')) return ok();
    if (line.includes('usbipd.exe attach')) {
      this.attached = true;
      return ok();
    }

    if (line.includes('adb devices')) {
      // A device is only visible over USB once usbipd handed it to WSL.
      return ok(this.attached ? 'List of devices attached\r\nPHONE\tdevice\r\n' : 'List of devices attached\r\n');
    }
    if (line.includes('start-server')) return this.serverUp ? ok() : fail();
    if (line.includes('kill-server')) {
      this.serverUp = true;
      return ok();
    }
    if (line.includes('reverse --list')) {
      return ok([...this.reverses].map((pair) => `PHONE tcp:${pair.replace('->', ' tcp:')}`).join('\n'));
    }
    if (line.includes('reverse tcp:')) {
      const match = /reverse tcp:(\d+) tcp:(\d+)/.exec(line);
      if (match) this.reverses.add(`${match[1]}->${match[2]}`);
      return ok();
    }
    if (line.includes('pm list packages')) {
      return ok(this.packages.map((name) => `package:${name}`).join('\n'));
    }

    return { code: 127, stdout: '', stderr: 'not found' };
  }
}

function ok(stdout = ''): CommandResult {
  return { code: 0, stdout, stderr: '' };
}
function fail(): CommandResult {
  return { code: 1, stdout: '', stderr: '' };
}

function cycle(machine: FakeMachine) {
  const observed = observe({ runner: machine, env, target: 'device', variant });
  const plan = planReconciliation(observed, {
    variant,
    target: 'device',
    packagerHostname: config.packagerHostname,
  });
  return { observed, plan };
}

describe('full reconcile loop', () => {
  test('a cold machine needs an attach and two reverses', () => {
    const { plan } = cycle(new FakeMachine());
    expect(plan.map((action) => action.kind)).toEqual([
      'usbipd-attach',
      'add-reverse',
      'add-reverse',
    ]);
  });

  test('up fixes everything it promised, and the machine really changed', () => {
    const machine = new FakeMachine();
    const first = cycle(machine);

    const outcome = applyPlan(first.plan, { runner: machine, serial: first.observed.selectedSerial });
    expect(outcome.failed).toEqual([]);
    expect(machine.attached).toBe(true);
    expect([...machine.reverses].sort()).toEqual(['8081->8081', '8090->80']);
  });

  test('IDEMPOTENCE: a second up has nothing left to do', () => {
    // The property the whole design rests on. Run it, look again, the plan must be empty.
    const machine = new FakeMachine();
    const first = cycle(machine);
    applyPlan(first.plan, { runner: machine, serial: first.observed.selectedSerial });

    const second = cycle(machine);
    expect(second.plan).toEqual([]);
    expect(isReconciled(second.plan)).toBe(true);
  });

  test('a third pass is still a no-op, so repeated runs never drift', () => {
    const machine = new FakeMachine();
    for (let round = 0; round < 3; round += 1) {
      const { observed, plan } = cycle(machine);
      applyPlan(plan, { runner: machine, serial: observed.selectedSerial });
    }
    expect(cycle(machine).plan).toEqual([]);
  });

  test('a replug detaches the phone and the next up silently repairs it', () => {
    // This is the daily reality the tool exists for: a USB reset drops the attachment.
    const machine = new FakeMachine();
    const first = cycle(machine);
    applyPlan(first.plan, { runner: machine, serial: first.observed.selectedSerial });
    expect(cycle(machine).plan).toEqual([]);

    machine.attached = false;
    machine.reverses.clear();

    const afterReplug = cycle(machine);
    expect(afterReplug.plan.map((a) => a.kind)).toContain('usbipd-attach');

    applyPlan(afterReplug.plan, { runner: machine, serial: afterReplug.observed.selectedSerial });
    expect(cycle(machine).plan).toEqual([]);
  });

  test('doctor exits non-zero before up and zero after, without changing anything itself', () => {
    const machine = new FakeMachine();
    const before = cycle(machine);
    const beforeReport = buildReport(before.observed, before.plan);
    expect(beforeReport.exitCode).toBe(1);
    // doctor must not have attached anything as a side effect of looking.
    expect(machine.attached).toBe(false);

    applyPlan(before.plan, { runner: machine, serial: before.observed.selectedSerial });

    const after = cycle(machine);
    const afterReport = buildReport(after.observed, after.plan);
    expect(afterReport.exitCode).toBe(0);
    expect(formatReport(afterReport)).toContain('Everything is reconciled');
  });

  test('a dead adb server is restarted and then stays reconciled', () => {
    const machine = new FakeMachine({ attached: true });
    machine.serverUp = false;

    const first = cycle(machine);
    expect(first.plan.map((a) => a.kind)).toContain('start-adb-server');

    applyPlan(first.plan, { runner: machine, serial: first.observed.selectedSerial });
    expect(cycle(machine).plan).toEqual([]);
  });

  test('a missing dev client is reported but never blocks the automatic repairs', () => {
    const machine = new FakeMachine({ attached: true });
    machine.packages = ['com.something.else'];

    const { observed, plan } = cycle(machine);
    const outcome = applyPlan(plan, { runner: machine, serial: observed.selectedSerial });

    expect(outcome.failed).toEqual([]);
    expect(outcome.skipped.map((a) => a.kind)).toContain('install-dev-client');
    expect([...machine.reverses].sort()).toEqual(['8081->8081', '8090->80']);
  });

  test('a bad packager hostname is surfaced but left for dev to fix', () => {
    const machine = new FakeMachine({ attached: true });
    const observed = observe({
      runner: machine,
      env: { WSL_DISTRO_NAME: 'Ubuntu', REACT_NATIVE_PACKAGER_HOSTNAME: '172.18.0.1' },
      target: 'device',
      variant,
    });
    const plan = planReconciliation(observed, {
      variant,
      target: 'device',
      packagerHostname: 'localhost',
    });

    const hostnameAction = plan.find((a) => a.kind === 'set-packager-hostname');
    expect(hostnameAction).toBeDefined();

    const outcome = applyPlan(plan, { runner: machine, serial: observed.selectedSerial });
    expect(outcome.skipped).toContain(hostnameAction);
    expect(outcome.failed).toEqual([]);
  });
});
