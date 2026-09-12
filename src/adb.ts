import type { Runner } from './exec.js';
import { toLines, stripCr } from './text.js';
import type { AdbDevice, AdbDeviceState, ReversePort } from './types.js';

const KNOWN_STATES: readonly AdbDeviceState[] = [
  'device',
  'unauthorized',
  'offline',
  'no permissions',
  'authorizing',
  'recovery',
  'sideload',
  'bootloader',
];

/**
 * Parses `adb devices`.
 *
 * Handles the two things that break naive parsers: CRLF from a Windows-SDK adb reached
 * through WSL interop, and the "no permissions" state which contains a space and a
 * parenthetical URL, so splitting on whitespace and taking field 2 gets it wrong.
 */
export function parseAdbDevices(raw: string): AdbDevice[] {
  return toLines(raw)
    .filter((line) => !/^list of devices/i.test(line))
    .filter((line) => !line.startsWith('*'))
    .map((line) => {
      const [serial, ...rest] = line.split(/\s+/);
      if (!serial) return null;

      const remainder = rest.join(' ').toLowerCase();
      const state =
        KNOWN_STATES.find((candidate) => remainder.startsWith(candidate)) ?? 'unknown';

      return {
        serial,
        state,
        isEmulator: serial.startsWith('emulator-'),
      } satisfies AdbDevice;
    })
    .filter((device): device is AdbDevice => device !== null);
}

/** Parses `adb reverse --list`, whose lines read `<serial> tcp:8081 tcp:8081`. */
export function parseReverseList(raw: string): ReversePort[] {
  return toLines(raw)
    .map((line) => {
      const match = /tcp:(\d+)\s+tcp:(\d+)/.exec(line);
      if (!match?.[1] || !match[2]) return null;
      return { device: Number(match[1]), host: Number(match[2]) } satisfies ReversePort;
    })
    .filter((entry): entry is ReversePort => entry !== null);
}

/** Parses `pm list packages`, stripping the `package:` prefix. */
export function parsePackageList(raw: string): string[] {
  return toLines(raw)
    .filter((line) => line.startsWith('package:'))
    .map((line) => line.slice('package:'.length));
}

/**
 * Reverse tunnels cannot originate from a privileged device port.
 *
 * Android refuses to listen below 1024 for `adb reverse`, so a config asking for
 * `device: 80` fails at runtime with an opaque error. Catching it at validation time
 * turns a confusing failure into a sentence.
 */
export const MIN_REVERSE_DEVICE_PORT = 1024;

export function isValidReverseDevicePort(port: number): boolean {
  return Number.isInteger(port) && port >= MIN_REVERSE_DEVICE_PORT && port <= 65535;
}

export function isValidHostPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port <= 65535;
}

export interface AdbOptions {
  bin?: string;
  serial?: string;
}

function adbArgs(options: AdbOptions, args: string[]): string[] {
  return options.serial ? ['-s', options.serial, ...args] : args;
}

export function listDevices(runner: Runner, options: AdbOptions = {}): AdbDevice[] {
  const result = runner.run(options.bin ?? 'adb', ['devices']);
  if (result.code !== 0) return [];
  return parseAdbDevices(result.stdout);
}

export function listReverses(runner: Runner, options: AdbOptions = {}): ReversePort[] {
  const result = runner.run(options.bin ?? 'adb', adbArgs(options, ['reverse', '--list']));
  if (result.code !== 0) return [];
  return parseReverseList(result.stdout);
}

export function addReverse(
  runner: Runner,
  reverse: ReversePort,
  options: AdbOptions = {}
): boolean {
  const result = runner.run(
    options.bin ?? 'adb',
    adbArgs(options, ['reverse', `tcp:${reverse.device}`, `tcp:${reverse.host}`])
  );
  return result.code === 0;
}

/**
 * Reads the installed package list, retrying while it comes back empty.
 *
 * Right after a usbipd reattach the device already reports as `device`, but the package
 * manager is not serving yet and returns nothing. A single query there produces a
 * confident false negative ("your dev client is not installed") and sends the user off to
 * rebuild an app that is sitting on the phone. An empty answer is treated as "not ready",
 * a non-empty one is trusted immediately.
 */
export function listPackages(
  runner: Runner,
  options: AdbOptions & { attempts?: number } = {}
): string[] | null {
  const attempts = options.attempts ?? 6;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = runner.run(
      options.bin ?? 'adb',
      adbArgs(options, ['shell', 'pm', 'list', 'packages'])
    );
    const packages = result.code === 0 ? parsePackageList(result.stdout) : [];
    if (packages.length > 0) return packages;
  }

  return null;
}

/**
 * Picks which device to drive.
 *
 * An explicit serial always wins. Otherwise a real handset is preferred over an
 * emulator, because a developer with both plugged in is almost always testing on the
 * phone; emulator work goes through `--target emulator`, which sets `preferEmulator`.
 */
export function pickDeviceSerial(
  devices: readonly AdbDevice[],
  options: { explicit?: string; preferEmulator?: boolean } = {}
): string | null {
  if (options.explicit) {
    return devices.some((device) => device.serial === options.explicit)
      ? options.explicit
      : null;
  }

  const usable = devices.filter((device) => device.state === 'device');
  if (usable.length === 0) return null;

  const wanted = options.preferEmulator
    ? usable.find((device) => device.isEmulator)
    : usable.find((device) => !device.isEmulator);

  return (wanted ?? usable[0])?.serial ?? null;
}

/** True when a device is present but has not accepted the USB debugging prompt. */
export function hasUnauthorizedDevice(devices: readonly AdbDevice[]): boolean {
  return devices.some((device) => device.state === 'unauthorized');
}

export interface InstallOutcome {
  ok: boolean;
  attempts: number;
  error?: string;
}

/**
 * Installs an APK, retrying around the transient failures that are not really failures.
 *
 * The package verifier and MIUI/HyperOS "cloud scan" both fail an install with a generic
 * error while the same command succeeds seconds later. Retrying those blindly is safe;
 * retrying a genuine signature or downgrade conflict is not, so those stop immediately.
 */
export const FATAL_INSTALL_ERRORS = [
  'INSTALL_FAILED_VERSION_DOWNGRADE',
  'INSTALL_FAILED_UPDATE_INCOMPATIBLE',
  'INSTALL_FAILED_INVALID_APK',
  'INSTALL_PARSE_FAILED',
  'INSTALL_FAILED_INSUFFICIENT_STORAGE',
  'INSTALL_FAILED_NO_MATCHING_ABIS',
];

export function isFatalInstallError(output: string): boolean {
  const upper = stripCr(output).toUpperCase();
  return FATAL_INSTALL_ERRORS.some((code) => upper.includes(code));
}

export function installApk(
  runner: Runner,
  apkPath: string,
  options: AdbOptions & { attempts?: number } = {}
): InstallOutcome {
  const attempts = options.attempts ?? 3;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = runner.run(
      options.bin ?? 'adb',
      adbArgs(options, ['install', '-r', '-d', apkPath])
    );
    const combined = `${result.stdout}\n${result.stderr}`;

    if (result.code === 0 && !/failure/i.test(combined)) {
      return { ok: true, attempts: attempt };
    }
    if (isFatalInstallError(combined)) {
      return { ok: false, attempts: attempt, error: combined.trim() };
    }
  }

  return { ok: false, attempts, error: `install failed after ${attempts} attempts` };
}
