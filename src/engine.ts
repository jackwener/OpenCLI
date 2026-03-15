/**
 * CLI discovery: finds YAML/TS CLI definitions and registers them.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import yaml from 'js-yaml';
import { type CliCommand, type Arg, Strategy, registerCommand } from './registry.js';
import type { IPage } from './types.js';
import { executePipeline } from './pipeline.js';

export function discoverClis(...dirs: string[]): void {
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const site of fs.readdirSync(dir)) {
      const siteDir = path.join(dir, site);
      if (!fs.statSync(siteDir).isDirectory()) continue;
      for (const file of fs.readdirSync(siteDir)) {
        const filePath = path.join(siteDir, file);
        if (file.endsWith('.yaml') || file.endsWith('.yml')) {
          registerYamlCli(filePath, site);
        }
      }
    }
  }
}

function registerYamlCli(filePath: string, defaultSite: string): void {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const def = yaml.load(raw) as any;
    if (!def || typeof def !== 'object') return;

    const site = def.site ?? defaultSite;
    const name = def.name ?? path.basename(filePath, path.extname(filePath));
    const strategyStr = def.strategy ?? (def.browser === false ? 'public' : 'cookie');
    const strategy = (Strategy as any)[strategyStr.toUpperCase()] ?? Strategy.COOKIE;
    const browser = def.browser ?? (strategy !== Strategy.PUBLIC);

    const args: Arg[] = [];
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

    const cmd: CliCommand = {
      site,
      name,
      description: def.description ?? '',
      domain: def.domain,
      strategy,
      browser,
      args,
      columns: def.columns,
      pipeline: def.pipeline,
      timeoutSeconds: def.timeout,
      source: filePath,
    };

    registerCommand(cmd);
  } catch (err: any) {
    process.stderr.write(`Warning: failed to load ${filePath}: ${err.message}\n`);
  }
}

export async function executeCommand(
  cmd: CliCommand,
  page: IPage | null,
  kwargs: Record<string, any>,
  debug: boolean = false,
): Promise<any> {
  if (cmd.func) {
    return cmd.func(page, kwargs, debug);
  }
  if (cmd.pipeline) {
    return executePipeline(page, cmd.pipeline, { args: kwargs, debug });
  }
  throw new Error(`Command ${cmd.site}/${cmd.name} has no func or pipeline`);
}
