import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserConnectError, CliError } from '../errors.js';
import { isRecord } from '../utils.js';

const DEFAULT_ROUND_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

/** Run one UTF-8 script through Ego's installed CLI, without a shell or a CDP port. */
export async function runEgo<T>(
  body: string,
  input: unknown,
  timeoutMs = DEFAULT_ROUND_TIMEOUT_MS,
): Promise<T> {
  const script = `
const input = ${JSON.stringify(input)};
let result;
try {
  result = { ok: true, value: await (async () => { ${body} })() };
} catch (error) {
  result = { ok: false, code: error?.code, message: error?.message ?? String(error) };
}
`;
  const response = process.platform === 'win32'
    ? await runEgoModule(script, timeoutMs)
    : await runEgoStdin(script, timeoutMs);

  let result: unknown;
  try {
    result = JSON.parse(response);
  } catch {
    throw new BrowserConnectError('Ego Lite returned an unreadable script result.');
  }
  if (!isRecord(result) || typeof result.ok !== 'boolean') {
    throw new BrowserConnectError('Ego Lite returned an invalid script result.');
  }
  if (!result.ok) {
    throw new CliError(typeof result.code === 'string' ? result.code : 'EGO_COMMAND',
      typeof result.message === 'string' ? result.message : 'Ego Lite rejected the operation.');
  }
  return result.value as T;
}

interface EgoLauncherOutput {
  stdout: string;
  stderr: string;
}

function launchEgo(args: string[], timeoutMs: number, input?: string): Promise<EgoLauncherOutput> {
  const executable = process.env.OPENCLI_EGO_BROWSER || 'ego-browser';
  return new Promise((resolve, reject) => {
    const child = execFile(executable, args, {
      encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL',
      maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true,
    }, (error, stdout, stderr) => {
      if (!error) {
        resolve({ stdout, stderr });
      } else if (error.code === 'ENOENT') {
        reject(new BrowserConnectError('ego-browser was not found.',
          'Install and open Ego Lite, or set OPENCLI_EGO_BROWSER to its executable path.'));
      } else {
        // The wrapper can exit before the embedded runtime finishes. Never replay.
        reject(new CliError('EGO_ROUND_FAILED',
          error.killed ? 'Ego browser command timed out. Its outcome may be unknown.' :
            `Ego browser command failed (${error.code ?? error.signal ?? 'unknown status'}).`,
          'Check that Ego Lite is running. Inspect the Space before retrying an action.'));
      }
    });
    // An early launcher failure can close stdin while the script is being written.
    child.stdin?.on('error', () => {});
    child.stdin?.end(input, 'utf8');
  });
}

function missingResult(output: EgoLauncherOutput, transport: string): BrowserConnectError {
  const stdoutBytes = Buffer.byteLength(output.stdout);
  const stderrBytes = Buffer.byteLength(output.stderr);
  return new BrowserConnectError(
    `Ego Lite did not return a script result (${transport}, exit 0, stdout ${stdoutBytes} bytes, stderr ${stderrBytes} bytes).`,
    'With Ego Lite open, run: ego-browser nodejs -e "console.log(typeof taskSpace)". Expected: function.');
}

async function runEgoStdin(script: string, timeoutMs: number): Promise<string> {
  const marker = `__OPENCLI_${randomUUID()}__`;
  const output = await launchEgo(['nodejs'], timeoutMs,
    script + `console.log(${JSON.stringify(marker)} + JSON.stringify(result));\n`);
  const response = output.stdout.split(/\r?\n/).find(line => line.startsWith(marker));
  if (!response) {
    throw missingResult(output, 'stdin');
  }
  return response.slice(marker.length);
}

async function runEgoModule(script: string, timeoutMs: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'opencli-ego-'));
  const scriptPath = join(dir, 'round.mjs');
  const resultPath = join(dir, 'result.json');
  try {
    await writeFile(scriptPath, script + `
const { writeFile } = await import('node:fs/promises');
const json = JSON.stringify(result);
if (Buffer.byteLength(json) > ${MAX_OUTPUT_BYTES}) throw new Error('Ego script result exceeds the size limit');
await writeFile(${JSON.stringify(resultPath)}, json, 'utf8');
`, 'utf8');
    // Only an ASCII loader travels through the Windows command line.
    const scriptUrl = pathToFileURL(scriptPath).href.replaceAll("'", '%27');
    const output = await launchEgo(['nodejs', '-e', `await import('${scriptUrl}')`], timeoutMs);
    try {
      if ((await stat(resultPath)).size > MAX_OUTPUT_BYTES) {
        throw new BrowserConnectError('Ego Lite script result exceeds the size limit.');
      }
      return await readFile(resultPath, 'utf8');
    } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT') throw missingResult(output, 'Windows file');
      throw error;
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
