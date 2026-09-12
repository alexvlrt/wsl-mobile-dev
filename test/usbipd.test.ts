import { describe, expect, test } from 'vitest';
import { attachWithRecovery, isAttached, isBound, parseUsbipdState, readUsbipdState } from '../src/usbipd.js';
import { FakeRunner } from '../src/exec.js';

const stateJson = JSON.stringify({
  Devices: [
    {
      BusId: '2-2',
      InstanceId: 'USB\\VID_2717&PID_FF88\\X',
      Description: 'Xiaomi Composite ADB Interface',
      ClientIPAddress: null,
      PersistedGuid: 'abc',
    },
    {
      BusId: '1-10',
      InstanceId: 'USB\\VID_0E8D&PID_0608\\Y',
      Description: 'MediaTek Bluetooth Adapter',
      ClientIPAddress: null,
      PersistedGuid: null,
    },
  ],
});

describe('parseUsbipdState', () => {
  test('parses the device array', () => {
    expect(parseUsbipdState(stateJson)).toHaveLength(2);
  });

  test('tolerates a banner printed before the JSON body by older builds', () => {
    expect(parseUsbipdState(`usbipd 4.0.0\n${stateJson}`)).toHaveLength(2);
  });

  test('survives CRLF', () => {
    expect(parseUsbipdState(stateJson.replace(/\n/g, '\r\n'))).toHaveLength(2);
  });

  test('degrades to an empty list on malformed JSON instead of throwing', () => {
    expect(parseUsbipdState('{not json')).toEqual([]);
  });

  test('degrades to an empty list on empty output', () => {
    expect(parseUsbipdState('')).toEqual([]);
    expect(parseUsbipdState('   ')).toEqual([]);
  });

  test('degrades to an empty list when Devices is missing or not an array', () => {
    expect(parseUsbipdState('{"Devices": null}')).toEqual([]);
    expect(parseUsbipdState('{}')).toEqual([]);
  });
});

describe('isAttached / isBound', () => {
  test('a device with a client ip is attached', () => {
    expect(isAttached({ ClientIPAddress: '172.20.0.1' })).toBe(true);
  });

  test('null, empty and whitespace client ip all mean not attached', () => {
    expect(isAttached({ ClientIPAddress: null })).toBe(false);
    expect(isAttached({ ClientIPAddress: '' })).toBe(false);
    expect(isAttached({ ClientIPAddress: '   ' })).toBe(false);
    expect(isAttached({})).toBe(false);
  });

  test('a persisted guid means the device is bound', () => {
    expect(isBound({ PersistedGuid: 'abc' })).toBe(true);
    expect(isBound({ PersistedGuid: null })).toBe(false);
  });
});

describe('readUsbipdState', () => {
  test('reports unavailable when usbipd cannot be run at all', () => {
    const snapshot = readUsbipdState(new FakeRunner([]));
    expect(snapshot).toEqual({ available: false, devices: [], phone: null, attached: false });
  });

  test('finds the phone and ignores the Bluetooth radio', () => {
    const runner = new FakeRunner([{ match: 'usbipd.exe state', result: { stdout: stateJson } }]);
    const snapshot = readUsbipdState(runner);
    expect(snapshot.available).toBe(true);
    expect(snapshot.phone?.BusId).toBe('2-2');
    expect(snapshot.attached).toBe(false);
  });

  test('reports attached when the phone carries a client address', () => {
    const attachedJson = stateJson.replace('"ClientIPAddress":null', '"ClientIPAddress":"172.20.0.1"');
    const runner = new FakeRunner([{ match: 'usbipd.exe state', result: { stdout: attachedJson } }]);
    expect(readUsbipdState(runner).attached).toBe(true);
  });
});

describe('attachWithRecovery', () => {
  test('binds then attaches on a fresh device', () => {
    const runner = new FakeRunner([
      { match: 'bind --busid 2-2', result: { code: 0 } },
      { match: 'attach --wsl --busid 2-2', result: { code: 0 } },
    ]);
    const result = attachWithRecovery(runner, '2-2');
    expect(result.ok).toBe(true);
    expect(result.steps).toEqual(['bind', 'attach']);
  });

  test('skips bind when the device is already bound', () => {
    const runner = new FakeRunner([{ match: 'attach --wsl', result: { code: 0 } }]);
    const result = attachWithRecovery(runner, '2-2', { alreadyBound: true });
    expect(result.steps).toEqual(['attach']);
    expect(runner.ranWith('bind')).toBe(false);
  });

  test('treats "already attached" as success, which makes it safe to run every morning', () => {
    const runner = new FakeRunner([
      { match: 'bind', result: { code: 1, stderr: 'already shared' } },
      { match: 'attach', result: { code: 1, stderr: 'Device is already attached' } },
    ]);
    const result = attachWithRecovery(runner, '2-2');
    expect(result.ok).toBe(true);
    expect(result.steps).toContain('already-attached');
  });

  test('detaches and retries once when a stale attachment blocks the new one', () => {
    const runner = new FakeRunner([
      { match: 'bind', result: { code: 0 } },
      { match: 'attach --wsl --busid 2-2', result: { code: 1, stderr: 'error: device busy' }, times: 1 },
      { match: 'detach', result: { code: 0 } },
      { match: 'attach --wsl --busid 2-2', result: { code: 0 } },
    ]);
    const result = attachWithRecovery(runner, '2-2');
    expect(result.ok).toBe(true);
    expect(result.steps).toEqual(['bind', 'attach', 'detach', 'attach-retry']);
  });

  test('stops with a clear message when bind needs administrator rights', () => {
    const runner = new FakeRunner([
      { match: 'bind', result: { code: 1, stderr: 'Access denied; run as administrator' } },
    ]);
    const result = attachWithRecovery(runner, '2-2');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('elevated');
    // It must not go on to attach after a permission failure.
    expect(runner.ranWith('attach')).toBe(false);
  });

  test('reports the underlying error when even the retry fails', () => {
    const runner = new FakeRunner([
      { match: 'bind', result: { code: 0 } },
      { match: 'attach', result: { code: 1, stderr: 'no such bus id' } },
      { match: 'detach', result: { code: 0 } },
    ]);
    const result = attachWithRecovery(runner, '9-9');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('no such bus id');
  });

  test('records every step so tests assert order rather than side effects', () => {
    const runner = new FakeRunner([{ match: 'bind', result: { code: 0 } }]);
    expect(attachWithRecovery(runner, '2-2').steps[0]).toBe('bind');
  });
});
