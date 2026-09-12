import { describe, expect, test } from 'vitest';
import { applyPlan } from '../src/apply.js';
import { FakeRunner } from '../src/exec.js';
import type { Action } from '../src/types.js';

const attach: Action = {
  kind: 'usbipd-attach',
  summary: 'attach the phone',
  automatic: true,
  detail: { busId: '2-2' },
};
const reverse: Action = {
  kind: 'add-reverse',
  summary: 'add the Metro reverse',
  automatic: true,
  detail: { device: 8081, host: 8081 },
};
const manual: Action = {
  kind: 'install-dev-client',
  summary: 'install the dev client',
  automatic: false,
};

describe('applyPlan', () => {
  test('runs automatic actions and leaves manual ones alone', () => {
    const runner = new FakeRunner([{ match: 'reverse tcp:', result: { code: 0 } }]);
    const outcome = applyPlan([reverse, manual], { runner });
    expect(outcome.applied).toEqual([reverse]);
    expect(outcome.skipped).toEqual([manual]);
    expect(outcome.failed).toEqual([]);
  });

  test('stops at the first failure instead of pretending later steps succeeded', () => {
    // The plan is dependency-ordered: adding reverses after a failed attach would target
    // a device that is not there and report success.
    const runner = new FakeRunner([
      { match: 'bind', result: { code: 0 } },
      { match: 'attach', result: { code: 1, stderr: 'no such device' } },
      { match: 'detach', result: { code: 0 } },
    ]);
    const outcome = applyPlan([attach, reverse], { runner });
    expect(outcome.failed).toHaveLength(1);
    expect(outcome.skipped).toEqual([reverse]);
    expect(runner.ranWith('reverse tcp:')).toBe(false);
  });

  test('passes the selected serial through to adb', () => {
    const runner = new FakeRunner([{ match: 'reverse tcp:', result: { code: 0 } }]);
    applyPlan([reverse], { runner, serial: 'PHONE' });
    expect(runner.ranWith('-s', 'PHONE', 'reverse tcp:8081 tcp:8081')).toBe(true);
  });

  test('restarts the adb server by killing it first', () => {
    const runner = new FakeRunner([{ match: 'adb', result: { code: 0 } }]);
    const action: Action = { kind: 'start-adb-server', summary: 'restart', automatic: true };
    expect(applyPlan([action], { runner }).applied).toHaveLength(1);
    expect(runner.ranWith('kill-server')).toBe(true);
    expect(runner.ranWith('start-server')).toBe(true);
  });

  test('dry run changes nothing but reports what it would do', () => {
    const runner = new FakeRunner([]);
    const outcome = applyPlan([attach, reverse], { runner, dryRun: true });
    expect(outcome.applied).toHaveLength(2);
    expect(runner.calls).toEqual([]);
  });

  test('reports an action it has no implementation for rather than silently skipping it', () => {
    const odd: Action = { kind: 'authorize-device', summary: 'x', automatic: true };
    const outcome = applyPlan([odd], { runner: new FakeRunner([]) });
    expect(outcome.failed[0]?.error).toContain('cannot be applied automatically');
  });

  test('refuses an attach action carrying no bus id', () => {
    const broken: Action = { kind: 'usbipd-attach', summary: 'x', automatic: true };
    expect(applyPlan([broken], { runner: new FakeRunner([]) }).failed[0]?.error).toContain('no bus id');
  });

  test('an empty plan is a no-op', () => {
    expect(applyPlan([], { runner: new FakeRunner([]) })).toEqual({
      applied: [],
      failed: [],
      skipped: [],
    });
  });
});
