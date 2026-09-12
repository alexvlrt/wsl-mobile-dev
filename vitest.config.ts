import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // The CLI entry point is an argv shim over tested commands; everything with logic
      // in it is held to a real bar.
      // cli.ts is an argv shim over tested commands; index.ts is re-exports only and
      // types.ts is erased at compile time. Everything with logic is held to the bar.
      exclude: ['src/cli.ts', 'src/index.ts', 'src/types.ts'],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
