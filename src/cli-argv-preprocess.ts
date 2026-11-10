/** Escape leading-dash adapter positional arguments. */
/**
 * Minimal manifest shape consumed by escapeLeadingDashPositional. Imported
 * lazily by main.ts so this module stays dependency-free.
 */
export interface DashPositionalManifestEntry {
  site: string;
  name: string;
  args?: Array<{ name: string; positional?: boolean; required?: boolean; valueRequired?: boolean; default?: unknown }>;
  browser?: boolean;
}

const ROOT_VALUE_FLAGS: ReadonlySet<string> = new Set(['--profile']);

type OptionValueMode = 'none' | 'required' | 'optional';
type OptionParse = { values: string[]; nextIndex: number };

function knownCommandOptions(cmd: DashPositionalManifestEntry): Map<string, OptionValueMode> {
  const options = new Map<string, OptionValueMode>([
    ['-h', 'none'],
    ['--help', 'none'],
    ['-v', 'none'],
    ['--verbose', 'none'],
    ['-f', 'required'],
    ['--format', 'required'],
    ['--trace', 'required'],
  ]);
  if (cmd.browser) {
    options.set('--window', 'required');
    options.set('--site-session', 'required');
    options.set('--keep-tab', 'required');
  }
  for (const arg of cmd.args ?? []) {
    if (arg.positional) continue;
    // Keep in sync with commanderAdapter.ts:
    // required/valueRequired -> `<value>`; otherwise -> `[value]`.
    options.set(`--${arg.name}`, arg.required || arg.valueRequired ? 'required' : 'optional');
  }
  return options;
}

function consumeKnownOption(argv: readonly string[], index: number, options: ReadonlyMap<string, OptionValueMode>): OptionParse | null {
  const token = argv[index];
  if (!token || token === '--') return null;
  const eq = token.indexOf('=');
  const key = eq === -1 ? token : token.slice(0, eq);
  const mode = options.get(key);
  if (!mode && eq === -1 && token.startsWith('-') && !token.startsWith('--') && token.length > 2) {
    const shortKey = token.slice(0, 2);
    const shortMode = options.get(shortKey);
    if (shortMode === 'required') {
      return { values: [token], nextIndex: index + 1 };
    }
  }
  if (!mode) return null;
  if (eq !== -1 || mode === 'none') return { values: [token], nextIndex: index + 1 };
  const next = argv[index + 1];
  if (mode === 'required') {
    return next === undefined
      ? { values: [token], nextIndex: index + 1 }
      : { values: [token, next], nextIndex: index + 2 };
  }
  if (next !== undefined && !next.startsWith('-')) {
    return { values: [token, next], nextIndex: index + 2 };
  }
  return { values: [token], nextIndex: index + 1 };
}

/**
 * `opencli boss detail -abc123def` fails because commander parses
 * `-abc123def` as an unknown option rather than the required
 * `<security-id>` positional. BOSS 直聘 securityId tokens are opaque
 * strings that can legitimately start with `-` (issue #1160), and the
 * same shape can show up in any adapter that takes an opaque-id
 * positional. Insert a `--` separator so commander treats the next
 * token as the positional value.
 */
export function escapeLeadingDashPositional(
  argv: readonly string[],
  manifest: readonly DashPositionalManifestEntry[],
): string[] {
  const result = [...argv];
  const requiredFirstPositional = new Map<string, DashPositionalManifestEntry>();
  for (const cmd of manifest) {
    const first = cmd.args?.find((a) => a.positional);
    if (first?.required) requiredFirstPositional.set(cmd.site + '/' + cmd.name, cmd);
  }
  let i = 0;
  while (i < result.length) {
    const tok = result[i];
    if (!tok.startsWith('-')) break;
    if (tok.includes('=')) { i += 1; continue; }
    if (ROOT_VALUE_FLAGS.has(tok) && i + 1 < result.length) { i += 2; }
    else { i += 1; }
  }
  const site = result[i];
  const cmd = result[i + 1];
  const positionalIdx = i + 2;
  if (!site || !cmd || positionalIdx >= result.length) return result;
  const entry = requiredFirstPositional.get(site + '/' + cmd);
  if (!entry) return result;
  const options = knownCommandOptions(entry);

  const beforePositional: string[] = [];
  let j = positionalIdx;
  while (j < result.length) {
    const token = result[j];
    if (token === '--') return result;
    const consumed = consumeKnownOption(result, j, options);
    if (consumed) {
      beforePositional.push(...consumed.values);
      j = consumed.nextIndex;
      continue;
    }
    if (!token.startsWith('-')) return result;
    if (token.startsWith('--')) return result;
    break;
  }
  if (j >= result.length) return result;

  const positional = result[j];
  const trailingOptions: string[] = [];
  const trailingRest: string[] = [];
  j += 1;
  while (j < result.length) {
    const consumed = consumeKnownOption(result, j, options);
    if (consumed) {
      trailingOptions.push(...consumed.values);
      j = consumed.nextIndex;
      continue;
    }
    trailingRest.push(result[j]);
    j += 1;
  }
  return [
    ...result.slice(0, positionalIdx),
    ...beforePositional,
    ...trailingOptions,
    '--',
    positional,
    ...trailingRest,
  ];
}
