import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import yaml from 'js-yaml';

const {
  mockExploreUrl,
  mockLoadExploreBundle,
  mockSynthesizeFromExplore,
  mockBrowserSession,
  mockCascadeProbe,
  mockExecuteCommand,
  mockRegisterCommand,
} = vi.hoisted(() => ({
  mockExploreUrl: vi.fn(),
  mockLoadExploreBundle: vi.fn(),
  mockSynthesizeFromExplore: vi.fn(),
  mockBrowserSession: vi.fn(),
  mockCascadeProbe: vi.fn(),
  mockExecuteCommand: vi.fn(),
  mockRegisterCommand: vi.fn(),
}));

vi.mock('./explore.js', () => ({
  exploreUrl: mockExploreUrl,
}));

vi.mock('./synthesize.js', () => ({
  loadExploreBundle: mockLoadExploreBundle,
  synthesizeFromExplore: mockSynthesizeFromExplore,
}));

vi.mock('./runtime.js', () => ({
  browserSession: mockBrowserSession,
}));

vi.mock('./cascade.js', () => ({
  cascadeProbe: mockCascadeProbe,
}));

vi.mock('./execution.js', () => ({
  executeCommand: mockExecuteCommand,
}));

vi.mock('./registry.js', async () => {
  const actual = await vi.importActual<typeof import('./registry.js')>('./registry.js');
  return {
    ...actual,
    registerCommand: mockRegisterCommand,
  };
});

vi.mock('./discovery.js', () => ({
  USER_CLIS_DIR: '/tmp/opencli-user-clis',
}));

import { Strategy } from './registry.js';
import { generateVerifiedFromUrl } from './generate-verified.js';

