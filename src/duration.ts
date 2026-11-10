/** Parse the relative time options shared by browser and trace commands. */
export function parseDurationMs(raw: unknown, flagName: string): number | null | { error: string } {
  if (raw === undefined || raw === null || raw === '') return null;
  const str = String(raw).trim();
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(str);
  if (!match) return { error: `--${flagName} must be a duration like 500ms, 30s, 2m, got "${str}"` };
  const value = Number.parseFloat(match[1]);
  const unit = match[2] ?? 'ms';
  const multiplier = unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : unit === 's' ? 1_000 : 1;
  const ms = Math.round(value * multiplier);
  if (!Number.isSafeInteger(ms)) return { error: `--${flagName} exceeds the supported duration range` };
  return ms;
}
