import type { Runner } from './exec.js';
import { isWsl, missingTools, packagerHostname, type EnvLike } from './env.js';
import { readUsbipdState } from './usbipd.js';
import { listDevices, listReverses, listPackages, pickDeviceSerial } from './adb.js';
import type { ObservedState, Target, VariantConfig } from './types.js';

export interface ObserveOptions {
  runner: Runner;
  env: EnvLike & Record<string, string | undefined>;
  target: Target;
  variant?: VariantConfig | undefined;
  adbBin?: string;
  explicitSerial?: string | undefined;
}

/**
 * Takes one honest snapshot of the world. Reads only, changes nothing.
 *
 * Keeping observation separate from planning is what lets `doctor` and `up` share every
 * line of logic: they observe identically, plan identically, and differ only in whether
 * they then apply the plan.
 */
export function observe(options: ObserveOptions): ObservedState {
  const { runner, env, target, variant } = options;
  const wsl = isWsl(env);

  const usbipd =
    target === 'device' && wsl
      ? readUsbipdState(runner)
      : { available: false, phone: null, attached: false, devices: [] };

  const devices = listDevices(runner, { ...(options.adbBin ? { bin: options.adbBin } : {}) });
  const adbServerReachable = runner.run(options.adbBin ?? 'adb', ['start-server']).code === 0;

  const selectedSerial = pickDeviceSerial(devices, {
    ...(options.explicitSerial ? { explicit: options.explicitSerial } : {}),
    preferEmulator: target === 'emulator',
  });

  const adbOptions = {
    ...(options.adbBin ? { bin: options.adbBin } : {}),
    ...(selectedSerial ? { serial: selectedSerial } : {}),
  };

  const reverses = selectedSerial ? listReverses(runner, adbOptions) : [];

  let devClientInstalled: boolean | null = null;
  if (selectedSerial && variant) {
    const packages = listPackages(runner, adbOptions);
    // A null answer means the package manager never became ready. That is "unknown",
    // not "missing": claiming the dev client is absent would send the user to rebuild an
    // app that is sitting right there on the phone.
    devClientInstalled = packages === null ? null : packages.includes(variant.devClientPackage);
  }

  return {
    isWsl: wsl,
    missingTools: missingTools(runner),
    usbipd: {
      available: usbipd.available,
      phone: usbipd.phone,
      attached: usbipd.attached,
    },
    adbServerReachable,
    devices,
    selectedSerial,
    reverses,
    devClientInstalled,
    packagerHostname: packagerHostname(env),
  };
}
