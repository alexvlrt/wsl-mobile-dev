import { describe, expect, test } from 'vitest';
import { MemoryFs } from '../src/fs.js';
import {
  CONFIG_FILENAME,
  inferConfig,
  loadConfig,
  parseConfig,
  selectVariant,
  serializeConfig,
} from '../src/config.js';

const valid = {
  defaultVariant: 'development',
  variants: {
    development: {
      devClientPackage: 'com.example.app.development',
      reverses: [{ device: 8090, host: 80, label: 'backend' }],
    },
    staging: { devClientPackage: 'com.example.app.staging' },
  },
  avd: 'Medium_Phone_API_36.1',
};

function issuesOf(raw: unknown): string[] {
  const result = parseConfig(raw);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
}

describe('parseConfig', () => {
  test('accepts a well formed multi-variant config', () => {
    const result = parseConfig(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.config.variants)).toEqual(['development', 'staging']);
    expect(result.config.defaultVariant).toBe('development');
    expect(result.config.avd).toBe('Medium_Phone_API_36.1');
  });

  test('adds the Metro reverse automatically so nobody has to remember 8081', () => {
    const result = parseConfig(valid);
    if (!result.ok) throw new Error('expected ok');
    const metro = result.config.variants['development']?.reverses.find((r) => r.device === 8081);
    expect(metro).toEqual({ device: 8081, host: 8081, label: 'Metro' });
  });

  test('does not duplicate the Metro reverse when it was declared explicitly', () => {
    const result = parseConfig({
      variants: { dev: { devClientPackage: 'a.b', reverses: [{ device: 8081, host: 8081 }] } },
    });
    if (!result.ok) throw new Error('expected ok');
    expect(result.config.variants['dev']?.reverses.filter((r) => r.device === 8081)).toHaveLength(1);
  });

  test('supports several variants with different package ids', () => {
    const result = parseConfig(valid);
    if (!result.ok) throw new Error('expected ok');
    expect(result.config.variants['staging']?.devClientPackage).toBe('com.example.app.staging');
  });

  test('rejects a non-object config', () => {
    expect(issuesOf('nope')).toEqual(['.: config must be a JSON object']);
    expect(issuesOf([])).toHaveLength(1);
  });

  test('requires at least one variant', () => {
    expect(issuesOf({ variants: {} })[0]).toContain('at least one variant');
    expect(issuesOf({})[0]).toContain('at least one variant');
  });

  test('requires a devClientPackage per variant', () => {
    expect(issuesOf({ variants: { dev: {} } })[0]).toContain('devClientPackage');
    expect(issuesOf({ variants: { dev: { devClientPackage: '  ' } } })[0]).toContain('devClientPackage');
  });

  test('explains the privileged-port trap instead of failing opaquely at runtime', () => {
    const issues = issuesOf({
      variants: { dev: { devClientPackage: 'a.b', reverses: [{ device: 80, host: 80 }] } },
    });
    expect(issues[0]).toContain('privileged on Android');
    expect(issues[0]).toContain('8090');
  });

  test('rejects an out-of-range host port', () => {
    expect(
      issuesOf({ variants: { dev: { devClientPackage: 'a.b', reverses: [{ device: 8090, host: 0 }] } } })[0]
    ).toContain('host');
  });

  test('rejects reverses that are not an array or not objects', () => {
    expect(issuesOf({ variants: { dev: { devClientPackage: 'a.b', reverses: 'x' } } })[0]).toContain('array');
    expect(issuesOf({ variants: { dev: { devClientPackage: 'a.b', reverses: [1] } } })[0]).toContain('object');
  });

  test('rejects a defaultVariant that names an undeclared variant', () => {
    const issues = issuesOf({ defaultVariant: 'ghost', variants: { dev: { devClientPackage: 'a.b' } } });
    expect(issues[0]).toContain('not one of the declared variants');
  });

  test('falls back to the first variant when defaultVariant is omitted', () => {
    const result = parseConfig({ variants: { only: { devClientPackage: 'a.b' } } });
    if (!result.ok) throw new Error('expected ok');
    expect(result.config.defaultVariant).toBe('only');
  });

  test('defaults the packager hostname to localhost', () => {
    const result = parseConfig({ variants: { dev: { devClientPackage: 'a.b' } } });
    if (!result.ok) throw new Error('expected ok');
    expect(result.config.packagerHostname).toBe('localhost');
  });

  test('honours an explicit packager hostname', () => {
    const result = parseConfig({
      packagerHostname: '127.0.0.1',
      variants: { dev: { devClientPackage: 'a.b' } },
    });
    if (!result.ok) throw new Error('expected ok');
    expect(result.config.packagerHostname).toBe('127.0.0.1');
  });

  test('collects every problem at once rather than stopping at the first', () => {
    const issues = issuesOf({
      defaultVariant: 42,
      avd: 7,
      variants: { dev: { devClientPackage: 'a.b', reverses: [{ device: 80, host: 80 }] } },
    });
    expect(issues.length).toBeGreaterThanOrEqual(3);
  });
});

