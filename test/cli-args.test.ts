import { describe, expect, test } from 'vitest';
import { COMMANDS, HELP, parseArgs } from '../src/cli-args.js';

describe('parseArgs', () => {
  test('recognises every documented command', () => {
    for (const command of COMMANDS) {
      expect(parseArgs([command]).command).toBe(command);
    }
  });

  test('defaults to the device target', () => {
    expect(parseArgs(['up']).target).toBe('device');
  });

  test('accepts an explicit emulator target', () => {
    expect(parseArgs(['dev', '--target', 'emulator']).target).toBe('emulator');
  });

  test('forces the emulator target for emu, since it means nothing else', () => {
    expect(parseArgs(['emu', '--target', 'device']).target).toBe('emulator');
  });

  test('records an invalid target instead of silently defaulting', () => {
    expect(parseArgs(['dev', '--target', 'toaster']).unknown).toContain('--target toaster');
  });

  test('reads the variant', () => {
    expect(parseArgs(['dev', '--variant', 'staging']).variant).toBe('staging');
  });

  test('reads a pinned serial', () => {
    expect(parseArgs(['up', '--serial', 'PHONE']).serial).toBe('PHONE');
  });

  test('reads the dry run flag', () => {
    expect(parseArgs(['up', '--dry-run']).dryRun).toBe(true);
  });

  test('reads help and version in both short and long forms', () => {
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-v']).version).toBe(true);
    expect(parseArgs(['--version']).version).toBe(true);
  });

  test('takes the positional argument of install as the apk path', () => {
    expect(parseArgs(['install', 'build/app.apk']).apk).toBe('build/app.apk');
  });

  test('collects unknown flags rather than throwing', () => {
    expect(parseArgs(['up', '--wat']).unknown).toEqual(['--wat']);
  });

  test('has no command when argv is empty', () => {
    expect(parseArgs([]).command).toBeNull();
  });

  test('ignores a second command-looking token', () => {
    expect(parseArgs(['up', 'doctor']).command).toBe('up');
  });

  test('tolerates a flag with a missing value at the end of argv', () => {
    expect(() => parseArgs(['dev', '--variant'])).not.toThrow();
    expect(parseArgs(['dev', '--variant']).variant).toBeUndefined();
  });
});

describe('HELP', () => {
  test('documents every command', () => {
    for (const command of COMMANDS) {
      expect(HELP).toContain(command);
    }
  });

  test('explains why up cannot set the packager hostname', () => {
    // This is the single most surprising piece of the design; help must say it.
    expect(HELP).toContain('REACT_NATIVE_PACKAGER_HOSTNAME');
    expect(HELP).toContain('parent');
  });
});
