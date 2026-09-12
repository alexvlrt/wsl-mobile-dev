/**
 * Windows-SDK binaries reached through WSL interop (adb.exe, usbipd.exe) emit CRLF.
 * Left alone, a trailing \r breaks every anchored match: /device$/ never fires and a
 * parsed path silently carries an invisible character into a filesystem call.
 *
 * Every byte read from an external command goes through here first.
 */
export function stripCr(value: string): string {
  return value.replace(/\r/g, '');
}

/** Splits command output into trimmed, non-empty lines with CR already gone. */
export function toLines(raw: string): string[] {
  return stripCr(raw)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
