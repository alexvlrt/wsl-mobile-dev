import { describe, expect, test } from 'vitest';
import { stripCr, toLines } from '../src/text.js';

describe('stripCr', () => {
  test('removes the CR that Windows-SDK binaries emit through WSL interop', () => {
    expect(stripCr('emulator-5554\tdevice\r\n')).toBe('emulator-5554\tdevice\n');
  });

  test('leaves clean Unix output untouched', () => {
    expect(stripCr('a\nb\n')).toBe('a\nb\n');
  });

  test('removes a lone CR in the middle of a line, not just at the end', () => {
    expect(stripCr('a\rb')).toBe('ab');
  });

  test('handles an empty string', () => {
    expect(stripCr('')).toBe('');
  });
});

describe('toLines', () => {
  test('splits, trims and drops blank lines', () => {
    expect(toLines('  a  \r\n\r\n b \n')).toEqual(['a', 'b']);
  });

  test('returns an empty array for whitespace-only output', () => {
    expect(toLines(' \r\n\t\n ')).toEqual([]);
  });

  test('keeps internal spacing inside a line', () => {
    expect(toLines('serial   device\n')).toEqual(['serial   device']);
  });
});
