import type { Action, ObservedState, ReversePort, Target, VariantConfig } from './types.js';
import { isUnreachablePackagerHost } from './env.js';

export interface DesiredState {
  variant: VariantConfig;
  target: Target;
  packagerHostname: string;
}

/**
 * Turns observed state plus desired state into an ordered list of actions.
 *
 * This is the centre of the package and it is a pure function: no I/O, no clock, no
 * randomness. Every behaviour worth arguing about (what gets fixed, in what order, what
 * a human has to do themselves) is decided here and can be asserted without a phone.
 *
 * Order matters and is not alphabetical. A reverse cannot be added before a device is
 * attached, and a device cannot attach before the tools exist, so the list is emitted in
 * dependency order and `up` applies it top to bottom, stopping at the first failure.
 */
export function planReconciliation(observed: ObservedState, desired: DesiredState): Action[] {
  const actions: Action[] = [];

  for (const tool of observed.missingTools) {
    actions.push({
      kind: 'install-tool',
      summary: `${tool} is not on PATH`,
      automatic: false,
      manualHint: `sudo apt-get install -y ${tool === 'adb' ? 'android-tools-adb' : tool}`,
      detail: { tool },
    });
  }

  // The emulator lives on the Windows side and is reached through adb.exe. usbipd is a
  // USB passthrough mechanism and has nothing to do with it, so the whole branch is
  // skipped rather than reported as broken.
  //
  // It is skipped too when a usable physical device is already selected: usbipd is a
  // means to an end, and the end is reached. A phone can arrive through a Windows adb
  // server bridge or an attachment made earlier, and complaining that "a cabled phone
  // cannot be handed over" while that phone sits there answering is pure noise.
  const physicalDeviceReady = observed.devices.some(
    (device) => device.serial === observed.selectedSerial && !device.isEmulator
  );

  if (desired.target === 'device' && observed.isWsl && !physicalDeviceReady) {
    if (!observed.usbipd.available) {
      actions.push({
        kind: 'usbipd-attach',
        summary: 'usbipd is not reachable from WSL, so a cabled phone cannot be handed over',
        automatic: false,
        manualHint: 'winget install usbipd (in an elevated Windows shell)',
      });
    } else if (!observed.usbipd.phone) {
      actions.push({
        kind: 'usbipd-attach',
        summary: 'no Android phone found among the shared USB devices',
        automatic: false,
        manualHint: 'plug the phone in with a data-capable cable and enable USB debugging',
      });
    } else if (!observed.usbipd.attached) {
      const busId = observed.usbipd.phone.BusId ?? '?';
      actions.push({
        kind: 'usbipd-attach',
        summary: `phone on bus ${busId} is shared but not attached to WSL (a replug detaches it)`,
        automatic: true,
        detail: { busId },
      });
    }
  }

  if (!observed.adbServerReachable) {
    actions.push({
      kind: 'start-adb-server',
      summary: 'the adb server is not answering',
      automatic: true,
    });
  }

  if (observed.devices.some((device) => device.state === 'unauthorized')) {
    actions.push({
      kind: 'authorize-device',
      summary: 'the device is connected but USB debugging has not been allowed',
      automatic: false,
      manualHint: 'accept the "Allow USB debugging" prompt on the phone, then run up again',
    });
  }

  const present = new Set(observed.reverses.map(reverseKey));
  for (const reverse of desired.variant.reverses) {
    if (present.has(reverseKey(reverse))) continue;
    actions.push({
      kind: 'add-reverse',
      summary: `reverse ${reverse.device} to host ${reverse.host}${reverse.label ? ` (${reverse.label})` : ''} is missing`,
      automatic: true,
      detail: { device: reverse.device, host: reverse.host },
    });
  }

  if (observed.devClientInstalled === false) {
    actions.push({
      kind: 'install-dev-client',
      summary: `the dev client ${desired.variant.devClientPackage} is not installed on the device`,
      automatic: false,
      manualHint: 'build and install a dev client, for example: eas build --profile development',
      detail: { packageName: desired.variant.devClientPackage },
    });
  }

  if (isUnreachablePackagerHost(observed.packagerHostname)) {
    actions.push({
      kind: 'set-packager-hostname',
      summary:
        observed.packagerHostname === null
          ? 'REACT_NATIVE_PACKAGER_HOSTNAME is unset, so Expo may pick a Docker bridge address that breaks the Hermes inspector'
          : `REACT_NATIVE_PACKAGER_HOSTNAME is ${observed.packagerHostname}, which a device cannot reach through the reverse tunnel`,
      // Deliberately NOT automatic. An environment variable dies with the process that
      // sets it, so a standalone `up` cannot put one into a later, separate `expo start`.
      // Only `dev`, which is the parent of Metro, can guarantee it.
      automatic: false,
      manualHint: `run \`wsl-mobile-dev dev\` instead of \`expo start\`, or export REACT_NATIVE_PACKAGER_HOSTNAME=${desired.packagerHostname}`,
      detail: { expected: desired.packagerHostname },
    });
  }

  return actions;
}

function reverseKey(reverse: ReversePort): string {
  return `${reverse.device}->${reverse.host}`;
}

/** Actions `up` can carry out on its own. */
export function automaticActions(actions: readonly Action[]): Action[] {
  return actions.filter((action) => action.automatic);
}

/** Actions that need the human, which `doctor` prints with their hint. */
export function manualActions(actions: readonly Action[]): Action[] {
  return actions.filter((action) => !action.automatic);
}

/**
 * True when nothing at all needs doing.
 *
 * This is what makes `up` idempotent in a way that can be asserted: run it, re-observe,
 * and the second plan must be empty.
 */
export function isReconciled(actions: readonly Action[]): boolean {
  return actions.length === 0;
}
