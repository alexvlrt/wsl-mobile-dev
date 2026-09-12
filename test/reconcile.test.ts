import { describe, expect, test } from 'vitest';
import { automaticActions, isReconciled, manualActions, planReconciliation } from '../src/reconcile.js';
import type { ObservedState, VariantConfig } from '../src/types.js';

const variant: VariantConfig = {
  devClientPackage: 'com.example.app.development',
  reverses: [
    { device: 8081, host: 8081, label: 'Metro' },
    { device: 8090, host: 80, label: 'backend' },
  ],
};

/** A world where nothing at all is wrong. Each test breaks exactly one thing. */
function healthy(overrides: Partial<ObservedState> = {}): ObservedState {
  return {
    isWsl: true,
    missingTools: [],
    usbipd: { available: true, phone: { BusId: '2-2' }, attached: true },
    adbServerReachable: true,
    devices: [{ serial: 'PHONE', state: 'device', isEmulator: false }],
    selectedSerial: 'PHONE',
    reverses: [
      { device: 8081, host: 8081 },
      { device: 8090, host: 80 },
    ],
    devClientInstalled: true,
    packagerHostname: 'localhost',
    ...overrides,
  };
}

const desired = { variant, target: 'device' as const, packagerHostname: 'localhost' };

function kinds(observed: ObservedState) {
  return planReconciliation(observed, desired).map((action) => action.kind);
}

