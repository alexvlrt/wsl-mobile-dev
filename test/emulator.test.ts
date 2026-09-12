import { describe, expect, test } from 'vitest';
import { FakeRunner } from '../src/exec.js';
import { MemoryFs } from '../src/fs.js';
import { bootEmulator, isEmulatorRunning, listAvds, resolveEmulator } from '../src/emulator.js';

const SDK = '/mnt/c/Users/dev/AppData/Local/Android/Sdk';
const fs = MemoryFs.withDirs('/mnt/c/Users', '/mnt/c/Users/dev', SDK);

const context = {
  sdkRoot: SDK,
  adbExe: `${SDK}/platform-tools/adb.exe`,
  emulatorExe: `${SDK}/emulator/emulator.exe`,
};

describe('resolveEmulator', () => {
  test('finds the Windows SDK and derives both tool paths', () => {
    const resolved = resolveEmulator(fs);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.context.adbExe).toContain('platform-tools/adb.exe');
    expect(resolved.context.emulatorExe).toContain('emulator/emulator.exe');
  });

  test('explains itself when no SDK is anywhere to be found', () => {
    const resolved = resolveEmulator(new MemoryFs());
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.error).toContain('ANDROID_HOME');
  });
});

describe('listAvds', () => {
  test('lists the configured AVDs', () => {
    const runner = new FakeRunner([
      { match: '-list-avds', result: { stdout: 'Pixel_7\r\nMedium_Phone_API_36.1\r\n' } },
    ]);
    expect(listAvds(runner, context.emulatorExe)).toEqual(['Pixel_7', 'Medium_Phone_API_36.1']);
  });

  test('drops the warning lines the emulator binary likes to print', () => {
    const runner = new FakeRunner([
      { match: '-list-avds', result: { stdout: 'WARNING: no HAXM\nPixel_7\n' } },
    ]);
    expect(listAvds(runner, context.emulatorExe)).toEqual(['Pixel_7']);
  });

  test('returns an empty list when the binary cannot run', () => {
    expect(listAvds(new FakeRunner([]), context.emulatorExe)).toEqual([]);
  });
});

describe('isEmulatorRunning', () => {
  test('spots an emulator serial through CRLF output', () => {
    const runner = new FakeRunner([
      { match: 'devices', result: { stdout: 'List of devices attached\r\nemulator-5554\tdevice\r\n' } },
    ]);
    expect(isEmulatorRunning(runner, context.adbExe)).toBe(true);
  });

  test('is false when only a physical phone is attached', () => {
    const runner = new FakeRunner([{ match: 'devices', result: { stdout: 'PHONE\tdevice\n' } }]);
    expect(isEmulatorRunning(runner, context.adbExe)).toBe(false);
  });
});

describe('bootEmulator', () => {
  test('does nothing when an emulator is already running', () => {
    const runner = new FakeRunner([
      { match: 'devices', result: { stdout: 'emulator-5554\tdevice\n' } },
    ]);
    expect(bootEmulator(runner, context, 'Pixel_7')).toEqual({ ok: true, alreadyRunning: true });
    expect(runner.ranWith('-avd')).toBe(false);
  });

  test('boots the AVD and waits for the framework, not just the daemon', () => {
    // adb wait-for-device returns long before the system is usable; sys.boot_completed is
    // the property that actually means ready.
    const runner = new FakeRunner([
      { match: 'devices', result: { stdout: 'List of devices attached\n' } },
      { match: '-list-avds', result: { stdout: 'Pixel_7\n' } },
      { match: '-avd Pixel_7', result: { code: 0 } },
      { match: 'sys.boot_completed', result: { stdout: '\n' }, times: 3 },
      { match: 'sys.boot_completed', result: { stdout: '1\r\n' } },
    ]);
    expect(bootEmulator(runner, context, 'Pixel_7')).toEqual({ ok: true, alreadyRunning: false });
  });

  test('names the available AVDs when the requested one does not exist', () => {
    const runner = new FakeRunner([
      { match: 'devices', result: { stdout: '' } },
      { match: '-list-avds', result: { stdout: 'Pixel_7\nTablet\n' } },
    ]);
    const result = bootEmulator(runner, context, 'Ghost');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Pixel_7, Tablet');
  });

  test('reports a launch failure', () => {
    const runner = new FakeRunner([
      { match: 'devices', result: { stdout: '' } },
      { match: '-list-avds', result: { stdout: 'Pixel_7\n' } },
      { match: '-avd Pixel_7', result: { code: 1, stderr: 'HAXM is not installed' } },
    ]);
    const result = bootEmulator(runner, context, 'Pixel_7');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('HAXM');
  });

  test('gives up after the poll budget rather than hanging forever', () => {
    const runner = new FakeRunner([
      { match: 'devices', result: { stdout: '' } },
      { match: '-list-avds', result: { stdout: 'Pixel_7\n' } },
      { match: '-avd Pixel_7', result: { code: 0 } },
      { match: 'sys.boot_completed', result: { stdout: '\n' } },
    ]);
    const result = bootEmulator(runner, context, 'Pixel_7', { pollAttempts: 3 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('did not finish booting');
  });
});
