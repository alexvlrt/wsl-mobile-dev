import { describe, expect, test } from 'vitest';
import { MemoryFs } from '../src/fs.js';
import { resolveWindowsSdk, windowsAdbPath, windowsEmulatorPath } from '../src/win-sdk.js';

const SDK = '/mnt/c/Users/someuser/AppData/Local/Android/Sdk';

function fsWith(...dirs: string[]): MemoryFs {
  return MemoryFs.withDirs('/mnt/c/Users', ...dirs);
}

describe('resolveWindowsSdk', () => {
  test('returns ANDROID_HOME when it points at a real directory', () => {
    const fs = fsWith('/explicit/sdk', SDK);
    expect(resolveWindowsSdk(fs, { androidHome: '/explicit/sdk' })).toBe('/explicit/sdk');
  });

  test('ignores a stale ANDROID_HOME that no longer exists', () => {
    // The shape you get after changing machines with a dotfile still exporting the old path.
    const fs = fsWith(SDK, '/mnt/c/Users/someuser');
    expect(resolveWindowsSdk(fs, { androidHome: '/gone/sdk' })).toBe(SDK);
  });

  test('globs profiles when ANDROID_HOME is unset', () => {
    const fs = fsWith(SDK, '/mnt/c/Users/someuser');
    expect(resolveWindowsSdk(fs)).toBe(SDK);
  });

  test('never hardcodes a profile name: any account works', () => {
    const other = '/mnt/c/Users/zzz/AppData/Local/Android/Sdk';
    const fs = fsWith(other, '/mnt/c/Users/zzz');
    expect(resolveWindowsSdk(fs)).toBe(other);
  });

  test('skips the Windows system profiles that never own an SDK', () => {
    const real = '/mnt/c/Users/dev/AppData/Local/Android/Sdk';
    const fs = fsWith(
      '/mnt/c/Users/Default',
      '/mnt/c/Users/Default/AppData/Local/Android/Sdk',
      '/mnt/c/Users/Public',
      '/mnt/c/Users/dev',
      real
    );
    expect(resolveWindowsSdk(fs)).toBe(real);
  });

  test('returns null when no profile owns an SDK', () => {
    expect(resolveWindowsSdk(fsWith('/mnt/c/Users/someuser'))).toBeNull();
  });

  test('returns null on a plain Linux box with no Windows side at all', () => {
    expect(resolveWindowsSdk(new MemoryFs())).toBeNull();
  });

  test('honours a custom users root, which is how the tests avoid touching a real disk', () => {
    const custom = '/tmp/fake/dev/AppData/Local/Android/Sdk';
    const fs = MemoryFs.withDirs('/tmp/fake', '/tmp/fake/dev', custom);
    expect(resolveWindowsSdk(fs, { usersRoot: '/tmp/fake' })).toBe(custom);
  });
});

describe('sdk path helpers', () => {
  test('build the Windows tool paths', () => {
    expect(windowsAdbPath(SDK)).toBe(`${SDK}/platform-tools/adb.exe`);
    expect(windowsEmulatorPath(SDK)).toBe(`${SDK}/emulator/emulator.exe`);
  });
});
