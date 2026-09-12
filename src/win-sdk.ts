import type { FileSystemLike } from './fs.js';

export const DEFAULT_WIN_USERS_ROOT = '/mnt/c/Users';

/** Profile names Windows creates itself, which never own a developer SDK install. */
const SYSTEM_PROFILES = new Set(['Default', 'Default User', 'Public', 'All Users', 'desktop.ini']);

/**
 * Finds the Windows Android SDK from inside WSL without ever hardcoding an account name.
 *
 * Baking a personal profile path into a script leaks the author's Windows user name to
 * everyone who clones the repo, and is wrong on every other machine. An ANDROID_HOME that
 * does not exist is treated as absent rather than as an answer, so a stale export left in
 * a dotfile after changing machines cannot beat a profile that is really there.
 */
export function resolveWindowsSdk(
  fs: FileSystemLike,
  options: { androidHome?: string | undefined; usersRoot?: string } = {}
): string | null {
  const { androidHome, usersRoot = DEFAULT_WIN_USERS_ROOT } = options;

  if (androidHome && fs.isDirectory(androidHome)) return androidHome;
  if (!fs.isDirectory(usersRoot)) return null;

  for (const profile of fs.readDir(usersRoot)) {
    if (SYSTEM_PROFILES.has(profile)) continue;
    const candidate = `${usersRoot}/${profile}/AppData/Local/Android/Sdk`;
    if (fs.isDirectory(candidate)) return candidate;
  }

  return null;
}

export function windowsAdbPath(sdkRoot: string): string {
  return `${sdkRoot}/platform-tools/adb.exe`;
}

export function windowsEmulatorPath(sdkRoot: string): string {
  return `${sdkRoot}/emulator/emulator.exe`;
}
