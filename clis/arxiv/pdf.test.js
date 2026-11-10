import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';

// Mock the network layer before importing the adapter: these tests exercise what
// pdf.js does with the response, not how the bytes are fetched.
const { mockHttpDownload } = vi.hoisted(() => ({ mockHttpDownload: vi.fn() }));
vi.mock('@jackwener/opencli/download', () => ({ httpDownload: mockHttpDownload }));

await import('./pdf.js');

const PDF_BODY = '%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n';
const tempDirs = [];
let cmd;

beforeAll(() => {
  cmd = getRegistry().get('arxiv/pdf');
  expect(cmd?.func).toBeTypeOf('function');
});

async function makeOutputDir() {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'arxiv-pdf-'));
  tempDirs.push(dir);
  return dir;
}

function respondWith(body, contentType) {
  mockHttpDownload.mockImplementation(async (_url, destPath) => {
    await fs.promises.writeFile(destPath, body);
    return {
      success: true,
      size: Buffer.byteLength(body),
      ...(contentType === undefined ? {} : { contentType }),
    };
  });
}

afterEach(async () => {
  mockHttpDownload.mockReset();
  for (const dir of tempDirs) {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe('arxiv pdf', () => {
  it('installs a verified PDF and reports the downloaded file', async () => {
    const dir = await makeOutputDir();
    respondWith(PDF_BODY, 'application/pdf');

    const [row] = await cmd.func({ id: '1706.03762', output: dir });

    expect(row).toMatchObject({
      id: '1706.03762',
      status: 'downloaded',
      bytes: Buffer.byteLength(PDF_BODY),
      url: 'https://arxiv.org/pdf/1706.03762',
    });
    expect(fs.readFileSync(path.join(dir, '1706.03762.pdf'), 'utf8')).toBe(PDF_BODY);
    expect(fs.readdirSync(dir)).toEqual(['1706.03762.pdf']);
  });

  it('flattens legacy IDs into a single output directory', async () => {
    const dir = await makeOutputDir();
    respondWith(PDF_BODY, 'application/pdf');

    const [row] = await cmd.func({ id: 'cs/0701001', output: dir });

    expect(row.path).toMatch(/cs_0701001\.pdf$/);
    expect(fs.readdirSync(dir)).toEqual(['cs_0701001.pdf']);
  });

  it('rejects an HTML error page and leaves no file at the destination', async () => {
    const dir = await makeOutputDir();
    respondWith('<html>not found</html>', 'text/html');

    await expect(cmd.func({ id: '1706.03762', output: dir })).rejects.toThrow(CommandExecutionError);
    expect(fs.existsSync(path.join(dir, '1706.03762.pdf'))).toBe(false);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('rejects an HTML body when the server omits the content type', async () => {
    const dir = await makeOutputDir();
    respondWith('<html>not found</html>');

    await expect(cmd.func({ id: '1706.03762', output: dir })).rejects.toThrow('Expected a PDF');
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('rejects a response that claims application/pdf but is not a PDF', async () => {
    const dir = await makeOutputDir();
    respondWith('<html>not found</html>', 'application/pdf');

    await expect(cmd.func({ id: '1706.03762', output: dir })).rejects.toThrow('Expected a PDF');
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('keeps an existing valid PDF when a later download fails', async () => {
    const dir = await makeOutputDir();
    const destPath = path.join(dir, '1706.03762.pdf');
    await fs.promises.writeFile(destPath, PDF_BODY);

    respondWith('<html>rate limited</html>', 'text/html');

    await expect(cmd.func({ id: '1706.03762', output: dir })).rejects.toThrow(CommandExecutionError);
    expect(fs.readFileSync(destPath, 'utf8')).toBe(PDF_BODY);
    expect(fs.readdirSync(dir)).toEqual(['1706.03762.pdf']);
  });

  it('surfaces a failed download and leaves the destination untouched', async () => {
    const dir = await makeOutputDir();
    mockHttpDownload.mockResolvedValue({ success: false, size: 0, error: 'HTTP 404' });

    await expect(cmd.func({ id: '1706.03762', output: dir })).rejects.toThrow('HTTP 404');
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
