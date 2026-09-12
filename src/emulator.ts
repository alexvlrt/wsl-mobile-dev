import type { Runner } from './exec.js';
import type { FileSystemLike } from './fs.js';
import { resolveWindowsSdk, windowsAdbPath, windowsEmulatorPath } from './win-sdk.js';
import { toLines } from './text.js';

export interface EmulatorContext {
  sdkRoot: string;
  adbExe: string;
  emulatorExe: string;
}

export type EmulatorResolution =
  | { ok: true; context: EmulatorContext }
  | { ok: false; error: string };

/**
 * Locates the Windows-side emulator tooling.
 *
 * The emulator runs on Windows even when the project lives in WSL, so it must be driven
 * with the Windows adb.exe: that binary talks to the adb server the emulator registered
 * with. Pointing a Linux adb at it does not work, which is the single most common dead
 * end in WSL emulator setups.
 */
export function resolveEmulator(
  fs: FileSystemLike,
  options: { androidHome?: string | undefined; usersRoot?: string } = {}
): EmulatorResolution {
  const sdkRoot = resolveWindowsSdk(fs, options);
  if (!sdkRoot) {
    return {
      ok: false,
      error:
        'no Windows Android SDK found under /mnt/c/Users/*; set ANDROID_HOME to its path',
    };
  }

  return {
    ok: true,
    context: {
      sdkRoot,
      adbExe: windowsAdbPath(sdkRoot),
      emulatorExe: windowsEmulatorPath(sdkRoot),
    },
  };
}

/** Lists the AVDs the Windows SDK knows about. */
export function listAvds(runner: Runner, emulatorExe: string): string[] {
  const result = runner.run(emulatorExe, ['-list-avds']);
  if (result.code !== 0) return [];
  return toLines(result.stdout).filter((line) => !line.toLowerCase().startsWith('warning'));
}

/** True when at least one emulator serial is present in `adb devices`. */
export function isEmulatorRunning(runner: Runner, adbExe: string): boolean {
  const result = runner.run(adbExe, ['devices']);
  if (result.code !== 0) return false;
  return toLines(result.stdout).some((line) => line.startsWith('emulator-'));
}

export type BootResult =
  | { ok: true; alreadyRunning: boolean }
  | { ok: false; error: string };

/**
 * Boots an AVD if none is running, then waits for the framework to be up.
 *
 * `adb wait-for-device` returns as soon as the daemon answers, which is well before the
 * system is usable: installing or launching at that moment fails with errors that look
 * like real problems. sys.boot_completed is the property that actually means ready.
 */
export function bootEmulator(
  runner: Runner,
  context: EmulatorContext,
  avd: string,
  options: { pollAttempts?: number } = {}
): BootResult {
  if (isEmulatorRunning(runner, context.adbExe)) {
    return { ok: true, alreadyRunning: true };
  }

  const available = listAvds(runner, context.emulatorExe);
  if (available.length > 0 && !available.includes(avd)) {
    return {
      ok: false,
      error: `AVD "${avd}" not found. Available: ${available.join(', ')}`,
    };
  }

  const launch = runner.run(context.emulatorExe, [
    '-avd',
    avd,
    '-no-snapshot-save',
    '-no-boot-anim',
    '-gpu',
    'auto',
  ]);
  if (launch.code !== 0) {
    return { ok: false, error: launch.stderr.trim() || `could not start AVD ${avd}` };
  }

  const attempts = options.pollAttempts ?? 90;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const probe = runner.run(context.adbExe, ['shell', 'getprop', 'sys.boot_completed']);
    if (probe.code === 0 && toLines(probe.stdout)[0] === '1') {
      return { ok: true, alreadyRunning: false };
    }
  }

  return { ok: false, error: `AVD ${avd} did not finish booting` };
}
