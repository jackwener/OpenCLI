#!/usr/bin/env node
/**
 * Build-time CLI manifest compiler.
 *
 * Scans all YAML/TS CLI definitions and pre-compiles them into a single
 * manifest.json for instant cold-start registration (no runtime YAML parsing).
 *
 * Usage: npx tsx src/build-manifest.ts
 * Output: dist/cli-manifest.json
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIS_DIR = path.resolve(__dirname, 'clis');
const OUTPUT = path.resolve(__dirname, '..', 'dist', 'cli-manifest.json');

interface ManifestEntry {
  site: string;
  name: string;
  description: string;
  domain?: string;
  strategy: string;
  browser: boolean;
  args: Array<{
    name: string;
    type?: string;
    default?: any;
    required?: boolean;
    positional?: boolean;
    help?: string;
    choices?: string[];
  }>;
  columns?: string[];
  pipeline?: any[];
  timeout?: number;
  /** 'yaml' or 'ts' — determines how executeCommand loads the handler */
  type: 'yaml' | 'ts';
  /** Relative path from clis/ dir, e.g. 'bilibili/hot.yaml' or 'bilibili/search.js' */
  modulePath?: string;
  /** Pre-navigation control — see CliCommand.navigateBefore */
  navigateBefore?: boolean | string;
}

function extractBalancedBlock(
  source: string,
  startIndex: number,
  openChar: string,
  closeChar: string,
): string | null {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let i = startIndex; i < source.length; i++) {
    const ch = source[i];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === '"' || ch === '\'' || ch === '`') {
      quote = ch;
      continue;
    }

    if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        return source.slice(startIndex + 1, i);
      }
    }
  }

  return null;
}

function extractTsArgsBlock(source: string): string | null {
  const argsMatch = source.match(/args\s*:/);
  if (!argsMatch || argsMatch.index === undefined) return null;

  const bracketIndex = source.indexOf('[', argsMatch.index);
  if (bracketIndex === -1) return null;

  return extractBalancedBlock(source, bracketIndex, '[', ']');
}

