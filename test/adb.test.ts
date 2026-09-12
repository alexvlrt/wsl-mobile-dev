import { describe, expect, test } from 'vitest';
import {
  addReverse,
  hasUnauthorizedDevice,
  installApk,
  isFatalInstallError,
  isValidHostPort,
  isValidReverseDevicePort,
  listDevices,
  listPackages,
  listReverses,
  parseAdbDevices,
  parsePackageList,
  parseReverseList,
  pickDeviceSerial,
} from '../src/adb.js';
import { FakeRunner } from '../src/exec.js';

describe('parseAdbDevices', () => {
  test('parses a normal Unix listing', () => {
    const raw = 'List of devices attached\n1a2b3c4d\tdevice\n';
    expect(parseAdbDevices(raw)).toEqual([
      { serial: '1a2b3c4d', state: 'device', isEmulator: false },
    ]);
  });

  test('survives CRLF from a Windows adb.exe reached through WSL interop', () => {
    // Without stripping CR the state becomes "device\r" and never equals "device".
    const raw = 'List of devices attached\r\n1a2b3c4d\tdevice\r\n\r\n';
    expect(parseAdbDevices(raw)[0]).toEqual({
      serial: '1a2b3c4d',
      state: 'device',
      isEmulator: false,
    });
  });

  test('recognises an emulator serial', () => {
    expect(parseAdbDevices('emulator-5554\tdevice\n')[0]?.isEmulator).toBe(true);
  });

  test('parses the multi-word "no permissions" state instead of mangling it', () => {
    const raw = 'List of devices attached\nABC\tno permissions (udev rules missing)\n';
    expect(parseAdbDevices(raw)[0]?.state).toBe('no permissions');
  });

  test('parses unauthorized, offline and bootloader states', () => {
    const raw = 'A\tunauthorized\nB\toffline\nC\tbootloader\n';
    expect(parseAdbDevices(raw).map((d) => d.state)).toEqual([
      'unauthorized',
      'offline',
      'bootloader',
    ]);
  });

  test('marks a state it does not know as unknown rather than dropping the device', () => {
    expect(parseAdbDevices('A\tsomethingnew\n')[0]?.state).toBe('unknown');
  });

  test('ignores daemon chatter lines that start with an asterisk', () => {
    const raw = '* daemon not running; starting now at tcp:5037\n* daemon started successfully\nA\tdevice\n';
    expect(parseAdbDevices(raw)).toHaveLength(1);
  });

  test('returns an empty list when nothing is attached', () => {
    expect(parseAdbDevices('List of devices attached\n\n')).toEqual([]);
  });
});

describe('parseReverseList', () => {
  test('parses reverse mappings', () => {
    const raw = 'host-1 tcp:8081 tcp:8081\nhost-1 tcp:8090 tcp:80\n';
    expect(parseReverseList(raw)).toEqual([
      { device: 8081, host: 8081 },
      { device: 8090, host: 80 },
    ]);
  });

  test('survives CRLF', () => {
    expect(parseReverseList('host tcp:8081 tcp:8081\r\n')).toEqual([{ device: 8081, host: 8081 }]);
  });

  test('ignores lines that are not mappings', () => {
    expect(parseReverseList('no reverses\n')).toEqual([]);
  });
});

describe('parsePackageList', () => {
  test('strips the package: prefix', () => {
    expect(parsePackageList('package:com.example.app\npackage:com.other\n')).toEqual([
      'com.example.app',
      'com.other',
    ]);
  });

  test('survives CRLF and ignores non-package lines', () => {
    expect(parsePackageList('package:com.a\r\nrubbish\r\n')).toEqual(['com.a']);
  });
});

describe('reverse port validation', () => {
  test('rejects a privileged device port, which Android refuses as a reverse source', () => {
    expect(isValidReverseDevicePort(80)).toBe(false);
    expect(isValidReverseDevicePort(1023)).toBe(false);
  });

  test('accepts the first unprivileged port and the usual backend choice', () => {
    expect(isValidReverseDevicePort(1024)).toBe(true);
    expect(isValidReverseDevicePort(8090)).toBe(true);
  });

  test('rejects out-of-range and non-integer values', () => {
    expect(isValidReverseDevicePort(70000)).toBe(false);
    expect(isValidReverseDevicePort(8080.5)).toBe(false);
  });

  test('allows a privileged HOST port, since only the device side is restricted', () => {
    expect(isValidHostPort(80)).toBe(true);
    expect(isValidHostPort(0)).toBe(false);
    expect(isValidHostPort(65536)).toBe(false);
  });
});

describe('pickDeviceSerial', () => {
  const phone = { serial: 'PHONE', state: 'device' as const, isEmulator: false };
  const emulator = { serial: 'emulator-5554', state: 'device' as const, isEmulator: true };
  const unauthorized = { serial: 'LOCKED', state: 'unauthorized' as const, isEmulator: false };

  test('prefers a real phone over a running emulator by default', () => {
    expect(pickDeviceSerial([emulator, phone])).toBe('PHONE');
  });

  test('prefers the emulator when the emulator target was requested', () => {
    expect(pickDeviceSerial([phone, emulator], { preferEmulator: true })).toBe('emulator-5554');
  });

  test('falls back to whatever is usable when the preferred kind is absent', () => {
    expect(pickDeviceSerial([emulator], { preferEmulator: false })).toBe('emulator-5554');
  });

  test('never selects an unauthorized device', () => {
    expect(pickDeviceSerial([unauthorized])).toBeNull();
  });

  test('honours an explicit serial when it is present', () => {
    expect(pickDeviceSerial([phone, emulator], { explicit: 'emulator-5554' })).toBe('emulator-5554');
  });

  test('returns null for an explicit serial that is not connected', () => {
    expect(pickDeviceSerial([phone], { explicit: 'GHOST' })).toBeNull();
  });

  test('returns null when nothing is connected', () => {
    expect(pickDeviceSerial([])).toBeNull();
  });
});

