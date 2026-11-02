import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);

describe('paginated adapters through the compiled CLI', () => {
  let server: Server;
  let origin: string;
  let configDir: string;

  beforeAll(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'opencli-pagination-e2e-'));
    await mkdir(join(configDir, 'clis'));
    server = createServer((request, response) => {
      const url = new URL(request.url!, 'http://localhost');
      const cursor = url.searchParams.get('cursor');
      if (url.pathname === '/broken' && cursor === '2') {
        response.writeHead(503).end('temporarily unavailable');
        return;
      }
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(cursor === '1'
        ? { items: [{ id: 1 }, { id: 2 }, { id: 3 }], next: '2' }
        : { items: [{ id: 4 }], next: null }));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No fixture server port');
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (configDir) await rm(configDir, { recursive: true, force: true });
  });

  async function run(args: string[]) {
    const registryUrl = pathToFileURL(resolve('dist/src/registry.js')).href;
    const cliUrl = pathToFileURL(resolve('dist/src/cli.js')).href;
    // Exercise actual Commander wiring and command execution with a fixture adapter.
    // No discovery of personal adapters or real browser session is needed.
    const source = `
      import { cli, Strategy } from ${JSON.stringify(registryUrl)};
      import { createProgram } from ${JSON.stringify(cliUrl)};
      const origin = ${JSON.stringify(origin)};
      for (const name of ['list', 'complete', 'broken']) cli({
        site: 'pagination-fixture', name, access: 'read', browser: false, strategy: Strategy.PUBLIC,
        args: [
          { name: 'limit', type: 'int', default: 10 },
          { name: 'cursor', default: '1' },
          { name: 'skip', type: 'int', default: 0 },
        ],
        pipeline: [{ paginate: {
          request: { url: origin + (name === 'broken' ? '/broken' : '/items'), params: { cursor: '\u0024{{ pagination.value }}' } },
          initial: '\u0024{{ args.cursor }}', skip: '\u0024{{ args.skip }}', maxItems: '\u0024{{ args.limit }}',
          items: '\u0024{{ data.items }}', next: '\u0024{{ data.next }}', requireComplete: name === 'complete',
        } }],
      });
      await createProgram('', '').parseAsync(['node', 'opencli', 'pagination-fixture', ...process.argv.slice(1)]);
    `;
    try {
      const result = await exec(process.execPath, ['--input-type=module', '-e', source, '--', ...args], {
        timeout: 10_000,
        env: { ...process.env, OPENCLI_CONFIG_DIR: configDir, OPENCLI_VERBOSE: '', NO_COLOR: '1' },
      });
      return { code: 0, envelope: JSON.parse(result.stdout) };
    } catch (error) {
      const result = error as { code: number; stdout: string };
      return { code: result.code, envelope: JSON.parse(result.stdout) };
    }
  }

  it('returns all pages and completion metadata through the JSON envelope', async () => {
    const result = await run(['list']);
    expect(result.code).toBe(0);
    expect(result.envelope).toMatchObject({ ok: true, data: {
      items: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
      pagination: { pages: 2, complete: true, resume: null },
    } });
  });

  it('resumes a capped command using its returned value and raw-row skip', async () => {
    const first = await run(['list', '--limit', '2']);
    expect(first.code).toBe(0);
    const checkpoint = first.envelope.data.pagination.resume;
    expect(checkpoint).toEqual({ value: '1', skip: 2 });
    const second = await run(['list', '--cursor', checkpoint.value, '--skip', String(checkpoint.skip)]);
    expect(second.code).toBe(0);
    expect(second.envelope.data.items).toEqual([{ id: 3 }, { id: 4 }]);
    expect(second.envelope.data.pagination.complete).toBe(true);
  });

  it('emits a typed failure and nonzero exit for a required-complete result that hits a bound', async () => {
    const result = await run(['complete', '--limit', '2']);
    expect(result.code).toBe(1);
    expect(result.envelope).toMatchObject({ ok: false, error: { code: 'PAGINATION_LIMIT' } });
    expect(result.envelope).not.toHaveProperty('data');
  });

  it('does not mask a second-page HTTP failure as partial success', async () => {
    const result = await run(['broken']);
    expect(result.code).toBe(1);
    expect(result.envelope).toMatchObject({ ok: false, error: { code: 'FETCH_ERROR' } });
  });
});