describe('generateVerifiedFromUrl', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-generate-verified-'));
    mockExploreUrl.mockReset();
    mockLoadExploreBundle.mockReset();
    mockSynthesizeFromExplore.mockReset();
    mockBrowserSession.mockReset();
    mockCascadeProbe.mockReset();
    mockExecuteCommand.mockReset();
    mockRegisterCommand.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns blocked when explore finds no API endpoints', async () => {
    mockExploreUrl.mockResolvedValue({
      site: 'demo',
      target_url: 'https://demo.test',
      final_url: 'https://demo.test',
      title: 'Demo',
      framework: {},
      stores: [],
      top_strategy: 'public',
      endpoint_count: 0,
      api_endpoint_count: 0,
      capabilities: [],
      auth_indicators: [],
      out_dir: tempDir,
    });
    mockLoadExploreBundle.mockReturnValue({
      manifest: { site: 'demo', target_url: 'https://demo.test', final_url: 'https://demo.test' },
      endpoints: [],
      capabilities: [],
    });

    const result = await generateVerifiedFromUrl({
      url: 'https://demo.test',
      BrowserFactory: class {} as never,
      noRegister: true,
    });

    expect(result).toEqual(expect.objectContaining({
      status: 'blocked',
      reason: 'no-api-discovered',
    }));
    expect(mockSynthesizeFromExplore).not.toHaveBeenCalled();
  });

  it('returns success after verifying a generated candidate', async () => {
    const candidatePath = path.join(tempDir, 'hot.yaml');
    fs.writeFileSync(candidatePath, yaml.dump({
      site: 'demo',
      name: 'hot',
      description: 'demo hot',
      domain: 'demo.test',
      strategy: 'public',
      browser: false,
      args: {
        limit: { type: 'int', default: 20 },
      },
      columns: ['title', 'url'],
      pipeline: [
        { fetch: { url: 'https://demo.test/api/hot?limit=${{ args.limit | default(20) }}' } },
        { select: 'data.items' },
        { map: { rank: '${{ index + 1 }}', title: '${{ item.title }}', url: '${{ item.url }}' } },
        { limit: '${{ args.limit | default(20) }}' },
      ],
    }, { sortKeys: false }));

    mockExploreUrl.mockResolvedValue({
      site: 'demo',
      target_url: 'https://demo.test',
      final_url: 'https://demo.test/home',
      title: 'Demo',
      framework: {},
      stores: [],
      top_strategy: 'cookie',
      endpoint_count: 2,
      api_endpoint_count: 2,
      capabilities: [{ name: 'hot' }],
      auth_indicators: [],
      out_dir: tempDir,
    });
    mockLoadExploreBundle.mockReturnValue({
      manifest: { site: 'demo', target_url: 'https://demo.test', final_url: 'https://demo.test/home' },
      endpoints: [{
        pattern: 'demo.test/api/hot',
        url: 'https://demo.test/api/hot?limit=20',
        itemPath: 'data.items',
        itemCount: 5,
        detectedFields: { title: 'title', url: 'url' },
      }],
      capabilities: [{ name: 'hot', strategy: 'public', endpoint: 'demo.test/api/hot', itemPath: 'data.items' }],
    });
    mockBrowserSession.mockImplementation(async (_factory, fn) => fn({
      goto: vi.fn(),
    }));
    mockCascadeProbe.mockResolvedValue({
      bestStrategy: Strategy.COOKIE,
      probes: [{ strategy: Strategy.COOKIE, success: true }],
      confidence: 0.9,
    });
    mockSynthesizeFromExplore.mockReturnValue({
      site: 'demo',
      explore_dir: tempDir,
      out_dir: tempDir,
      candidate_count: 1,
      candidates: [{ name: 'hot', path: candidatePath, strategy: 'public' }],
    });
    mockExecuteCommand.mockResolvedValue([{ title: 'hello', url: 'https://demo.test/item/1' }]);

    const result = await generateVerifiedFromUrl({
      url: 'https://demo.test',
      BrowserFactory: class {} as never,
      noRegister: false,
    });

    expect(result.status).toBe('success');
    expect(mockExecuteCommand).toHaveBeenCalledTimes(1);
    expect(mockExecuteCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        strategy: Strategy.COOKIE,
        browser: true,
      }),
      expect.any(Object),
      false,
    );
    expect(mockRegisterCommand).toHaveBeenCalledTimes(1);
  });

  it('returns needs-human-check after repair attempts are exhausted', async () => {
    const candidatePath = path.join(tempDir, 'search.yaml');
    fs.writeFileSync(candidatePath, yaml.dump({
      site: 'demo',
      name: 'search',
      description: 'demo search',
      domain: 'demo.test',
      strategy: 'cookie',
      browser: true,
      args: {
        keyword: { type: 'str', required: true },
        limit: { type: 'int', default: 20 },
      },
      columns: ['title', 'url'],
      pipeline: [
        { navigate: 'https://demo.test' },
        { evaluate: '(async () => [])()' },
        { map: { title: '${{ item.title }}', url: '${{ item.url }}' } },
        { limit: '${{ args.limit | default(20) }}' },
      ],
    }, { sortKeys: false }));

    mockExploreUrl.mockResolvedValue({
      site: 'demo',
      target_url: 'https://demo.test/search',
      final_url: 'https://demo.test/search',
      title: 'Demo Search',
      framework: {},
      stores: [],
      top_strategy: 'cookie',
      endpoint_count: 1,
      api_endpoint_count: 1,
      capabilities: [{ name: 'search' }],
      auth_indicators: [],
      out_dir: tempDir,
    });
    mockLoadExploreBundle.mockReturnValue({
      manifest: { site: 'demo', target_url: 'https://demo.test/search', final_url: 'https://demo.test/search' },
      endpoints: [{
        pattern: 'demo.test/api/search',
        url: 'https://demo.test/api/search?q=test',
        itemPath: 'payload.results',
        itemCount: 10,
        detectedFields: { title: 'headline', url: 'permalink' },
      }],
      capabilities: [{ name: 'search', strategy: 'cookie', endpoint: 'demo.test/api/search', itemPath: 'payload.results' }],
    });
    mockBrowserSession.mockImplementation(async (_factory, fn) => fn({
      goto: vi.fn(),
    }));
    mockCascadeProbe.mockResolvedValue({
      bestStrategy: Strategy.COOKIE,
      probes: [{ strategy: Strategy.COOKIE, success: true }],
      confidence: 0.9,
    });
    mockSynthesizeFromExplore.mockReturnValue({
      site: 'demo',
      explore_dir: tempDir,
      out_dir: tempDir,
      candidate_count: 1,
      candidates: [{ name: 'search', path: candidatePath, strategy: 'cookie' }],
    });
    mockExecuteCommand
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await generateVerifiedFromUrl({
      url: 'https://demo.test/search',
      BrowserFactory: class {} as never,
      noRegister: true,
    });

    expect(result).toEqual(expect.objectContaining({
      status: 'needs-human-check',
      issue: 'empty-result',
    }));
    expect(mockExecuteCommand).toHaveBeenCalledTimes(2);
  });
});
