import type { Runner } from './exec.js';
import { stripCr } from './text.js';
import { selectPhone } from './detect-phone.js';
import type { UsbipdDevice } from './types.js';

/**
 * Parses `usbipd.exe state --json`. Returns an empty list rather than throwing on
 * anything unexpected: a usbipd that is missing, too old, or printing a banner must
 * degrade into "no devices", never crash the caller mid-reconciliation.
 */
export function parseUsbipdState(raw: string): UsbipdDevice[] {
  const cleaned = stripCr(raw).trim();
  if (cleaned.length === 0) return [];

  // Older builds print a line of preamble before the JSON body.
  const start = cleaned.indexOf('{');
  if (start === -1) return [];

  try {
    const parsed: unknown = JSON.parse(cleaned.slice(start));
    if (typeof parsed !== 'object' || parsed === null) return [];
    const devices = (parsed as { Devices?: unknown }).Devices;
    return Array.isArray(devices) ? (devices as UsbipdDevice[]) : [];
  } catch {
    return [];
  }
}

/** True when usbipd reports the device as currently handed to WSL. */
export function isAttached(device: UsbipdDevice): boolean {
  const client = device.ClientIPAddress;
  return typeof client === 'string' && client.trim().length > 0;
}

/** True when the device has been shared (bound), a prerequisite for attaching. */
export function isBound(device: UsbipdDevice): boolean {
  return typeof device.PersistedGuid === 'string' && device.PersistedGuid.trim().length > 0;
}

export interface UsbipdSnapshot {
  available: boolean;
  devices: UsbipdDevice[];
  phone: UsbipdDevice | null;
  attached: boolean;
}

export function readUsbipdState(runner: Runner, usbipdBin = 'usbipd.exe'): UsbipdSnapshot {
  const result = runner.run(usbipdBin, ['state']);
  if (result.code !== 0) {
    return { available: false, devices: [], phone: null, attached: false };
  }

  const devices = parseUsbipdState(result.stdout);
  const phone = selectPhone(devices);
  return {
    available: true,
    devices,
    phone,
    attached: phone ? isAttached(phone) : false,
  };
}

export interface AttachOutcome {
  ok: boolean;
  /** Every step tried, in order. Assertions read this instead of side effects. */
  steps: string[];
  error?: string;
}

/**
 * Attaches a bus id to WSL, binding first when needed and retrying once.
 *
 * A USB reset (the user unplugging and replugging, or the phone rebooting) silently
 * drops the attachment, so this is designed to be safe to call on every single run:
 * already-attached is success, not an error.
 */
export function attachWithRecovery(
  runner: Runner,
  busId: string,
  options: { usbipdBin?: string; alreadyBound?: boolean } = {}
): AttachOutcome {
  const bin = options.usbipdBin ?? 'usbipd.exe';
  const steps: string[] = [];

  if (!options.alreadyBound) {
    steps.push('bind');
    const bind = runner.run(bin, ['bind', '--busid', busId]);
    // A device bound by a previous session makes bind fail harmlessly. Only a hard
    // permission failure is fatal, and that one the user must fix as administrator.
    if (bind.code !== 0 && /access|denied|administrator|elevat/i.test(bind.stderr)) {
      return {
        ok: false,
        steps,
        error: `usbipd bind needs an elevated Windows shell: usbipd bind --busid ${busId}`,
      };
    }
  }

  steps.push('attach');
  const attach = runner.run(bin, ['attach', '--wsl', '--busid', busId]);
  if (attach.code === 0) return { ok: true, steps };

  if (/already attached/i.test(attach.stderr) || /already attached/i.test(attach.stdout)) {
    steps.push('already-attached');
    return { ok: true, steps };
  }

  // A stale attachment from a killed WSL session blocks the new one. Detach, retry once.
  steps.push('detach');
  runner.run(bin, ['detach', '--busid', busId]);
  steps.push('attach-retry');
  const retry = runner.run(bin, ['attach', '--wsl', '--busid', busId]);
  if (retry.code === 0) return { ok: true, steps };

  return {
    ok: false,
    steps,
    error: retry.stderr.trim() || `usbipd attach failed for bus ${busId}`,
  };
}
