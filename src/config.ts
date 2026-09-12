import type { FileSystemLike } from './fs.js';
import { isValidReverseDevicePort, isValidHostPort, MIN_REVERSE_DEVICE_PORT } from './adb.js';
import type { Config, ReversePort, VariantConfig } from './types.js';

export const CONFIG_FILENAME = 'wsl-mobile-dev.config.json';
export const DEFAULT_PACKAGER_HOSTNAME = 'localhost';
export const METRO_PORT = 8081;

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ParseResult =
  | { ok: true; config: Config }
  | { ok: false; issues: ValidationIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseReverses(raw: unknown, path: string, issues: ValidationIssue[]): ReversePort[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    issues.push({ path, message: 'must be an array of { device, host } entries' });
    return [];
  }

  const reverses: ReversePort[] = [];
  raw.forEach((entry, index) => {
    const where = `${path}[${index}]`;
    if (!isRecord(entry)) {
      issues.push({ path: where, message: 'must be an object' });
      return;
    }

    const device = entry['device'];
    const host = entry['host'];

    if (typeof device !== 'number' || !isValidReverseDevicePort(device)) {
      issues.push({
        path: `${where}.device`,
        message:
          typeof device === 'number' && device < MIN_REVERSE_DEVICE_PORT
            ? `port ${device} is privileged on Android and cannot receive a reverse; use ${MIN_REVERSE_DEVICE_PORT} or above (a common choice for a host port 80 backend is 8090)`
            : `must be an integer between ${MIN_REVERSE_DEVICE_PORT} and 65535`,
      });
      return;
    }

    if (typeof host !== 'number' || !isValidHostPort(host)) {
      issues.push({ path: `${where}.host`, message: 'must be an integer between 1 and 65535' });
      return;
    }

    const label = entry['label'];
    reverses.push({
      device,
      host,
      ...(typeof label === 'string' ? { label } : {}),
    });
  });

  return reverses;
}

/** Validates a parsed object into a Config, collecting every problem instead of the first. */
export function parseConfig(raw: unknown): ParseResult {
  const issues: ValidationIssue[] = [];

  if (!isRecord(raw)) {
    return { ok: false, issues: [{ path: '.', message: 'config must be a JSON object' }] };
  }

  const variantsRaw = raw['variants'];
  const variants: Record<string, VariantConfig> = {};

  if (!isRecord(variantsRaw) || Object.keys(variantsRaw).length === 0) {
    issues.push({ path: 'variants', message: 'at least one variant is required' });
  } else {
    for (const [name, value] of Object.entries(variantsRaw)) {
      const where = `variants.${name}`;
      if (!isRecord(value)) {
        issues.push({ path: where, message: 'must be an object' });
        continue;
      }

      const devClientPackage = value['devClientPackage'];
      if (typeof devClientPackage !== 'string' || devClientPackage.trim().length === 0) {
        issues.push({
          path: `${where}.devClientPackage`,
          message: 'must be the Android application id of the dev client build',
        });
        continue;
      }

      const reverses = parseReverses(value['reverses'], `${where}.reverses`, issues);
      const hasMetro = reverses.some((reverse) => reverse.device === METRO_PORT);
      variants[name] = {
        devClientPackage: devClientPackage.trim(),
        // Metro's own reverse is not something a user should have to remember.
        reverses: hasMetro
          ? reverses
          : [{ device: METRO_PORT, host: METRO_PORT, label: 'Metro' }, ...reverses],
      };
    }
  }

  const defaultVariantRaw = raw['defaultVariant'];
  const variantNames = Object.keys(variants);
  let defaultVariant = variantNames[0] ?? '';

  if (defaultVariantRaw !== undefined) {
    if (typeof defaultVariantRaw !== 'string') {
      issues.push({ path: 'defaultVariant', message: 'must be a string' });
    } else if (!variantNames.includes(defaultVariantRaw)) {
      issues.push({
        path: 'defaultVariant',
        message: `"${defaultVariantRaw}" is not one of the declared variants (${variantNames.join(', ') || 'none'})`,
      });
    } else {
      defaultVariant = defaultVariantRaw;
    }
  }

  const avd = raw['avd'];
  if (avd !== undefined && typeof avd !== 'string') {
    issues.push({ path: 'avd', message: 'must be a string' });
  }

  const hostname = raw['packagerHostname'];
  if (hostname !== undefined && typeof hostname !== 'string') {
    issues.push({ path: 'packagerHostname', message: 'must be a string' });
  }

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    config: {
      defaultVariant,
      variants,
      packagerHostname:
        typeof hostname === 'string' && hostname.trim().length > 0
          ? hostname.trim()
          : DEFAULT_PACKAGER_HOSTNAME,
      ...(typeof avd === 'string' ? { avd } : {}),
    },
  };
}

export function loadConfig(fs: FileSystemLike, dir: string): ParseResult & { path: string } {
  const path = `${dir}/${CONFIG_FILENAME}`;
  if (!fs.exists(path)) {
    return { ok: false, issues: [{ path, message: 'no config found; run `wsl-mobile-dev init`' }], path };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFile(path));
  } catch (error) {
    return {
      ok: false,
      path,
      issues: [{ path, message: `invalid JSON: ${(error as Error).message}` }],
    };
  }

  return { ...parseConfig(parsed), path };
}

export function selectVariant(config: Config, requested?: string): VariantConfig | null {
  const name = requested ?? config.defaultVariant;
  return config.variants[name] ?? null;
}

/**
 * Infers a starting config from an Expo project.
 *
 * Reads app.json / app.config.json for the Android application id. Anything it cannot
 * work out is left as an obvious placeholder rather than a plausible guess, because a
 * wrong package id fails later with a confusing "dev client not installed".
 */
export function inferConfig(
  fs: FileSystemLike,
  dir: string,
  options: { avd?: string } = {}
): Config {
  const candidates = [`${dir}/app.json`, `${dir}/app.config.json`];
  let applicationId: string | null = null;

  for (const candidate of candidates) {
    if (!fs.exists(candidate)) continue;
    try {
      const parsed: unknown = JSON.parse(fs.readFile(candidate));
      if (!isRecord(parsed)) continue;
      const expo = isRecord(parsed['expo']) ? parsed['expo'] : parsed;
      const android = isRecord(expo['android']) ? expo['android'] : undefined;
      const pkg = android?.['package'];
      if (typeof pkg === 'string' && pkg.trim().length > 0) {
        applicationId = pkg.trim();
        break;
      }
    } catch {
      // A malformed app.json is the project's problem, not a reason to fail init.
    }
  }

  const base = applicationId ?? 'com.example.app';

  return {
    defaultVariant: 'development',
    packagerHostname: DEFAULT_PACKAGER_HOSTNAME,
    variants: {
      development: {
        devClientPackage: applicationId ? `${base}.development` : `${base}.development`,
        reverses: [{ device: METRO_PORT, host: METRO_PORT, label: 'Metro' }],
      },
    },
    ...(options.avd ? { avd: options.avd } : {}),
  };
}

export function serializeConfig(config: Config): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}
