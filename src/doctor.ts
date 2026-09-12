import type { Action, ObservedState } from './types.js';
import { manualActions, automaticActions } from './reconcile.js';

export interface ReportLine {
  status: 'ok' | 'broken' | 'warn';
  text: string;
  hint?: string;
}

export interface Report {
  lines: ReportLine[];
  /** Process exit code: zero only when nothing is broken. */
  exitCode: number;
  fixable: number;
  manual: number;
}

const SYMBOL = { ok: '✓', broken: '✗', warn: '!' } as const;

/**
 * Renders observed state and its plan into something a human reads in three seconds.
 *
 * Everything healthy is listed too, not just the failures: the value of a doctor command
 * is as much in confirming what is fine as in naming what is not.
 */
export function buildReport(
  observed: ObservedState,
  actions: readonly Action[],
  options: { configFound: boolean } = { configFound: true }
): Report {
  const lines: ReportLine[] = [];

  if (!observed.isWsl) {
    lines.push({
      status: 'warn',
      text: 'not running inside WSL: this tool targets WSL2 on Windows',
    });
  }

  if (!options.configFound) {
    lines.push({
      status: 'warn',
      text: `no ${'wsl-mobile-dev.config.json'} found, checking only what is universal`,
      hint: 'wsl-mobile-dev init',
    });
  }

  const broken = new Set(actions.map((action) => action.kind));

  if (!broken.has('install-tool')) {
    lines.push({ status: 'ok', text: 'required tools present' });
  }
  if (observed.adbServerReachable && !broken.has('start-adb-server')) {
    lines.push({ status: 'ok', text: 'adb server answering' });
  }
  if (observed.selectedSerial) {
    lines.push({ status: 'ok', text: `device ${observed.selectedSerial}` });
  }
  if (observed.devClientInstalled === true) {
    lines.push({ status: 'ok', text: 'dev client installed' });
  }
  for (const reverse of observed.reverses) {
    lines.push({ status: 'ok', text: `reverse ${reverse.device} to host ${reverse.host}` });
  }

  for (const action of actions) {
    lines.push({
      status: 'broken',
      text: action.summary,
      ...(action.manualHint ? { hint: action.manualHint } : {}),
    });
  }

  return {
    lines,
    exitCode: actions.length === 0 ? 0 : 1,
    fixable: automaticActions(actions).length,
    manual: manualActions(actions).length,
  };
}

export function formatReport(report: Report): string {
  const body = report.lines
    .map((line) => {
      const head = `  ${SYMBOL[line.status]} ${line.text}`;
      return line.hint ? `${head}\n    -> ${line.hint}` : head;
    })
    .join('\n');

  if (report.exitCode === 0) {
    return `${body}\n\nEverything is reconciled.`;
  }

  const parts: string[] = [];
  if (report.fixable > 0) parts.push(`${report.fixable} fixable by \`wsl-mobile-dev up\``);
  if (report.manual > 0) parts.push(`${report.manual} needing you`);
  return `${body}\n\n${parts.join(', ')}.`;
}
