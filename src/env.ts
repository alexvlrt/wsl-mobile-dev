import type { Runner } from './exec.js';
import { toLines } from './text.js';

/** Tools the reconciler needs on PATH before it can do anything useful. */
export const REQUIRED_TOOLS = ['adb'] as const;
export const OPTIONAL_TOOLS = ['usbipd.exe', 'curl'] as const;

export interface EnvLike {
  WSL_DISTRO_NAME?: string | undefined;
  WSL_INTEROP?: string | undefined;
  ANDROID_HOME?: string | undefined;
  PATH?: string | undefined;
}

/**
 * WSL is detected from the environment variables the WSL init sets, not from
 * /proc/version. Distros running in a container on a Linux host can carry a
 * microsoft-flavoured kernel string without any of the Windows interop this tool needs.
 */
export function isWsl(env: EnvLike): boolean {
  return Boolean(env.WSL_DISTRO_NAME ?? env.WSL_INTEROP);
}

export function hasTool(runner: Runner, tool: string): boolean {
  return runner.run('command', ['-v', tool]).code === 0;
}

export function missingTools(runner: Runner, tools: readonly string[] = REQUIRED_TOOLS): string[] {
  return tools.filter((tool) => !hasTool(runner, tool));
}

/**
 * Asks Expo CLI nothing and instead reports the hostname Metro would bind to.
 *
 * With Docker installed, Expo picks the bridge address (172.18.0.1) as the default
 * packager hostname. That address answers with HTML on the Metro port, so /json/list
 * returns nothing parseable and the Hermes inspector never registers. The fix is an env
 * var, which is why only a command that is the PARENT of `expo start` can apply it.
 */
export function packagerHostname(env: Record<string, string | undefined>): string | null {
  const value = env['REACT_NATIVE_PACKAGER_HOSTNAME'];
  return value && value.trim().length > 0 ? value.trim() : null;
}

/** True when the address is one that breaks the Hermes inspector from a device. */
export function isUnreachablePackagerHost(hostname: string | null): boolean {
  if (!hostname) return true;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return false;
  // Any routable LAN or bridge address works only by accident and breaks on reconnect.
  return true;
}

/** Reads the WSL default gateway, used to reach a Windows-hosted adb server. */
export function wslGatewayIp(runner: Runner): string | null {
  const result = runner.run('ip', ['route', 'show', 'default']);
  if (result.code !== 0) return null;
  const first = toLines(result.stdout)[0];
  const match = first ? /default via (\S+)/.exec(first) : null;
  return match?.[1] ?? null;
}
