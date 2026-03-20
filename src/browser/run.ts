import { spawn } from 'node:child_process';
import { normalizeBrowserMode } from './backend.js';

export type BrowserRunOptions = {
  backend?: string;
  cdpEndpoint?: string;
  cdpTarget?: string;
  forwardedArgs: string[];
  entryScript?: string;
  execPath?: string;
  execArgv?: string[];
  env?: NodeJS.ProcessEnv;
};

export function extractPassthroughArgs(argv: string[] = process.argv): string[] {
  const separatorIndex = argv.indexOf('--');
  return separatorIndex === -1 ? [] : argv.slice(separatorIndex + 1);
}

export function buildBrowserRunEnv(opts: {
  backend?: string;
  cdpEndpoint?: string;
  cdpTarget?: string;
  env?: NodeJS.ProcessEnv;
} = {}): NodeJS.ProcessEnv {
  const env = { ...(opts.env ?? process.env) };
  env.OPENCLI_BROWSER_MODE = normalizeBrowserMode(opts.backend ?? env.OPENCLI_BROWSER_MODE);
  if (opts.cdpEndpoint !== undefined) env.OPENCLI_CDP_ENDPOINT = opts.cdpEndpoint;
  if (opts.cdpTarget !== undefined) env.OPENCLI_CDP_TARGET = opts.cdpTarget;
  return env;
}

function validateForwardedArgs(forwardedArgs: string[]): void {
  if (forwardedArgs.length === 0) {
    throw new Error(
      'Missing command after --. Example:\n' +
      '  opencli browser run --backend cdp --cdp-endpoint http://127.0.0.1:9222 -- zhihu search --keyword AI',
    );
  }

  if (forwardedArgs[0] === 'browser') {
    throw new Error('`opencli browser run` only forwards existing opencli commands outside the `browser` command group.');
  }
}

export async function runOpenCliWithBrowserBackend(opts: BrowserRunOptions): Promise<number> {
  validateForwardedArgs(opts.forwardedArgs);

  const entryScript = opts.entryScript ?? process.argv[1];
  if (!entryScript) {
    throw new Error('Cannot determine the current opencli entry script.');
  }

  return await new Promise<number>((resolve, reject) => {
    const child = spawn(
      opts.execPath ?? process.execPath,
      [...(opts.execArgv ?? process.execArgv), entryScript, ...opts.forwardedArgs],
      {
        stdio: 'inherit',
        env: buildBrowserRunEnv(opts),
      },
    );

    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (signal) {
        reject(new Error(`Forwarded command exited via signal: ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}
