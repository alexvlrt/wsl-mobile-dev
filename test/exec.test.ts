import { describe, expect, test } from 'vitest';
import { FakeRunner } from '../src/exec.js';

describe('FakeRunner', () => {
  test('records every invocation as a flat command line', () => {
    const runner = new FakeRunner([]);
    runner.run('adb', ['-s', 'PHONE', 'devices']);
    expect(runner.calls).toEqual(['adb -s PHONE devices']);
  });

  test('returns 127 for an unscripted command, the way a missing binary behaves', () => {
    const result = new FakeRunner([]).run('nope', []);
    expect(result.code).toBe(127);
    expect(result.stderr).toContain('command not found');
  });

  test('matches on a substring', () => {
    const runner = new FakeRunner([{ match: 'devices', result: { stdout: 'ok' } }]);
    expect(runner.run('adb', ['devices']).stdout).toBe('ok');
  });

  test('matches on a regular expression', () => {
    const runner = new FakeRunner([{ match: /reverse tcp:\d+/, result: { code: 0 } }]);
    expect(runner.run('adb', ['reverse', 'tcp:8081', 'tcp:8081']).code).toBe(0);
  });

  test('honours `times` so a sequence of differing answers can be scripted', () => {
    const runner = new FakeRunner([
      { match: 'x', result: { stdout: 'first' }, times: 1 },
      { match: 'x', result: { stdout: 'second' } },
    ]);
    expect(runner.run('x', []).stdout).toBe('first');
    expect(runner.run('x', []).stdout).toBe('second');
    expect(runner.run('x', []).stdout).toBe('second');
  });

  test('defaults an unspecified code to success', () => {
    expect(new FakeRunner([{ match: 'x', result: { stdout: 'y' } }]).run('x', []).code).toBe(0);
  });

  test('ranWith requires every fragment to appear in one single call', () => {
    const runner = new FakeRunner([]);
    runner.run('adb', ['-s', 'A', 'reverse', 'tcp:8081', 'tcp:8081']);
    runner.run('adb', ['devices']);
    expect(runner.ranWith('-s', 'A', 'reverse')).toBe(true);
    expect(runner.ranWith('devices', 'reverse')).toBe(false);
  });
});