function parseInlineChoices(body: string): string[] | undefined {
  const choicesMatch = body.match(/choices\s*:\s*\[([^\]]*)\]/);
  if (!choicesMatch) return undefined;

  const values = choicesMatch[1]
    .split(',')
    .map(s => s.trim().replace(/^['"`]|['"`]$/g, ''))
    .filter(Boolean);

  return values.length > 0 ? values : undefined;
}

export function parseTsArgsBlock(argsBlock: string): ManifestEntry['args'] {
  const args: ManifestEntry['args'] = [];
  let cursor = 0;

  while (cursor < argsBlock.length) {
    const nameMatch = argsBlock.slice(cursor).match(/\{\s*name\s*:\s*['"`]([^'"`]+)['"`]/);
    if (!nameMatch || nameMatch.index === undefined) break;

    const objectStart = cursor + nameMatch.index;
    const body = extractBalancedBlock(argsBlock, objectStart, '{', '}');
    if (body == null) break;

    const typeMatch = body.match(/type\s*:\s*['"`](\w+)['"`]/);
    const defaultMatch = body.match(/default\s*:\s*([^,}]+)/);
    const requiredMatch = body.match(/required\s*:\s*(true|false)/);
    const helpMatch = body.match(/help\s*:\s*['"`]([^'"`]*)['"`]/);
    const positionalMatch = body.match(/positional\s*:\s*(true|false)/);

    let defaultVal: any = undefined;
    if (defaultMatch) {
      const raw = defaultMatch[1].trim();
      if (raw === 'true') defaultVal = true;
      else if (raw === 'false') defaultVal = false;
      else if (/^\d+$/.test(raw)) defaultVal = parseInt(raw, 10);
      else if (/^\d+\.\d+$/.test(raw)) defaultVal = parseFloat(raw);
      else defaultVal = raw.replace(/^['"`]|['"`]$/g, '');
    }

    args.push({
      name: nameMatch[1],
      type: typeMatch?.[1] ?? 'str',
      default: defaultVal,
      required: requiredMatch?.[1] === 'true',
      positional: positionalMatch?.[1] === 'true' || undefined,
      help: helpMatch?.[1] ?? '',
      choices: parseInlineChoices(body),
    });

    cursor = objectStart + body.length + 2;
  }

  return args;
}

function scanYaml(filePath: string, site: string): ManifestEntry | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const def = yaml.load(raw) as any;
    if (!def || typeof def !== 'object') return null;

    const strategyStr = def.strategy ?? (def.browser === false ? 'public' : 'cookie');
    const strategy = strategyStr.toUpperCase();
    const browser = def.browser ?? (strategy !== 'PUBLIC');

    const args: ManifestEntry['args'] = [];
    if (def.args && typeof def.args === 'object') {
      for (const [argName, argDef] of Object.entries(def.args as Record<string, any>)) {
        args.push({
          name: argName,
          type: argDef?.type ?? 'str',
          default: argDef?.default,
          required: argDef?.required ?? false,
          help: argDef?.description ?? argDef?.help ?? '',
          choices: argDef?.choices,
        });
      }
    }

    return {
      site: def.site ?? site,
      name: def.name ?? path.basename(filePath, path.extname(filePath)),
      description: def.description ?? '',
      domain: def.domain,
      strategy: strategy.toLowerCase(),
      browser,
      args,
      columns: def.columns,
      pipeline: def.pipeline,
      timeout: def.timeout,
      type: 'yaml',
      navigateBefore: def.navigateBefore,
    };
  } catch (err: any) {
    process.stderr.write(`Warning: failed to parse ${filePath}: ${err.message}\n`);
    return null;
  }
}

function scanTs(filePath: string, site: string): ManifestEntry | null {
  // TS adapters self-register via cli() at import time.
  // We statically parse the source to extract metadata for the manifest stub.
  const baseName = path.basename(filePath, path.extname(filePath));
  const relativePath = `${site}/${baseName}.js`;

  try {
    const src = fs.readFileSync(filePath, 'utf-8');

    // Helper/test modules should not appear as CLI commands in the manifest.
    if (!/\bcli\s*\(/.test(src)) return null;

    const entry: ManifestEntry = {
      site,
      name: baseName,
      description: '',
      strategy: 'cookie',
      browser: true,
      args: [],
      type: 'ts',
      modulePath: relativePath,
    };

    // Extract description
    const descMatch = src.match(/description\s*:\s*['"`]([^'"`]*)['"`]/);
    if (descMatch) entry.description = descMatch[1];

    // Extract domain
    const domainMatch = src.match(/domain\s*:\s*['"`]([^'"`]*)['"`]/);
    if (domainMatch) entry.domain = domainMatch[1];

    // Extract strategy
    const stratMatch = src.match(/strategy\s*:\s*Strategy\.(\w+)/);
    if (stratMatch) entry.strategy = stratMatch[1].toLowerCase();

    // Extract browser: false (some adapters bypass browser entirely)
    const browserMatch = src.match(/browser\s*:\s*(true|false)/);
    if (browserMatch) entry.browser = browserMatch[1] === 'true';
    else entry.browser = entry.strategy !== 'public';

    // Extract columns
    const colMatch = src.match(/columns\s*:\s*\[([^\]]*)\]/);
    if (colMatch) {
      entry.columns = colMatch[1].split(',').map(s => s.trim().replace(/^['"`]|['"`]$/g, '')).filter(Boolean);
    }

    // Extract args array items: { name: '...', ... }
    const argsBlock = extractTsArgsBlock(src);
    if (argsBlock) {
      entry.args = parseTsArgsBlock(argsBlock);
    }

    // Extract navigateBefore: false
    const navMatch = src.match(/navigateBefore\s*:\s*(true|false)/);
    if (navMatch) entry.navigateBefore = navMatch[1] === 'true' ? true : false;

    return entry;
  } catch (err: any) {
    // If parsing fails, log a warning (matching scanYaml behaviour) and skip the entry.
    process.stderr.write(`Warning: failed to scan ${filePath}: ${err.message}\n`);
    return null;
  }
}

export function buildManifest(): ManifestEntry[] {
  const manifest: ManifestEntry[] = [];

  if (fs.existsSync(CLIS_DIR)) {
    for (const site of fs.readdirSync(CLIS_DIR)) {
      const siteDir = path.join(CLIS_DIR, site);
      if (!fs.statSync(siteDir).isDirectory()) continue;
      for (const file of fs.readdirSync(siteDir)) {
        const filePath = path.join(siteDir, file);
        if (file.endsWith('.yaml') || file.endsWith('.yml')) {
          const entry = scanYaml(filePath, site);
          if (entry) manifest.push(entry);
        } else if (
          (file.endsWith('.ts') && !file.endsWith('.d.ts') && !file.endsWith('.test.ts') && file !== 'index.ts') ||
          (file.endsWith('.js') && !file.endsWith('.d.js') && !file.endsWith('.test.js') && file !== 'index.js')
        ) {
          const entry = scanTs(filePath, site);
          if (entry) manifest.push(entry);
        }
      }
    }
  }

  return manifest;
}

function main(): void {
  const manifest = buildManifest();
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(manifest, null, 2));

  const yamlCount = manifest.filter(e => e.type === 'yaml').length;
  const tsCount = manifest.filter(e => e.type === 'ts').length;
  console.log(`✅ Manifest compiled: ${manifest.length} entries (${yamlCount} YAML, ${tsCount} TS) → ${OUTPUT}`);
}

const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entrypoint === import.meta.url) {
  main();
}
