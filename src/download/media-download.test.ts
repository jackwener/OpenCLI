import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { downloadMedia } from './media-download.js';

const servers: http.Server[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  })));
  servers.length = 0;

  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tempDirs.length = 0;
});

async function startServer(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start test server');
  }
  return `http://127.0.0.1:${address.port}`;
}

describe('media downloads', () => {
  it('keeps custom filenames inside the output directory', async () => {
    const baseUrl = await startServer((_req, res) => {
      res.statusCode = 200;
      res.end('image');
    });
    const parentDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-media-parent-'));
    tempDirs.push(parentDir);
    const outputDir = path.join(parentDir, 'downloads');

    const results = await downloadMedia([
      { type: 'image', url: `${baseUrl}/image.jpg`, filename: '../escape.jpg' },
    ], {
      output: outputDir,
      verbose: false,
    });

    expect(results).toEqual([
      { index: 1, type: 'image', status: 'success', size: '5.0 B' },
    ]);
    expect(fs.readFileSync(path.join(outputDir, 'escape.jpg'), 'utf8')).toBe('image');
    expect(fs.existsSync(path.join(parentDir, 'escape.jpg'))).toBe(false);
  });
});
