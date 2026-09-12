export const COMMANDS = ['doctor', 'init', 'up', 'dev', 'emu', 'install'] as const;
export type Command = (typeof COMMANDS)[number];

export interface ParsedArgs {
  command: Command | null;
  variant?: string;
  target: 'device' | 'emulator';
  serial?: string;
  apk?: string;
  help: boolean;
  version: boolean;
  dryRun: boolean;
  unknown: string[];
}

/**
 * Hand-rolled argv parsing, deliberately.
 *
 * A dependency here would be the package's only runtime dependency, for a surface of six
 * commands and five flags. Keeping it out means `npx wsl-mobile-dev` installs one thing.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    command: null,
    target: 'device',
    help: false,
    version: false,
    dryRun: false,
    unknown: [],
  };

  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    index += 1;
    if (token === undefined) continue;

    if (parsed.command === null && (COMMANDS as readonly string[]).includes(token)) {
      parsed.command = token as Command;
      continue;
    }

    switch (token) {
      case '-h':
      case '--help':
        parsed.help = true;
        break;
      case '-v':
      case '--version':
        parsed.version = true;
        break;
      case '--dry-run':
        parsed.dryRun = true;
        break;
      case '--variant': {
        const value = argv[index];
        index += 1;
        if (value) parsed.variant = value;
        break;
      }
      case '--target': {
        const value = argv[index];
        index += 1;
        if (value === 'emulator' || value === 'device') parsed.target = value;
        else if (value !== undefined) parsed.unknown.push(`--target ${value}`);
        break;
      }
      case '--serial': {
        const value = argv[index];
        index += 1;
        if (value) parsed.serial = value;
        break;
      }
      default:
        if (token.startsWith('-')) parsed.unknown.push(token);
        else if (parsed.command === 'install' && !parsed.apk) parsed.apk = token;
        else parsed.unknown.push(token);
    }
  }

  // `emu` only ever means the Windows AVD, so the target is implied rather than required.
  if (parsed.command === 'emu') parsed.target = 'emulator';

  return parsed;
}

export const HELP = `wsl-mobile-dev - reconcile the WSL2 state an Expo dev build needs

Usage
  wsl-mobile-dev <command> [options]

Commands
  doctor     Report what is broken. Changes nothing. Works without a config.
  init       Write a starter wsl-mobile-dev.config.json, inferred from the project.
  up         Reconcile persistent state: usbipd, adb server, reverse tunnels.
  dev        up, then start Metro with a packager hostname a device can reach.
  emu        Boot the Windows AVD and attach its reverses. Does not start Metro.
  install    Install an APK on the reconciled device, retrying transient failures.

Options
  --variant <name>       Which configured variant to use (default: defaultVariant)
  --target device|emulator   Which hardware path to drive (default: device)
  --serial <serial>      Pin a specific adb serial
  --dry-run              Print what up would do without doing it
  -h, --help             Show this help
  -v, --version          Print the version

Why up cannot fix everything
  REACT_NATIVE_PACKAGER_HOSTNAME has to exist in the process that runs Metro. A
  standalone up exits before Metro starts, so it can never inject it. Use dev, which
  is Metro's parent, or export the variable yourself.
`;
