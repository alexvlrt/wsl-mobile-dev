import { describe, expect, test } from 'vitest';
import {
  detectPhone,
  isNonPhone,
  looksLikePhone,
  productIdOf,
  scoreDevice,
  selectPhone,
  vendorIdOf,
} from '../src/detect-phone.js';
import type { UsbipdDevice } from '../src/types.js';

const xiaomiPhone: UsbipdDevice = {
  BusId: '2-2',
  InstanceId: 'USB\\VID_2717&PID_FF88\\1a2b3c4d',
  Description: 'Xiaomi Composite ADB Interface',
};

const mediatekBluetooth: UsbipdDevice = {
  BusId: '1-10',
  InstanceId: 'USB\\VID_0E8D&PID_0608\\5&12AB34CD&0&10',
  Description: 'MediaTek Bluetooth Adapter',
};

const foxconnBluetooth: UsbipdDevice = {
  BusId: '1-7',
  InstanceId: 'USB\\VID_0489&PID_E0E2\\ABC123',
  Description: 'Wireless Bluetooth Radio',
};

const webcam: UsbipdDevice = {
  BusId: '1-4',
  InstanceId: 'USB\\VID_04F2&PID_B6D9\\200901010001',
  Description: 'Integrated Webcam',
};

const pixelPhone: UsbipdDevice = {
  BusId: '3-1',
  InstanceId: 'USB\\VID_18D1&PID_4EE7\\ABCDEF',
  Description: 'Android ADB Interface',
};

describe('vendorIdOf / productIdOf', () => {
  test('extracts a lowercase vendor id from an uppercase instance id', () => {
    expect(vendorIdOf(xiaomiPhone)).toBe('2717');
  });

  test('extracts the product id too', () => {
    expect(productIdOf(xiaomiPhone)).toBe('ff88');
  });

  test('returns null when the instance id has no VID', () => {
    expect(vendorIdOf({ BusId: '1-1', InstanceId: 'ROOT\\SYSTEM' })).toBeNull();
  });

  test('returns null when the instance id is missing entirely', () => {
    expect(vendorIdOf({ BusId: '1-1' })).toBeNull();
    expect(productIdOf({ BusId: '1-1' })).toBeNull();
  });
});

describe('isNonPhone', () => {
  test.each([
    ['MediaTek Bluetooth Adapter', mediatekBluetooth],
    ['Wireless Bluetooth Radio', foxconnBluetooth],
    ['Integrated Webcam', webcam],
  ])('rejects built-in hardware: %s', (_label, device) => {
    expect(isNonPhone(device)).toBe(true);
  });

  test('does not reject an actual phone', () => {
    expect(isNonPhone(xiaomiPhone)).toBe(false);
  });

  test('treats a missing description as inconclusive rather than non-phone', () => {
    expect(isNonPhone({ BusId: '1-1', InstanceId: 'USB\\VID_2717&PID_FF88\\X' })).toBe(false);
  });
});

describe('looksLikePhone', () => {
  test('matches an ADB interface description', () => {
    expect(looksLikePhone(pixelPhone)).toBe(true);
  });

  test('does not match a webcam', () => {
    expect(looksLikePhone(webcam)).toBe(false);
  });
});

describe('scoreDevice', () => {
  test('scores a positively identified phone above the selection threshold', () => {
    expect(scoreDevice(xiaomiPhone)).toBeGreaterThanOrEqual(5);
  });

  test('hard-rejects a Bluetooth radio even though its vendor id is an Android OEM', () => {
    // This is the bug that tore Bluetooth off the host: 0e8d is MediaTek, shared between
    // phones and the laptop's own radio. Description must beat vendor id.
    expect(scoreDevice(mediatekBluetooth)).toBeLessThan(0);
  });

  test('hard-rejects a device with no bus id, which cannot be attached anyway', () => {
    expect(scoreDevice({ InstanceId: 'USB\\VID_18D1&PID_4EE7\\X', Description: 'Android' })).toBe(
      -100
    );
  });

  test('leaves an unknown vendor with no description below the threshold', () => {
    const mystery: UsbipdDevice = { BusId: '1-9', InstanceId: 'USB\\VID_ABCD&PID_0001\\X' };
    expect(scoreDevice(mystery)).toBeLessThan(5);
    expect(detectPhone(mystery)).toBe(false);
  });
});

describe('selectPhone', () => {
  test('picks the phone out of a realistic laptop device list', () => {
    const chosen = selectPhone([mediatekBluetooth, webcam, xiaomiPhone, foxconnBluetooth]);
    expect(chosen?.BusId).toBe('2-2');
  });

  test('returns null when only built-in hardware is present', () => {
    expect(selectPhone([mediatekBluetooth, webcam, foxconnBluetooth])).toBeNull();
  });

  test('returns null for an empty list', () => {
    expect(selectPhone([])).toBeNull();
  });

  test('is deterministic when two phones tie, preferring the lowest bus id', () => {
    const a: UsbipdDevice = { ...pixelPhone, BusId: '3-1' };
    const b: UsbipdDevice = { ...pixelPhone, BusId: '1-2' };
    expect(selectPhone([a, b])?.BusId).toBe('1-2');
    expect(selectPhone([b, a])?.BusId).toBe('1-2');
  });

  test('prefers a described Android device over a bare OEM vendor id', () => {
    const bare: UsbipdDevice = { BusId: '1-1', InstanceId: 'USB\\VID_2717&PID_0001\\X' };
    expect(selectPhone([bare, pixelPhone])?.BusId).toBe(pixelPhone.BusId);
  });
});
