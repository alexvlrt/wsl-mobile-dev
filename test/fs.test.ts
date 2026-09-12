import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MemoryFs, nodeFs } from '../src/fs.js';

describe('MemoryFs', () => {
  test('reports files and directories it was given', () => {
    const fs = new MemoryFs({ '/a/file.txt': 'hi' }, new Set(['/a']));
    expect(fs.exists('/a/file.txt')).toBe(true);
    expect(fs.exists('/a')).toBe(true);
    expect(fs.exists('/nope')).toBe(false);
  });

  test('distinguishes a directory from a file', () => {
    const fs = new MemoryFs({ '/a/file.txt': 'hi' }, new Set(['/a']));
    expect(fs.isDirectory('/a')).toBe(true);
    expect(fs.isDirectory('/a/file.txt')).toBe(false);
  });

  test('readDir lists immediate children only, sorted and deduplicated', () => {
    const fs = MemoryFs.withDirs('/root', '/root/a', '/root/a/deep', '/root/b');
    expect(fs.readDir('/root')).toEqual(['a', 'b']);
  });

  test('readDir tolerates a trailing slash on the query', () => {
    const fs = MemoryFs.withDirs('/root', '/root/a');
    expect(fs.readDir('/root/')).toEqual(['a']);
  });

  test('readDir returns nothing for an unknown path', () => {
    expect(new MemoryFs().readDir('/nowhere')).toEqual([]);
  });

  test('readFile returns contents and throws for a missing file', () => {
    const fs = new MemoryFs({ '/a.txt': 'body' });
    expect(fs.readFile('/a.txt')).toBe('body');
    expect(() => fs.readFile('/missing.txt')).toThrow(/ENOENT/);
  });

  test('writeFile stores contents that readFile can see', () => {
    const fs = new MemoryFs();
    fs.writeFile('/out.json', '{}');
    expect(fs.readFile('/out.json')).toBe('{}');
    expect(fs.exists('/out.json')).toBe(true);
  });

  test('snapshot exposes what was written without leaking the internal object', () => {
    const fs = new MemoryFs();
    fs.writeFile('/a', '1');
    const snapshot = fs.snapshot();
    snapshot['/a'] = 'tampered';
    expect(fs.readFile('/a')).toBe('1');
  });

  test('withDirs builds a directory-only filesystem', () => {
    const fs = MemoryFs.withDirs('/x');
    expect(fs.isDirectory('/x')).toBe(true);
    expect(fs.snapshot()).toEqual({});
  });
});

describe('nodeFs', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'wsl-mobile-dev-fs-'));
    mkdirSync(path.join(root, 'child'));
    writeFileSync(path.join(root, 'note.txt'), 'contents', 'utf8');
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('exists is true for a real file and directory', () => {
    expect(nodeFs.exists(root)).toBe(true);
    expect(nodeFs.exists(path.join(root, 'note.txt'))).toBe(true);
    expect(nodeFs.exists(path.join(root, 'ghost'))).toBe(false);
  });

  test('isDirectory separates directories from files', () => {
    expect(nodeFs.isDirectory(root)).toBe(true);
    expect(nodeFs.isDirectory(path.join(root, 'note.txt'))).toBe(false);
  });

  test('isDirectory returns false instead of throwing on a missing path', () => {
    // The resolver calls this on paths that often do not exist; throwing would be wrong.
    expect(nodeFs.isDirectory(path.join(root, 'ghost'))).toBe(false);
  });

  test('readDir lists entries and returns empty for a bad path', () => {
    expect(nodeFs.readDir(root).sort()).toEqual(['child', 'note.txt']);
    expect(nodeFs.readDir(path.join(root, 'ghost'))).toEqual([]);
  });

  test('readFile and writeFile round-trip UTF-8', () => {
    const target = path.join(root, 'written.json');
    nodeFs.writeFile(target, '{"accents":"éàç"}');
    expect(nodeFs.readFile(target)).toBe('{"accents":"éàç"}');
  });
});
