#!/usr/bin/env node
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { parseArgs, HELP } from './cli-args.js';
import { nodeFs } from './fs.js';
import { loadConfig, selectVariant, inferConfig, serializeConfig, CONFIG_FILENAME } from './config.js';
import { observe } from './observe.js';
import { planReconciliation } from './reconcile.js';
import { buildReport, formatReport } from './doctor.js';
import { applyPlan } from './apply.js';
import { installApk } from './adb.js';
import { resolveEmulator, bootEmulator } from './emulator.js';
import type { Runner, CommandResult } from './exec.js';

const nodeRunner: Runner = {
  run(command, args, options): CommandResult {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      timeout: options?.timeoutMs ?? 60_000,
      env: { ...process.env, ...options?.env },
      shell: command === 'command',
    });
    return {
      code: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  },
};

function version(): string {
  const require = createRequire(import.meta.url);
  const pkg = require('../package.json') as { version: string };
  return pkg.version;
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));

  if (args.version) {
    process.stdout.write(`${version()}\n`);
    return 0;
  }
  if (args.help || args.command === null) {
    process.stdout.write(HELP);
    return args.command === null && !args.help ? 1 : 0;
  }

  const cwd = process.cwd();

  if (args.command === 'init') {
    const path = `${cwd}/${CONFIG_FILENAME}`;
    if (nodeFs.exists(path)) {
      process.stderr.write(`${CONFIG_FILENAME} already exists, leaving it alone.\n`);
      return 1;
    }
    nodeFs.writeFile(path, serializeConfig(inferConfig(nodeFs, cwd)));
    process.stdout.write(`Wrote ${CONFIG_FILENAME}. Check the dev client package id before using up.\n`);
    return 0;
  }

  const loaded = loadConfig(nodeFs, cwd);
  const variant = loaded.ok ? selectVariant(loaded.config, args.variant) : null;

  if (!loaded.ok && args.command !== 'doctor') {
    for (const issue of loaded.issues) process.stderr.write(`  ${issue.path}: ${issue.message}\n`);
    return 1;
  }
  if (loaded.ok && !variant) {
    process.stderr.write(`Unknown variant "${args.variant}".\n`);
    return 1;
  }

  const observed = observe({
    runner: nodeRunner,
    env: process.env,
    target: args.target,
    variant: variant ?? undefined,
    explicitSerial: args.serial,
  });

  if (args.command === 'emu') {
    const resolved = resolveEmulator(nodeFs, { androidHome: process.env['ANDROID_HOME'] });
    if (!resolved.ok) {
      process.stderr.write(`${resolved.error}\n`);
      return 1;
    }
    const avd = loaded.ok ? loaded.config.avd : undefined;
    if (!avd) {
      process.stderr.write('No "avd" set in the config.\n');
      return 1;
    }
    const boot = bootEmulator(nodeRunner, resolved.context, avd);
    if (!boot.ok) {
      process.stderr.write(`${boot.error}\n`);
      return 1;
    }
    process.stdout.write(boot.alreadyRunning ? 'Emulator already running.\n' : 'Emulator booted.\n');
    return 0;
  }

  if (args.command === 'install') {
    if (!args.apk) {
      process.stderr.write('install needs a path to an APK.\n');
      return 1;
    }
    const outcome = installApk(nodeRunner, args.apk, {
      ...(observed.selectedSerial ? { serial: observed.selectedSerial } : {}),
    });
    if (!outcome.ok) {
      process.stderr.write(`${outcome.error}\n`);
      return 1;
    }
    process.stdout.write(`Installed after ${outcome.attempts} attempt(s).\n`);
    return 0;
  }

  const plan = variant
    ? planReconciliation(observed, {
        variant,
        target: args.target,
        packagerHostname: loaded.ok ? loaded.config.packagerHostname : 'localhost',
      })
    : [];

  if (args.command === 'doctor') {
    const report = buildReport(observed, plan, { configFound: loaded.ok });
    process.stdout.write(`${formatReport(report)}\n`);
    return report.exitCode;
  }

  const outcome = applyPlan(plan, {
    runner: nodeRunner,
    serial: observed.selectedSerial,
    dryRun: args.dryRun,
  });

  for (const action of outcome.applied) process.stdout.write(`  fixed: ${action.summary}\n`);
  for (const failure of outcome.failed) process.stderr.write(`  failed: ${failure.error}\n`);
  if (outcome.failed.length > 0) return 1;

  if (args.command === 'up') {
    process.stdout.write('Reconciled.\n');
    return 0;
  }

  // `dev` is the only command that can guarantee the packager hostname, because it is
  // the parent process of Metro. This is the whole reason it exists next to `up`.
  const expo = spawnSync('npx', ['expo', 'start', '--dev-client'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      REACT_NATIVE_PACKAGER_HOSTNAME: loaded.ok ? loaded.config.packagerHostname : 'localhost',
    },
  });
  return expo.status ?? 1;
}

process.exit(main());