describe('planReconciliation', () => {
  test('plans nothing when everything is already in order', () => {
    const plan = planReconciliation(healthy(), desired);
    expect(plan).toEqual([]);
    expect(isReconciled(plan)).toBe(true);
  });

  test('reports a missing tool as something the human must install', () => {
    const plan = planReconciliation(healthy({ missingTools: ['adb'] }), desired);
    expect(plan[0]?.kind).toBe('install-tool');
    expect(plan[0]?.automatic).toBe(false);
    expect(plan[0]?.manualHint).toContain('android-tools-adb');
  });

  test('plans an automatic reattach when a replug detached the phone', () => {
    // No device is reachable yet, which is the state in which usbipd still matters.
    const plan = planReconciliation(
      healthy({
        usbipd: { available: true, phone: { BusId: '2-2' }, attached: false },
        devices: [],
        selectedSerial: null,
      }),
      desired
    );
    const attach = plan.find((action) => action.kind === 'usbipd-attach');
    expect(attach?.automatic).toBe(true);
    expect(attach?.detail?.['busId']).toBe('2-2');
    expect(attach?.summary).toContain('replug');
  });

  test('asks the human to install usbipd when it is not reachable', () => {
    const plan = planReconciliation(
      healthy({
        usbipd: { available: false, phone: null, attached: false },
        devices: [],
        selectedSerial: null,
      }),
      desired
    );
    const attach = plan.find((action) => action.kind === 'usbipd-attach');
    expect(attach?.automatic).toBe(false);
    expect(attach?.manualHint).toContain('winget');
  });

  test('asks the human to plug a phone in when none is shared', () => {
    const plan = planReconciliation(
      healthy({
        usbipd: { available: true, phone: null, attached: false },
        devices: [],
        selectedSerial: null,
      }),
      desired
    );
    expect(plan.find((a) => a.kind === 'usbipd-attach')?.manualHint).toContain('data-capable');
  });

  test('stays quiet about usbipd when a usable phone is already reachable', () => {
    // Found by running doctor against a real project: the phone was present and answering
    // through the Windows adb server, while usbipd.exe was not on PATH in that shell.
    // usbipd is a means to an end; complaining once the end is reached is noise.
    const plan = planReconciliation(
      healthy({ usbipd: { available: false, phone: null, attached: false } }),
      desired
    );
    expect(plan.map((action) => action.kind)).not.toContain('usbipd-attach');
  });

  test('still reports usbipd when no device is reachable at all', () => {
    const plan = planReconciliation(
      healthy({
        usbipd: { available: false, phone: null, attached: false },
        devices: [],
        selectedSerial: null,
      }),
      desired
    );
    expect(plan.map((action) => action.kind)).toContain('usbipd-attach');
  });

  test('still reports usbipd when the only thing reachable is an emulator', () => {
    const plan = planReconciliation(
      healthy({
        usbipd: { available: true, phone: { BusId: '2-2' }, attached: false },
        devices: [{ serial: 'emulator-5554', state: 'device', isEmulator: true }],
        selectedSerial: 'emulator-5554',
      }),
      desired
    );
    expect(plan.map((action) => action.kind)).toContain('usbipd-attach');
  });

  test('skips the whole usbipd branch for the emulator target', () => {
    // The AVD lives on the Windows side and is reached through adb.exe. usbipd is USB
    // passthrough and has nothing to do with it, so it must not be reported as broken.
    const plan = planReconciliation(
      healthy({ usbipd: { available: false, phone: null, attached: false } }),
      { ...desired, target: 'emulator' }
    );
    expect(plan.map((a) => a.kind)).not.toContain('usbipd-attach');
  });

  test('skips the usbipd branch when not running under WSL', () => {
    const plan = planReconciliation(
      healthy({ isWsl: false, usbipd: { available: false, phone: null, attached: false } }),
      desired
    );
    expect(plan.map((a) => a.kind)).not.toContain('usbipd-attach');
  });

  test('plans an automatic adb server restart', () => {
    const plan = planReconciliation(healthy({ adbServerReachable: false }), desired);
    const action = plan.find((a) => a.kind === 'start-adb-server');
    expect(action?.automatic).toBe(true);
  });

  test('tells the human to accept the USB debugging prompt', () => {
    const plan = planReconciliation(
      healthy({ devices: [{ serial: 'P', state: 'unauthorized', isEmulator: false }] }),
      desired
    );
    const action = plan.find((a) => a.kind === 'authorize-device');
    expect(action?.automatic).toBe(false);
    expect(action?.manualHint).toContain('Allow USB debugging');
  });

  test('plans only the reverses that are actually missing', () => {
    const plan = planReconciliation(healthy({ reverses: [{ device: 8081, host: 8081 }] }), desired);
    const reverses = plan.filter((a) => a.kind === 'add-reverse');
    expect(reverses).toHaveLength(1);
    expect(reverses[0]?.detail).toMatchObject({ device: 8090, host: 80 });
    expect(reverses[0]?.automatic).toBe(true);
  });

  test('plans every reverse when none are present', () => {
    expect(planReconciliation(healthy({ reverses: [] }), desired).filter((a) => a.kind === 'add-reverse')).toHaveLength(2);
  });

  test('names the missing dev client package in the summary', () => {
    const plan = planReconciliation(healthy({ devClientInstalled: false }), desired);
    const action = plan.find((a) => a.kind === 'install-dev-client');
    expect(action?.summary).toContain('com.example.app.development');
    expect(action?.automatic).toBe(false);
  });

  test('stays silent about the dev client when its presence is unknown', () => {
    // null means the package manager never became ready. Claiming "not installed" there
    // sends the user to rebuild an app that is already on the phone.
    expect(kinds(healthy({ devClientInstalled: null }))).not.toContain('install-dev-client');
  });

  test('flags an unset packager hostname, which lets Expo pick a Docker bridge address', () => {
    const plan = planReconciliation(healthy({ packagerHostname: null }), desired);
    const action = plan.find((a) => a.kind === 'set-packager-hostname');
    expect(action?.summary).toContain('Docker');
  });

  test('flags a Docker bridge hostname a device cannot reach', () => {
    const plan = planReconciliation(healthy({ packagerHostname: '172.18.0.1' }), desired);
    expect(plan.find((a) => a.kind === 'set-packager-hostname')?.summary).toContain('172.18.0.1');
  });

  test('accepts 127.0.0.1 as well as localhost', () => {
    expect(kinds(healthy({ packagerHostname: '127.0.0.1' }))).not.toContain('set-packager-hostname');
  });

  test('NEVER marks the packager hostname as automatic', () => {
    // An environment variable dies with the process that sets it, so a standalone `up`
    // can never inject one into a later, separate `expo start`. Only `dev` can, because
    // it is Metro's parent. This assertion is the guard on that whole design decision.
    const plan = planReconciliation(healthy({ packagerHostname: null }), desired);
    const action = plan.find((a) => a.kind === 'set-packager-hostname');
    expect(action?.automatic).toBe(false);
    expect(action?.manualHint).toContain('wsl-mobile-dev dev');
  });

  test('emits actions in dependency order: tools, then attach, then server, then reverses', () => {
    const plan = planReconciliation(
      healthy({
        missingTools: ['adb'],
        usbipd: { available: true, phone: { BusId: '2-2' }, attached: false },
        adbServerReachable: false,
        reverses: [],
        devices: [],
        selectedSerial: null,
      }),
      desired
    );
    const order = plan.map((a) => a.kind);
    expect(order.indexOf('install-tool')).toBeLessThan(order.indexOf('usbipd-attach'));
    expect(order.indexOf('usbipd-attach')).toBeLessThan(order.indexOf('start-adb-server'));
    expect(order.indexOf('start-adb-server')).toBeLessThan(order.indexOf('add-reverse'));
  });

  test('is pure: planning twice from the same input gives the same output', () => {
    const observed = healthy({ reverses: [] });
    expect(planReconciliation(observed, desired)).toEqual(planReconciliation(observed, desired));
  });

  test('does not mutate the observed state it was given', () => {
    const observed = healthy({ reverses: [] });
    const snapshot = structuredClone(observed);
    planReconciliation(observed, desired);
    expect(observed).toEqual(snapshot);
  });
});

describe('action partitioning', () => {
  const plan = planReconciliation(
    healthy({ reverses: [], devClientInstalled: false, missingTools: ['adb'] }),
    desired
  );

  test('automaticActions keeps only what up can do alone', () => {
    expect(automaticActions(plan).every((a) => a.automatic)).toBe(true);
    expect(automaticActions(plan).map((a) => a.kind)).toContain('add-reverse');
  });

  test('manualActions keeps only what needs the human', () => {
    expect(manualActions(plan).every((a) => !a.automatic)).toBe(true);
    expect(manualActions(plan).map((a) => a.kind)).toContain('install-dev-client');
  });

  test('the two halves add up to the whole plan', () => {
    expect(automaticActions(plan).length + manualActions(plan).length).toBe(plan.length);
  });

  test('isReconciled is true only for an empty plan', () => {
    expect(isReconciled([])).toBe(true);
    expect(isReconciled(plan)).toBe(false);
  });
});
