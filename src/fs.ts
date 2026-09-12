import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';

/** Filesystem surface this package needs, injected so tests never touch a real disk. */
export interface FileSystemLike {
  exists(path: string): boolean;
  isDirectory(path: string): boolean;
  readDir(path: string): string[];
  readFile(path: string): string;
  writeFile(path: string, contents: string): void;
}

export const nodeFs: FileSystemLike = {
  exists: (path) => existsSync(path),
  isDirectory: (path) => {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
  readDir: (path) => {
    try {
      return readdirSync(path);
    } catch {
      return [];
    }
  },
  readFile: (path) => readFileSync(path, 'utf8'),
  writeFile: (path, contents) => writeFileSync(path, contents, 'utf8'),
};

/** In-memory filesystem for tests. Paths are exact strings, no normalisation magic. */
export class MemoryFs implements FileSystemLike {
  constructor(
    private readonly files: Record<string, string> = {},
    private readonly dirs: Set<string> = new Set()
  ) {}

  static withDirs(...dirs: string[]): MemoryFs {
    return new MemoryFs({}, new Set(dirs));
  }

  exists(path: string): boolean {
    return path in this.files || this.dirs.has(path);
  }

  isDirectory(path: string): boolean {
    return this.dirs.has(path);
  }

  readDir(path: string): string[] {
    const prefix = path.endsWith('/') ? path : `${path}/`;
    const names = new Set<string>();
    for (const candidate of [...Object.keys(this.files), ...this.dirs]) {
      if (!candidate.startsWith(prefix)) continue;
      const rest = candidate.slice(prefix.length);
      const head = rest.split('/')[0];
      if (head) names.add(head);
    }
    return [...names].sort();
  }

  readFile(path: string): string {
    const contents = this.files[path];
    if (contents === undefined) throw new Error(`ENOENT: ${path}`);
    return contents;
  }

  writeFile(path: string, contents: string): void {
    this.files[path] = contents;
  }

  /** Test helper: what the fake holds right now. */
  snapshot(): Record<string, string> {
    return { ...this.files };
  }
}
