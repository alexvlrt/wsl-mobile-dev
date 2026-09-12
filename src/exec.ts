/**
 * The single seam through which every external command passes.
 *
 * Nothing in this package shells out directly. Commands are values produced by pure
 * planners and handed to a Runner, so the entire decision layer is testable with a
 * scripted fake and no Windows, no phone, and no adb anywhere in sight.
 */
export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  /** Milliseconds before the command is abandoned. */
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface Runner {
  run(command: string, args: string[], options?: RunOptions): CommandResult;
}

/** A single scripted response for {@link FakeRunner}. */
export interface ScriptedCall {
  /** Matched against `${command} ${args.join(' ')}`. */
  match: string | RegExp;
  result: Partial<CommandResult>;
  /** When set, the response is used at most this many times, then falls through. */
  times?: number;
}

export const OK: CommandResult = { code: 0, stdout: '', stderr: '' };
export const FAIL: CommandResult = { code: 1, stdout: '', stderr: '' };

/**
 * Test double that records every invocation and replays scripted answers in order.
 *
 * Unmatched commands return a non-zero result rather than throwing, because that is how
 * a missing binary actually behaves and planners must cope with it.
 */
export class FakeRunner implements Runner {
  readonly calls: string[] = [];
  private readonly used = new Map<ScriptedCall, number>();

  constructor(private readonly script: ScriptedCall[] = []) {}

  run(command: string, args: string[]): CommandResult {
    const line = [command, ...args].join(' ');
    this.calls.push(line);

    for (const entry of this.script) {
      const matches =
        typeof entry.match === 'string' ? line.includes(entry.match) : entry.match.test(line);
      if (!matches) continue;

      const seen = this.used.get(entry) ?? 0;
      if (entry.times !== undefined && seen >= entry.times) continue;
      this.used.set(entry, seen + 1);

      return { ...FAIL, ...entry.result, code: entry.result.code ?? 0 };
    }

    return { code: 127, stdout: '', stderr: `command not found: ${command}` };
  }

  /** True when some recorded invocation contains every fragment given. */
  ranWith(...fragments: string[]): boolean {
    return this.calls.some((call) => fragments.every((fragment) => call.includes(fragment)));
  }
}
