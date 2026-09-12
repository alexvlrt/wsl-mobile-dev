import { describe, expect, test } from 'vitest';
import { FakeRunner, type ScriptedCall } from '../src/exec.js';
import { observe } from '../src/observe.js';
import type { VariantConfig } from '../src/types.js';

const variant: VariantConfig = {
  devClientPackage: 'com.example.app.development',
  reverses: [{ device: 8081, host: 8081 }],
};

const wslEnv = { WSL_DISTRO_NAME: 'Ubuntu' };

const healthyScript: ScriptedCall[] = [
  { match: 'command -v', result: { code: 0 } },
  {
    match: 'usbipd.exe state',
    result: {
      stdout: JSON.stringify({
        Devices: [
          {
            BusId: '2-2',
            InstanceId: 'USB\\VID_2717&PID_FF88\\X',
            Description: 'Xiaomi Composite ADB Interface',
            ClientIPAddress: '172.20.0.1',
          },
        ],
      }),
    },
  },
  { match: 'adb devices', result: { stdout: 'List of devices attached\r\nPHONE\tdevice\r\n' } },
  { match: 'start-server', result: { code: 0 } },
  { match: 'reverse --list', result: { stdout: 'PHONE tcp:8081 tcp:8081\n' } },
  { match: 'pm list packages', result: { stdout: 'package:com.example.app.development\n' } },
];

describe('observe', () => {
  test('reads a healthy world without changing anything', () => {
    const runner = new FakeRunner(healthyScript);
    const state = observe({ runner, env: wslEnv, target: 'device', variant });

    expect(state.isWsl).toBe(true);
    expect(state.missingTools).toEqual([]);
    expect(state.usbipd.attached).toBe(true);
    expect(state.selectedSerial).toBe('PHONE');
    expect(state.reverses).toEqual([{ device: 8081, host: 8081 }]);
    expect(state.devClientInstalled).toBe(true);
  });

  test('never runs a mutating adb command while observing', () => {
    const runner = new FakeRunner(healthyScript);
    observe({ runner, env: wslEnv, target: 'device', variant });
    expect(runner.calls.some((call) => /reverse tcp:|install|kill-server|attach/.test(call))).toBe(false);
  });

  test('does not consult usbipd at all for the emulator target', () => {
    const runner = new FakeRunner(healthyScript);
    observe({ runner, env: wslEnv, target: 'emulator', variant });
    expect(runner.ranWith('usbipd.exe')).toBe(false);
  });

  test('does not consult usbipd when not under WSL', () => {
    const runner = new FakeRunner(healthyScript);
    observe({ runner, env: {}, target: 'device', variant });
    expect(runner.ranWith('usbipd.exe')).toBe(false);
  });

  test('reports the dev client as unknown, not missing, when pm never becomes ready', () => {
    const runner = new FakeRunner([
      ...healthyScript.filter((entry) => entry.match !== 'pm list packages'),
      { match: 'pm list packages', result: { stdout: '' } },
    ]);
    const state = observe({ runner, env: wslEnv, target: 'device', variant });
    expect(state.devClientInstalled).toBeNull();
  });

  test('reports the dev client as missing when pm answers without it', () => {
    const runner = new FakeRunner([
      ...healthyScript.filter((entry) => entry.match !== 'pm list packages'),
      { match: 'pm list packages', result: { stdout: 'package:com.other\n' } },
    ]);
    expect(observe({ runner, env: wslEnv, target: 'device', variant }).devClientInstalled).toBe(false);
  });

  test('skips the package query entirely when no device is selected', () => {
    const runner = new FakeRunner([
      { match: 'command -v', result: { code: 0 } },
      { match: 'adb devices', result: { stdout: 'List of devices attached\n' } },
      { match: 'start-server', result: { code: 0 } },
    ]);
    const state = observe({ runner, env: wslEnv, target: 'device', variant });
    expect(state.selectedSerial).toBeNull();
    expect(state.devClientInstalled).toBeNull();
    expect(runner.ranWith('pm list packages')).toBe(false);
  });

  test('leaves the dev client unknown when no variant is supplied, as doctor does without a config', () => {
    const runner = new FakeRunner(healthyScript);
    expect(observe({ runner, env: wslEnv, target: 'device' }).devClientInstalled).toBeNull();
  });

  test('reads the packager hostname from the environment', () => {
    const runner = new FakeRunner(healthyScript);
    const state = observe({
      runner,
      env: { ...wslEnv, REACT_NATIVE_PACKAGER_HOSTNAME: '172.18.0.1' },
      target: 'device',
      variant,
    });
    expect(state.packagerHostname).toBe('172.18.0.1');
  });

  test('reports a missing adb as a missing tool rather than crashing', () => {
    const state = observe({ runner: new FakeRunner([]), env: wslEnv, target: 'device', variant });
    expect(state.missingTools).toContain('adb');
    expect(state.adbServerReachable).toBe(false);
  });

  test('honours an explicit serial', () => {
    // The first matching script entry wins, so the devices listing must be replaced
    // rather than appended after the healthy one.
    const runner = new FakeRunner([
      { match: 'adb devices', result: { stdout: 'PHONE\tdevice\nOTHER\tdevice\n' } },
      ...healthyScript.filter((entry) => entry.match !== 'adb devices'),
    ]);
    const state = observe({ runner, env: wslEnv, target: 'device', variant, explicitSerial: 'OTHER' });
    expect(state.selectedSerial).toBe('OTHER');
  });
});