describe('loadConfig', () => {
  test('points at init when there is no config file', () => {
    const result = loadConfig(new MemoryFs(), '/project');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.message).toContain('init');
  });

  test('reports invalid JSON with the parser message', () => {
    const fs = new MemoryFs({ [`/project/${CONFIG_FILENAME}`]: '{oops' });
    const result = loadConfig(fs, '/project');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.message).toContain('invalid JSON');
  });

  test('loads and validates a real file', () => {
    const fs = new MemoryFs({ [`/project/${CONFIG_FILENAME}`]: JSON.stringify(valid) });
    expect(loadConfig(fs, '/project').ok).toBe(true);
  });
});

describe('selectVariant', () => {
  const config = (() => {
    const result = parseConfig(valid);
    if (!result.ok) throw new Error('fixture invalid');
    return result.config;
  })();

  test('returns the default variant when none is requested', () => {
    expect(selectVariant(config)?.devClientPackage).toBe('com.example.app.development');
  });

  test('returns the requested variant', () => {
    expect(selectVariant(config, 'staging')?.devClientPackage).toBe('com.example.app.staging');
  });

  test('returns null for an unknown variant', () => {
    expect(selectVariant(config, 'ghost')).toBeNull();
  });
});

describe('inferConfig', () => {
  test('reads the Android application id out of app.json', () => {
    const fs = new MemoryFs({
      '/p/app.json': JSON.stringify({ expo: { android: { package: 'com.acme.app' } } }),
    });
    expect(inferConfig(fs, '/p').variants['development']?.devClientPackage).toBe(
      'com.acme.app.development'
    );
  });

  test('also accepts app.config.json and a top-level shape without the expo key', () => {
    const fs = new MemoryFs({
      '/p/app.config.json': JSON.stringify({ android: { package: 'com.acme.bare' } }),
    });
    expect(inferConfig(fs, '/p').variants['development']?.devClientPackage).toBe(
      'com.acme.bare.development'
    );
  });

  test('falls back to an obvious placeholder rather than a plausible guess', () => {
    // A wrong package id fails much later as "dev client not installed", which is a
    // terrible error to debug. An obviously fake one gets noticed immediately.
    expect(inferConfig(new MemoryFs(), '/p').variants['development']?.devClientPackage).toContain(
      'com.example.app'
    );
  });

  test('does not blow up on a malformed app.json', () => {
    const fs = new MemoryFs({ '/p/app.json': '{broken' });
    expect(() => inferConfig(fs, '/p')).not.toThrow();
  });

  test('always includes the Metro reverse', () => {
    expect(inferConfig(new MemoryFs(), '/p').variants['development']?.reverses).toEqual([
      { device: 8081, host: 8081, label: 'Metro' },
    ]);
  });

  test('round-trips through serialize and parse', () => {
    const inferred = inferConfig(new MemoryFs(), '/p', { avd: 'Pixel_7' });
    const reparsed = parseConfig(JSON.parse(serializeConfig(inferred)));
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(reparsed.config.avd).toBe('Pixel_7');
  });

  test('serializes with a trailing newline, as files should end', () => {
    expect(serializeConfig(inferConfig(new MemoryFs(), '/p')).endsWith('\n')).toBe(true);
  });
});
