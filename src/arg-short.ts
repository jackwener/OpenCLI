/**
 * Shared resolution for adapter-declared single-letter short option aliases.
 *
 * Used by BOTH the Commander registration (`commanderAdapter`) and the argv
 * pre-processor (`cli-argv-preprocess`) so the two layers agree exactly on which
 * shorts are live — otherwise a short the pre-processor doesn't recognize gets
 * mis-escaped as a positional and never reaches Commander. Kept dependency-free
 * so the pre-processor's lazy import stays cheap.
 */

/** Short flags reserved by the base options: -f/--format, -v/--verbose, -h/--help. */
export const RESERVED_ARG_SHORTS: readonly string[] = ['f', 'v', 'h'];

/**
 * Resolve an arg's declared short alias to a single letter that is safe to
 * register, or undefined when it can't be. Rejects anything that isn't a single
 * ASCII letter and anything already claimed (seed `used` with
 * `RESERVED_ARG_SHORTS`). A claimed short is added to `used`, so the first
 * declaration in a command wins and a later duplicate degrades to long-only
 * rather than making Commander throw on a duplicate flag.
 */
export function resolveArgShort(short: string | undefined, used: Set<string>): string | undefined {
  if (typeof short !== 'string') return undefined;
  const s = short.trim();
  if (!/^[A-Za-z]$/.test(s)) return undefined;
  if (used.has(s)) return undefined;
  used.add(s);
  return s;
}