describe('hasUnauthorizedDevice', () => {
  test('spots the pending USB debugging prompt', () => {
    expect(
      hasUnauthorizedDevice([{ serial: 'A', state: 'unauthorized', isEmulator: false }])
    ).toBe(true);
  });

  test('is false when everything is authorized', () => {
    expect(hasUnauthorizedDevice([{ serial: 'A', state: 'device', isEmulator: false }])).toBe(false);
  });
});

describe('listPackages cold-start race', () => {
  test('retries while pm returns nothing, then trusts the first non-empty answer', () => {
    // Right after a usbipd reattach the device reports as `device` but pm is not serving
    // yet. A single query there is a confident false negative.
    const runner = new FakeRunner([
      { match: 'pm list packages', result: { stdout: '' }, times: 3 },
      { match: 'pm list packages', result: { stdout: 'package:com.example.app.development\n' } },
    ]);

    expect(listPackages(runner, { attempts: 6 })).toEqual(['com.example.app.development']);
  });

  test('returns null rather than an empty list when pm never becomes ready', () => {
    // null means "unknown", which the planner must not turn into "not installed".
    const runner = new FakeRunner([{ match: 'pm list packages', result: { stdout: '' } }]);
    expect(listPackages(runner, { attempts: 3 })).toBeNull();
  });

  test('gives up after the configured number of attempts', () => {
    const runner = new FakeRunner([{ match: 'pm list packages', result: { stdout: '' } }]);
    listPackages(runner, { attempts: 2 });
    expect(runner.calls.filter((call) => call.includes('pm list packages'))).toHaveLength(2);
  });
});

describe('listDevices / listReverses / addReverse', () => {
  test('listDevices returns an empty list when adb itself fails', () => {
    expect(listDevices(new FakeRunner([]))).toEqual([]);
  });

  test('listReverses targets the given serial', () => {
    const runner = new FakeRunner([
      { match: 'reverse --list', result: { stdout: 'x tcp:8081 tcp:8081\n' } },
    ]);
    expect(listReverses(runner, { serial: 'PHONE' })).toEqual([{ device: 8081, host: 8081 }]);
    expect(runner.ranWith('-s', 'PHONE', 'reverse', '--list')).toBe(true);
  });

  test('addReverse issues the tcp pair in device-then-host order', () => {
    const runner = new FakeRunner([{ match: 'reverse tcp:', result: { code: 0 } }]);
    expect(addReverse(runner, { device: 8090, host: 80 }, { serial: 'P' })).toBe(true);
    expect(runner.ranWith('reverse tcp:8090 tcp:80')).toBe(true);
  });

  test('addReverse reports failure rather than throwing', () => {
    expect(addReverse(new FakeRunner([]), { device: 8090, host: 80 })).toBe(false);
  });
});

describe('installApk', () => {
  test('succeeds on the first try when adb is happy', () => {
    const runner = new FakeRunner([{ match: 'install', result: { stdout: 'Success\n' } }]);
    expect(installApk(runner, 'app.apk')).toEqual({ ok: true, attempts: 1 });
  });

  test('retries a transient verifier failure and then succeeds', () => {
    // The package verifier and HyperOS cloud scan fail an install that works seconds later.
    const runner = new FakeRunner([
      { match: 'install', result: { code: 1, stderr: 'Failure [INSTALL_FAILED_VERIFICATION_TIMEOUT]' }, times: 2 },
      { match: 'install', result: { stdout: 'Success\n' } },
    ]);
    expect(installApk(runner, 'app.apk', { attempts: 4 })).toEqual({ ok: true, attempts: 3 });
  });

  test('stops immediately on a signature or downgrade conflict instead of retrying', () => {
    const runner = new FakeRunner([
      { match: 'install', result: { code: 1, stderr: 'Failure [INSTALL_FAILED_VERSION_DOWNGRADE]' } },
    ]);
    const outcome = installApk(runner, 'app.apk', { attempts: 5 });
    expect(outcome.ok).toBe(false);
    expect(outcome.attempts).toBe(1);
    expect(runner.calls.filter((c) => c.includes('install'))).toHaveLength(1);
  });

  test('treats a zero exit code that still says Failure as a failure', () => {
    // adb has historically exited 0 while printing Failure on the stdout stream.
    const runner = new FakeRunner([{ match: 'install', result: { code: 0, stdout: 'Failure [X]' } }]);
    expect(installApk(runner, 'app.apk', { attempts: 1 }).ok).toBe(false);
  });

  test('isFatalInstallError is case-insensitive and CR-tolerant', () => {
    expect(isFatalInstallError('failure [install_parse_failed_no_certificates]\r\n')).toBe(true);
    expect(isFatalInstallError('Failure [INSTALL_FAILED_VERIFICATION_TIMEOUT]')).toBe(false);
  });
});
