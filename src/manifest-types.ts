/**
 * Shared manifest types — kept in their own module so both runtime code
 * (discovery.ts) and the build-time compiler (build-manifest.ts) can
 * import them without pulling each other in. This is what lets us
 * exclude `src/build-manifest.ts` from `tsc`'s emit set: the only thing
 * runtime code needs from build-manifest is the `ManifestEntry` type,
 * and that lives here.
 */

export interface ManifestEntry {
  site: string;
  name: string;
  aliases?: string[];
  description: string;
  access: 'read' | 'write';
  example?: string;
  domain?: string;
  strategy: string;
  browser: boolean;
  args: Array<{
    name: string;
    type?: string;
    default?: unknown;
    required?: boolean;
    valueRequired?: boolean;
    positional?: boolean;
    help?: string;
    choices?: string[];
  }>;
  columns?: string[];
  pipeline?: Record<string, unknown>[];
  deprecated?: boolean | string;
  replacedBy?: string;
  type: 'js';
  /** Relative path from clis/ dir, e.g. 'bilibili/search.js' */
  modulePath?: string;
  /** Relative path to the source file from clis/ dir (e.g. 'site/cmd.js') */
  sourceFile?: string;
  /** Pre-navigation control — see CliCommand.navigateBefore */
  navigateBefore?: boolean | string;
}
