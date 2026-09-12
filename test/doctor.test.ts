import { describe, expect, test } from 'vitest';
import { buildReport, formatReport } from '../src/doctor.js';
import { planReconciliation } from '../src/reconcile.js';
import type { ObservedState, VariantConfig } from '../src/types.js';

const variant: VariantConfig = {
  devClientPackage: 'com.example.app.development',
  reverses: [{ device: 8081, host: 8081, label: 'Metro' }],
};

function observed(overrides: Partial<ObservedState> = {}): ObservedState {
  return {
    isWsl: true,
    missingTools: [],
    usbipd: { available: true, phone: { BusId: '2-2' }, attached: true },
    adbServerReachable: true,
    devices: [{ serial: 'PHONE', state: 'device', isEmulator: false }],
    selectedSerial: 'PHONE',
    reverses: [{ device: 8081, host: 8081 }],
    devClientInstalled: true,
    packagerHostname: 'localhost',
    ...overrides,
  };
}

const desired = { variant, target: 'device' as const, packagerHostname: 'localhost' };

describe('buildReport', () => {
  test('exits zero and says so when nothing is wrong', () => {
    const state = observed();
    const report = buildReport(state, planReconciliation(state, desired));
    expect(report.exitCode).toBe(0);
    expect(formatReport(report)).toContain('Everything is reconciled');
  });

  test('lists what is healthy, not only what is broken', () => {
    const state = observed();
    const report = buildReport(state, planReconciliation(state, desired));
    const ok = report.lines.filter((line) => line.status === 'ok').map((line) => line.text);
    expect(ok).toContain('device PHONE');
    expect(ok).toContain('dev client installed');
    expect(ok.some((text) => text.includes('reverse 8081'))).toBe(true);
  });

  test('exits non-zero when anything is broken', () => {
    const state = observed({ reverses: [] });
    expect(buildReport(state, planReconciliation(state, desired)).exitCode).toBe(1);
  });

  test('counts fixable and manual work separately', () => {
    const state = observed({ reverses: [], devClientInstalled: false });
    const report = buildReport(state, planReconciliation(state, desired));
    expect(report.fixable).toBe(1);
    expect(report.manual).toBe(1);
  });

  test('warns rather than fails when there is no config, so npx is useful immediately', () => {
    const state = observed();
    const report = buildReport(state, [], { configFound: false });
    expect(report.exitCode).toBe(0);
    expect(report.lines.some((line) => line.status === 'warn' && line.hint?.includes('init'))).toBe(true);
  });

  test('warns when not running under WSL at all', () => {
    const state = observed({ isWsl: false });
    const report = buildReport(state, []);
    expect(report.lines[0]?.status).toBe('warn');
    expect(report.lines[0]?.text).toContain('WSL2');
  });

  test('carries the manual hint through to the rendered output', () => {
    const state = observed({ devClientInstalled: false });
    const report = buildReport(state, planReconciliation(state, desired));
    expect(formatReport(report)).toContain('eas build --profile development');
  });
});

describe('formatReport', () => {
  test('marks broken lines with a cross and healthy ones with a tick', () => {
    const state = observed({ reverses: [] });
    const text = formatReport(buildReport(state, planReconciliation(state, desired)));
    expect(text).toContain('✗');
    expect(text).toContain('✓');
  });

  test('summarises how much up can fix by itself', () => {
    const state = observed({ reverses: [] });
    const text = formatReport(buildReport(state, planReconciliation(state, desired)));
    expect(text).toContain('1 fixable by `wsl-mobile-dev up`');
  });

  test('indents hints under the line they belong to', () => {
    const state = observed({ devClientInstalled: false });
    const text = formatReport(buildReport(state, planReconciliation(state, desired)));
    expect(text).toMatch(/\n {4}-> /);
  });
});
