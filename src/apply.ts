import type { Runner } from './exec.js';
import { addReverse } from './adb.js';
import { attachWithRecovery } from './usbipd.js';
import type { Action } from './types.js';

export interface ApplyOutcome {
  applied: Action[];
  failed: { action: Action; error: string }[];
  skipped: Action[];
}

export interface ApplyOptions {
  runner: Runner;
  /** null is meaningful: it means no device was selectable, not 'not provided'. */
  serial?: string | null | undefined;
  adbBin?: string | undefined;
  /** When true, nothing is executed and every automatic action lands in `applied`. */
  dryRun?: boolean;
}

/**
 * Carries out the automatic half of a plan, in order, stopping at the first failure.
 *
 * Stopping matters: the actions are dependency-ordered, so continuing past a failed
 * usbipd attach would add reverses to a device that is not there and report success.
 */
export function applyPlan(actions: readonly Action[], options: ApplyOptions): ApplyOutcome {
  const outcome: ApplyOutcome = { applied: [], failed: [], skipped: [] };
  let halted = false;

  for (const action of actions) {
    if (!action.automatic) {
      outcome.skipped.push(action);
      continue;
    }
    if (halted) {
      outcome.skipped.push(action);
      continue;
    }
    if (options.dryRun) {
      outcome.applied.push(action);
      continue;
    }

    const error = performAction(action, options);
    if (error === null) {
      outcome.applied.push(action);
    } else {
      outcome.failed.push({ action, error });
      halted = true;
    }
  }

  return outcome;
}

function performAction(action: Action, options: ApplyOptions): string | null {
  const { runner } = options;

  switch (action.kind) {
    case 'usbipd-attach': {
      const busId = String(action.detail?.['busId'] ?? '');
      if (!busId) return 'no bus id to attach';
      const result = attachWithRecovery(runner, busId);
      return result.ok ? null : (result.error ?? 'usbipd attach failed');
    }

    case 'start-adb-server': {
      runner.run(options.adbBin ?? 'adb', ['kill-server']);
      const started = runner.run(options.adbBin ?? 'adb', ['start-server']);
      return started.code === 0 ? null : 'adb server would not start';
    }

    case 'add-reverse': {
      const device = Number(action.detail?.['device']);
      const host = Number(action.detail?.['host']);
      const ok = addReverse(
        runner,
        { device, host },
        {
          ...(options.adbBin ? { bin: options.adbBin } : {}),
          ...(options.serial ? { serial: options.serial } : {}),
        }
      );
      return ok ? null : `could not add reverse ${device} to ${host}`;
    }

    default:
      return `${action.kind} cannot be applied automatically`;
  }
}
