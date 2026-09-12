import type { UsbipdDevice } from './types.js';

/**
 * USB vendor ids that ship Android handsets.
 *
 * A vendor id alone is NOT enough to identify a phone, and that is the whole point of
 * this module. MediaTek (0e8d) and Hon Hai / Foxconn (0489) also make the Bluetooth and
 * Wi-Fi radios soldered into laptops. A VID-only heuristic classifies the machine's own
 * Bluetooth adapter as "the phone", and `usbipd attach --wsl` then tears Bluetooth off
 * Windows: mouse, keyboard and headset die at once.
 */
export const ANDROID_VENDOR_IDS = new Set([
  '18d1', // Google
  '04e8', // Samsung
  '2717', // Xiaomi
  '2a70', // OnePlus
  '22d9', // Oppo
  '2d95', // Vivo
  '12d1', // Huawei
  '0fce', // Sony
  '1004', // LG
  '22b8', // Motorola
  '0bb4', // HTC
  '0b05', // Asus
  '17ef', // Lenovo
  '19d2', // ZTE
  '2916', // Android (generic / Andromax)
  '0e8d', // MediaTek, also a very common laptop Bluetooth vendor
  '0489', // Hon Hai / Foxconn, also a very common laptop Bluetooth vendor
  '05c6', // Qualcomm
]);

/**
 * Description fragments that mean "this is soldered into the laptop", never a handset.
 * Checked before the vendor id, so an OEM-vendor radio is rejected rather than attached.
 */
export const NON_PHONE_KEYWORDS = [
  'bluetooth',
  'wireless radio',
  'wireless adapter',
  'wi-fi',
  'wifi',
  'wlan',
  'webcam',
  'camera',
  'keyboard',
  'mouse',
  'touchpad',
  'trackpad',
  'audio',
  'headset',
  'microphone',
  'speaker',
  'hub',
  'card reader',
  'smart card',
  'fingerprint',
  'sensor',
  'biometric',
  'ir camera',
  'integrated',
  'controller',
];

/** Description fragments that positively identify an Android device in adb mode. */
export const PHONE_KEYWORDS = ['adb', 'android', 'composite adb', 'mtp', 'ptp', 'phone'];

/** Extracts the lowercase 4-hex vendor id from a Windows instance id. */
export function vendorIdOf(device: UsbipdDevice): string | null {
  const match = /VID_([0-9a-f]{4})/i.exec(device.InstanceId ?? '');
  return match?.[1] ? match[1].toLowerCase() : null;
}

/** Extracts the lowercase 4-hex product id from a Windows instance id. */
export function productIdOf(device: UsbipdDevice): string | null {
  const match = /PID_([0-9a-f]{4})/i.exec(device.InstanceId ?? '');
  return match?.[1] ? match[1].toLowerCase() : null;
}

/** True when the description marks the device as built-in laptop hardware. */
export function isNonPhone(device: UsbipdDevice): boolean {
  const description = (device.Description ?? '').toLowerCase();
  if (description.length === 0) return false;
  return NON_PHONE_KEYWORDS.some((keyword) => description.includes(keyword));
}

/** True when the description positively names an Android device. */
export function looksLikePhone(device: UsbipdDevice): boolean {
  const description = (device.Description ?? '').toLowerCase();
  return PHONE_KEYWORDS.some((keyword) => description.includes(keyword));
}

/**
 * Scores a device. Higher is more likely to be the phone; a negative score means
 * "never attach this".
 */
export function scoreDevice(device: UsbipdDevice): number {
  if (!device.BusId) return -100;
  if (isNonPhone(device)) return -100;

  let score = 0;
  if (looksLikePhone(device)) score += 10;

  const vendor = vendorIdOf(device);
  if (vendor && ANDROID_VENDOR_IDS.has(vendor)) score += 5;

  // An ambiguous vendor with no helpful description is not worth the risk of ripping
  // a radio off the host, so it stays below the selection threshold.
  return score;
}

/** True when the device is safe to treat as the phone. */
export function detectPhone(device: UsbipdDevice): boolean {
  return scoreDevice(device) >= 5;
}

/**
 * Picks the single best phone candidate, or null when nothing qualifies.
 * Ties break on the lowest bus id so repeated runs are deterministic.
 */
export function selectPhone(devices: readonly UsbipdDevice[]): UsbipdDevice | null {
  const ranked = devices
    .map((device) => ({ device, score: scoreDevice(device) }))
    .filter((entry) => entry.score >= 5)
    .sort((a, b) => b.score - a.score || (a.device.BusId ?? '').localeCompare(b.device.BusId ?? ''));

  return ranked[0]?.device ?? null;
}
