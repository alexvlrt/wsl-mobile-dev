import { describe, expect, test } from 'vitest';
import { FakeRunner } from '../src/exec.js';
import {
  hasTool,
  isUnreachablePackagerHost,
  isWsl,
  missingTools,
  packagerHostname,
  wslGatewayIp,
} from '../src/env.js';

describe('isWsl', () => {
  test('detects WSL from WSL_DISTRO_NAME', () => {
    expect(isWsl({ WSL_DISTRO_NAME: 'Ubuntu' })).toBe(true);
  });

  test('detects WSL from WSL_INTEROP alone', () => {
    expect(isWsl({ WSL_INTEROP: '/run/WSL/8_interop' })).toBe(true);
  });

  test('is false on a plain Linux box', () => {
    expect(isWsl({})).toBe(false);
  });

  test('does not rely on the kernel string, which containers can mimic', () => {
    // A container on a Linux host can carry a microsoft-flavoured kernel version without
    // any of the Windows interop this tool depends on.
    expect(isWsl({ PATH: '/usr/bin' })).toBe(false);
  });
});

describe('tool presence', () => {
  test('hasTool is true when command -v succeeds', () => {
    expect(hasTool(new FakeRunner([{ match: 'command -v adb', result: { code: 0 } }]), 'adb')).toBe(true);
  });

  test('hasTool is false when the tool is absent', () => {
    expect(hasTool(new FakeRunner([]), 'adb')).toBe(false);
  });

  test('missingTools lists only what is absent', () => {
    const runner = new FakeRunner([{ match: 'command -v adb', result: { code: 0 } }]);
    expect(missingTools(runner, ['adb', 'ghost'])).toEqual(['ghost']);
  });

  test('missingTools is empty when everything is present', () => {
    const runner = new FakeRunner([{ match: 'command -v', result: { code: 0 } }]);
    expect(missingTools(runner, ['adb', 'curl'])).toEqual([]);
  });
});

describe('packagerHostname', () => {
  test('reads the environment variable', () => {
    expect(packagerHostname({ REACT_NATIVE_PACKAGER_HOSTNAME: 'localhost' })).toBe('localhost');
  });

  test('treats an empty or whitespace value as unset', () => {
    expect(packagerHostname({ REACT_NATIVE_PACKAGER_HOSTNAME: '' })).toBeNull();
    expect(packagerHostname({ REACT_NATIVE_PACKAGER_HOSTNAME: '   ' })).toBeNull();
  });

  test('is null when the variable is absent', () => {
    expect(packagerHostname({})).toBeNull();
  });

  test('trims surrounding whitespace', () => {
    expect(packagerHostname({ REACT_NATIVE_PACKAGER_HOSTNAME: ' localhost ' })).toBe('localhost');
  });
});

describe('isUnreachablePackagerHost', () => {
  test('localhost and 127.0.0.1 are the only reachable answers through a reverse tunnel', () => {
    expect(isUnreachablePackagerHost('localhost')).toBe(false);
    expect(isUnreachablePackagerHost('127.0.0.1')).toBe(false);
  });

  test('a Docker bridge address is unreachable and serves HTML on the Metro port', () => {
    expect(isUnreachablePackagerHost('172.18.0.1')).toBe(true);
  });

  test('a LAN address works only by accident and breaks on reconnect', () => {
    expect(isUnreachablePackagerHost('192.168.1.42')).toBe(true);
  });

  test('unset counts as unreachable, because Expo then picks for you', () => {
    expect(isUnreachablePackagerHost(null)).toBe(true);
  });
});

describe('wslGatewayIp', () => {
  test('extracts the default gateway', () => {
    const runner = new FakeRunner([
      { match: 'ip route show default', result: { stdout: 'default via 172.20.0.1 dev eth0\n' } },
    ]);
    expect(wslGatewayIp(runner)).toBe('172.20.0.1');
  });

  test('survives CRLF and returns null when there is no default route', () => {
    expect(wslGatewayIp(new FakeRunner([{ match: 'ip route', result: { stdout: '\r\n' } }]))).toBeNull();
  });

  test('returns null when ip is unavailable', () => {
    expect(wslGatewayIp(new FakeRunner([]))).toBeNull();
  });
});
