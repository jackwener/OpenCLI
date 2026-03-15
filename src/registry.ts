/**
 * Core registry: Strategy enum, Arg/CliCommand interfaces, cli() registration.
 */

import type { IPage } from './types.js';

export enum Strategy {
  PUBLIC = 'public',
  COOKIE = 'cookie',
  HEADER = 'header',
  INTERCEPT = 'intercept',
  UI = 'ui',
}

export interface Arg {
  name: string;
  type?: string;
  default?: any;
  required?: boolean;
  help?: string;
  choices?: string[];
}

export interface CliCommand {
  site: string;
  name: string;
  description: string;
  domain?: string;
  strategy?: Strategy;
  browser?: boolean;
  args: Arg[];
  columns?: string[];
  func?: (page: IPage | null, kwargs: Record<string, any>, debug?: boolean) => Promise<any>;
  pipeline?: any[];
  timeoutSeconds?: number;
  source?: string;
}

export interface CliOptions {
  site: string;
  name: string;
  description?: string;
  domain?: string;
  strategy?: Strategy;
  browser?: boolean;
  args?: Arg[];
  columns?: string[];
  func?: (page: IPage | null, kwargs: Record<string, any>, debug?: boolean) => Promise<any>;
  pipeline?: any[];
  timeoutSeconds?: number;
}

const _registry = new Map<string, CliCommand>();

export function cli(opts: CliOptions): CliCommand {
  const cmd: CliCommand = {
    site: opts.site,
    name: opts.name,
    description: opts.description ?? '',
    domain: opts.domain,
    strategy: opts.strategy ?? (opts.browser === false ? Strategy.PUBLIC : Strategy.COOKIE),
    browser: opts.browser ?? (opts.strategy === Strategy.PUBLIC ? false : true),
    args: opts.args ?? [],
    columns: opts.columns,
    func: opts.func,
    pipeline: opts.pipeline,
    timeoutSeconds: opts.timeoutSeconds,
  };

  const key = fullName(cmd);
  _registry.set(key, cmd);
  return cmd;
}

export function getRegistry(): Map<string, CliCommand> {
  return _registry;
}

export function fullName(cmd: CliCommand): string {
  return `${cmd.site}/${cmd.name}`;
}

export function strategyLabel(cmd: CliCommand): string {
  return cmd.strategy ?? 'public';
}

export function registerCommand(cmd: CliCommand): void {
  _registry.set(fullName(cmd), cmd);
}
