import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IPage } from './types.js';

const {
  mockExploreUrl,
  mockLoadExploreBundle,
  mockSynthesizeFromExplore,
  mockBrowserSession,
  mockCascadeProbe,
  mockExecutePipeline,
  mockRegisterCommand,
} = vi.hoisted(() => ({
  mockExploreUrl: vi.fn(),
  mockLoadExploreBundle: vi.fn(),
  mockSynthesizeFromExplore: vi.fn(),
  mockBrowserSession: vi.fn(),
  mockCascadeProbe: vi.fn(),
  mockExecutePipeline: vi.fn(),
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

vi.mock('./pipeline/index.js', () => ({
  executePipeline: mockExecutePipeline,
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
import { generateVerifiedFromUrl, type GenerateOutcome, type EarlyHint } from './generate-verified.js';

describe('generateVerifiedFromUrl', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-generate-verified-'));
    mockExploreUrl.mockReset();
    mockLoadExploreBundle.mockReset();
    mockSynthesizeFromExplore.mockReset();
    mockBrowserSession.mockReset();
    mockCascadeProbe.mockReset();
    mockExecutePipeline.mockReset();
    mockRegisterCommand.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ── Blocked outcomes ──────────────────────────────────────────────────────

  it('returns blocked with no-viable-api-surface when discover finds no API endpoints', async () => {
    mockExploreUrl.mockResolvedValue({
      site: 'demo',
      target_url: 'https://demo.test',
      final_url: 'https://demo.test',
      title: 'Demo',
      framework: {},
      stores: [],
      top_strategy: 'public',
      endpoint_count: 1,
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
    mockSynthesizeFromExplore.mockReturnValue({
      site: 'demo',
      explore_dir: tempDir,
      out_dir: tempDir,
      candidate_count: 0,
      candidates: [],
    });

    const result = await generateVerifiedFromUrl({
      url: 'https://demo.test',
      BrowserFactory: class {} as never,
      noRegister: true,
    });

    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('no-viable-api-surface');
    expect(result.stage).toBe('explore');
    expect(result.confidence).toBe('high');
    expect(result.message).toBeDefined();
    expect(result.stats.api_endpoint_count).toBe(0);
    expect(mockBrowserSession).not.toHaveBeenCalled();
  });

  it('returns blocked with auth-too-complex when no PUBLIC/COOKIE probe succeeds', async () => {
    const candidatePath = path.join(tempDir, 'hot.json');
    fs.writeFileSync(candidatePath, JSON.stringify({
      site: 'demo',
      name: 'hot',
      description: 'demo hot',
      domain: 'demo.test',
      strategy: 'public',
      browser: false,
      args: {},
      columns: ['title', 'url'],
      pipeline: [
        { fetch: { url: 'https://demo.test/api/hot' } },
        { select: 'data.items' },
      ],
    }, null, 2));

    mockExploreUrl.mockResolvedValue({
      site: 'demo',
      target_url: 'https://demo.test',
      final_url: 'https://demo.test',
      title: 'Demo',
      framework: {},
      stores: [],
      top_strategy: 'cookie',
      endpoint_count: 1,
      api_endpoint_count: 1,
      capabilities: [{ name: 'hot' }],
      auth_indicators: [],
      out_dir: tempDir,
    });
    mockLoadExploreBundle.mockReturnValue({
      manifest: { site: 'demo', target_url: 'https://demo.test', final_url: 'https://demo.test' },
      endpoints: [{
        pattern: 'demo.test/api/hot',
        url: 'https://demo.test/api/hot',
        itemPath: 'data.items',
        itemCount: 5,
        detectedFields: { title: 'title', url: 'url' },
      }],
      capabilities: [{ name: 'hot', strategy: 'cookie', endpoint: 'demo.test/api/hot', itemPath: 'data.items' }],
    });
    mockSynthesizeFromExplore.mockReturnValue({
      site: 'demo',
      explore_dir: tempDir,
      out_dir: tempDir,
      candidate_count: 1,
      candidates: [{ name: 'hot', path: candidatePath, strategy: 'public' }],
    });

    const page = { goto: vi.fn() } as unknown as IPage;
    mockBrowserSession.mockImplementation(async (_factory, fn) => fn(page));
    mockCascadeProbe.mockResolvedValue({
      bestStrategy: Strategy.COOKIE,
      probes: [
        { strategy: Strategy.PUBLIC, success: false },
        { strategy: Strategy.COOKIE, success: false },
      ],
      confidence: 0.3,
    });

    const result = await generateVerifiedFromUrl({
      url: 'https://demo.test',
      BrowserFactory: class {} as never,
      noRegister: true,
    });

    expect(mockExecutePipeline).not.toHaveBeenCalled();
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('auth-too-complex');
    expect(result.stage).toBe('cascade');
    expect(result.confidence).toBe('high');
  });

  // ── Success outcomes ──────────────────────────────────────────────────────

  it('verifies the selected candidate in a single session and registers on success with sidecar metadata', async () => {
    const hotPath = path.join(tempDir, 'hot.json');
    const searchPath = path.join(tempDir, 'search.json');

    fs.writeFileSync(hotPath, JSON.stringify({
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
    }, null, 2));

    fs.writeFileSync(searchPath, JSON.stringify({
      site: 'demo',
      name: 'search',
      description: 'demo search',
      domain: 'demo.test',
      strategy: 'public',
      browser: false,
      args: {
        keyword: { type: 'str', required: true },
      },
      columns: ['title', 'url'],
      pipeline: [
        { fetch: { url: 'https://demo.test/api/search?q=${{ args.keyword }}' } },
        { select: 'payload.items' },
        { map: { title: '${{ item.title }}', url: '${{ item.url }}' } },
      ],
    }, null, 2));

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
      capabilities: [{ name: 'hot' }, { name: 'search' }],
      auth_indicators: [],
      out_dir: tempDir,
    });
    mockLoadExploreBundle.mockReturnValue({
      manifest: { site: 'demo', target_url: 'https://demo.test', final_url: 'https://demo.test/home' },
      endpoints: [
        {
          pattern: 'demo.test/api/hot',
          url: 'https://demo.test/api/hot?limit=20',
          itemPath: 'data.items',
          itemCount: 5,
          detectedFields: { title: 'title', url: 'url' },
        },
        {
          pattern: 'demo.test/api/search',
          url: 'https://demo.test/api/search?q=test',
          itemPath: 'payload.items',
          itemCount: 10,
          detectedFields: { title: 'headline', url: 'permalink' },
        },
      ],
      capabilities: [
        { name: 'hot', strategy: 'public', endpoint: 'demo.test/api/hot', itemPath: 'data.items' },
        { name: 'search', strategy: 'cookie', endpoint: 'demo.test/api/search', itemPath: 'payload.items' },
      ],
    });
    mockSynthesizeFromExplore.mockReturnValue({
      site: 'demo',
      explore_dir: tempDir,
      out_dir: tempDir,
      candidate_count: 2,
      candidates: [
        { name: 'hot', path: hotPath, strategy: 'public' },
        { name: 'search', path: searchPath, strategy: 'public' },
      ],
    });

    const page = { goto: vi.fn() } as unknown as IPage;
    mockBrowserSession.mockImplementation(async (_factory, fn) => fn(page));
    mockCascadeProbe.mockResolvedValue({
      bestStrategy: Strategy.COOKIE,
      probes: [
        { strategy: Strategy.PUBLIC, success: false },
        { strategy: Strategy.COOKIE, success: true },
      ],
      confidence: 0.9,
    });
    mockExecutePipeline.mockResolvedValue([{ title: 'hello', url: 'https://demo.test/item/1' }]);

    const result = await generateVerifiedFromUrl({
      url: 'https://demo.test',
      BrowserFactory: class {} as never,
      goal: 'search',
      noRegister: false,
    });

    expect(mockBrowserSession).toHaveBeenCalledTimes(1);
    expect(page.goto).toHaveBeenCalledWith('https://demo.test/home');
    expect(mockCascadeProbe).toHaveBeenCalledWith(page, 'https://demo.test/api/search?q=test', { maxStrategy: Strategy.COOKIE });
    expect(mockExecutePipeline).toHaveBeenCalledTimes(1);
    expect(mockRegisterCommand).toHaveBeenCalledTimes(1);

    expect(result.status).toBe('success');
    expect(result.adapter).toBeDefined();
    expect(result.adapter!.command).toBe('demo/search');
    expect(result.adapter!.strategy).toBe(Strategy.COOKIE);
    expect(result.adapter!.metadata_path).toBeDefined();
    expect(result.adapter!.reusability).toBe('verified-artifact');
    expect(result.reusability).toBe('verified-artifact');
    expect(result.stats.verified).toBe(true);
    expect(result.stats.repair_attempted).toBe(false);

    // Verify sidecar metadata was written
    expect(result.adapter!.metadata_path).toMatch(/\.meta\.json$/);
    const metaContent = JSON.parse(fs.readFileSync(result.adapter!.metadata_path!, 'utf-8'));
    expect(metaContent).toEqual(expect.objectContaining({
      artifact_kind: 'verified',
      schema_version: 1,
      source_url: 'https://demo.test',
      strategy: Strategy.COOKIE,
      verified: true,
      reusable: true,
      reusability_reason: 'verified-artifact',
    }));
  });

  it('writes verified artifact + sidecar metadata for --no-register success', async () => {
    const candidatePath = path.join(tempDir, 'search.json');
    fs.writeFileSync(candidatePath, JSON.stringify({
      site: 'demo',
      name: 'search',
      description: 'demo search',
      domain: 'demo.test',
      strategy: 'public',
      browser: false,
      args: {
        keyword: { type: 'str', required: true },
      },
      columns: ['title', 'url'],
      pipeline: [
        { fetch: { url: 'https://demo.test/api/search?q=${{ args.keyword }}' } },
        { select: 'payload.items' },
        { map: { title: '${{ item.title }}', url: '${{ item.url }}' } },
      ],
    }, null, 2));

    mockExploreUrl.mockResolvedValue({
      site: 'demo',
      target_url: 'https://demo.test',
      final_url: 'https://demo.test/home',
      title: 'Demo',
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
      manifest: { site: 'demo', target_url: 'https://demo.test', final_url: 'https://demo.test/home' },
      endpoints: [{
        pattern: 'demo.test/api/search',
        url: 'https://demo.test/api/search?q=test',
        itemPath: 'payload.items',
        itemCount: 10,
        detectedFields: { title: 'headline', url: 'permalink' },
      }],
      capabilities: [{ name: 'search', strategy: 'cookie', endpoint: 'demo.test/api/search', itemPath: 'payload.items' }],
    });
    mockSynthesizeFromExplore.mockReturnValue({
      site: 'demo',
      explore_dir: tempDir,
      out_dir: tempDir,
      candidate_count: 1,
      candidates: [{ name: 'search', path: candidatePath, strategy: 'public' }],
    });

    const page = { goto: vi.fn() } as unknown as IPage;
    mockBrowserSession.mockImplementation(async (_factory, fn) => fn(page));
    mockCascadeProbe.mockResolvedValue({
      bestStrategy: Strategy.COOKIE,
      probes: [
        { strategy: Strategy.PUBLIC, success: false },
        { strategy: Strategy.COOKIE, success: true },
      ],
      confidence: 0.9,
    });
    mockExecutePipeline.mockResolvedValue([{ title: 'hello', url: 'https://demo.test/item/1' }]);

    const result = await generateVerifiedFromUrl({
      url: 'https://demo.test',
      BrowserFactory: class {} as never,
      goal: 'search',
      noRegister: true,
    });

    expect(result.status).toBe('success');
    expect(
      path.normalize(result.adapter!.path).endsWith(
        path.join('verified', 'search.verified.ts'),
      ),
    ).toBe(true);
    expect(result.adapter?.path).not.toBe(candidatePath);
    expect(
      path.normalize(result.adapter!.metadata_path!).endsWith(
        path.join('verified', 'search.verified.meta.json'),
      ),
    ).toBe(true);
    expect(fs.existsSync(result.adapter!.path)).toBe(true);
    expect(fs.existsSync(result.adapter!.metadata_path!)).toBe(true);
    expect(mockRegisterCommand).not.toHaveBeenCalled();
  });

  // ── needs-human-check outcomes ────────────────────────────────────────────

  it('returns needs-human-check with structured escalation when repair exhausted', async () => {
    const candidatePath = path.join(tempDir, 'hot.json');
    fs.writeFileSync(candidatePath, JSON.stringify({
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
        { select: 'wrong.items' },
        { map: { rank: '${{ index + 1 }}', title: '${{ item.title }}', url: '${{ item.url }}' } },
        { limit: '${{ args.limit | default(20) }}' },
      ],
    }, null, 2));

    mockExploreUrl.mockResolvedValue({
      site: 'demo',
      target_url: 'https://demo.test',
      final_url: 'https://demo.test',
      title: 'Demo',
      framework: {},
      stores: [],
      top_strategy: 'public',
      endpoint_count: 1,
      api_endpoint_count: 1,
      capabilities: [{ name: 'hot' }],
      auth_indicators: [],
      out_dir: tempDir,
    });
    mockLoadExploreBundle.mockReturnValue({
      manifest: { site: 'demo', target_url: 'https://demo.test', final_url: 'https://demo.test' },
      endpoints: [{
        pattern: 'demo.test/api/hot',
        url: 'https://demo.test/api/hot?limit=20',
        itemPath: 'data.items',
        itemCount: 5,
        detectedFields: { title: 'title', url: 'url' },
      }],
      capabilities: [{ name: 'hot', strategy: 'public', endpoint: 'demo.test/api/hot', itemPath: 'data.items' }],
    });
    mockSynthesizeFromExplore.mockReturnValue({
      site: 'demo',
      explore_dir: tempDir,
      out_dir: tempDir,
      candidate_count: 1,
      candidates: [{ name: 'hot', path: candidatePath, strategy: 'public' }],
    });

    const page = { goto: vi.fn() } as unknown as IPage;
    mockBrowserSession.mockImplementation(async (_factory, fn) => fn(page));
    mockCascadeProbe.mockResolvedValue({
      bestStrategy: Strategy.PUBLIC,
      probes: [{ strategy: Strategy.PUBLIC, success: true }],
      confidence: 1,
    });
    mockExecutePipeline.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const result = await generateVerifiedFromUrl({
      url: 'https://demo.test',
      BrowserFactory: class {} as never,
      noRegister: true,
    });

    expect(mockExecutePipeline).toHaveBeenCalledTimes(2);
    expect(mockExecutePipeline.mock.calls[0]?.[1]).toEqual(expect.arrayContaining([{ select: 'wrong.items' }]));
    expect(mockExecutePipeline.mock.calls[1]?.[1]).toEqual(expect.arrayContaining([{ select: 'data.items' }]));

    // Verify structured escalation contract
    expect(result.status).toBe('needs-human-check');
    expect(result.escalation).toBeDefined();
    expect(result.escalation!.stage).toBe('fallback');
    expect(result.escalation!.reason).toBe('empty-result');
    expect(result.escalation!.confidence).toBe('low');
    expect(result.escalation!.suggested_action).toBe('inspect-with-browser');
    expect(result.escalation!.candidate).toBeDefined();
    expect(result.escalation!.candidate.command).toBe('demo/hot');
    expect(result.escalation!.candidate.reusability).toBe('unverified-candidate');
    expect(result.reusability).toBe('unverified-candidate');
    expect(result.message).toContain('Repair exhausted');
    expect(result.stats.repair_attempted).toBe(true);
    expect(result.stats.verified).toBe(false);
  });

  it('returns needs-human-check with ask-for-sample-arg for unsupported required args', async () => {
    const candidatePath = path.join(tempDir, 'detail.json');
    fs.writeFileSync(candidatePath, JSON.stringify({
      site: 'demo',
      name: 'detail',
      description: 'demo detail',
      domain: 'demo.test',
      strategy: 'public',
      browser: false,
      args: {
        id: { type: 'str', required: true },
      },
      columns: ['title', 'url'],
      pipeline: [
        { fetch: { url: 'https://demo.test/api/detail?id=${{ args.id }}' } },
        { select: 'data.item' },
      ],
    }, null, 2));

    mockExploreUrl.mockResolvedValue({
      site: 'demo',
      target_url: 'https://demo.test/detail/123',
      final_url: 'https://demo.test/detail/123',
      title: 'Demo detail',
      framework: {},
      stores: [],
      top_strategy: 'public',
      endpoint_count: 1,
      api_endpoint_count: 1,
      capabilities: [{ name: 'detail' }],
      auth_indicators: [],
      out_dir: tempDir,
    });
    mockLoadExploreBundle.mockReturnValue({
      manifest: { site: 'demo', target_url: 'https://demo.test/detail/123', final_url: 'https://demo.test/detail/123' },
      endpoints: [{
        pattern: 'demo.test/api/detail',
        url: 'https://demo.test/api/detail?id=123',
        itemPath: 'data.item',
        itemCount: 1,
        detectedFields: { title: 'title', url: 'url' },
      }],
      capabilities: [{ name: 'detail', strategy: 'public', endpoint: 'demo.test/api/detail', itemPath: 'data.item' }],
    });
    mockSynthesizeFromExplore.mockReturnValue({
      site: 'demo',
      explore_dir: tempDir,
      out_dir: tempDir,
      candidate_count: 1,
      candidates: [{ name: 'detail', path: candidatePath, strategy: 'public' }],
    });

    const result = await generateVerifiedFromUrl({
      url: 'https://demo.test/detail/123',
      BrowserFactory: class {} as never,
      goal: 'detail',
      noRegister: true,
    });

    expect(mockBrowserSession).not.toHaveBeenCalled();
    expect(result.status).toBe('needs-human-check');
    expect(result.escalation).toBeDefined();
    expect(result.escalation!.stage).toBe('synthesize');
    expect(result.escalation!.reason).toBe('unsupported-required-args');
    expect(result.escalation!.confidence).toBe('high');
    expect(result.escalation!.suggested_action).toBe('ask-for-sample-arg');
    expect(result.escalation!.candidate.reusability).toBe('unverified-candidate');
    expect(result.reusability).toBe('unverified-candidate');
    expect(result.message).toContain('required args: id');
  });

  // ── Contract shape validation ─────────────────────────────────────────────

  it('all outcome statuses include status and stats', async () => {
    // Test the blocked path - simplest to set up
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
    mockSynthesizeFromExplore.mockReturnValue({
      site: 'demo',
      explore_dir: tempDir,
      out_dir: tempDir,
      candidate_count: 0,
      candidates: [],
    });

    const result: GenerateOutcome = await generateVerifiedFromUrl({
      url: 'https://demo.test',
      BrowserFactory: class {} as never,
    });

    // Every outcome must have these three fields
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('stats');
    expect(['success', 'blocked', 'needs-human-check']).toContain(result.status);

    // Blocked must have stage + reason + confidence
    if (result.status === 'blocked') {
      expect(result).toHaveProperty('reason');
      expect(result).toHaveProperty('stage');
      expect(result).toHaveProperty('confidence');
    }
  });

  // ── P2: EarlyHint callback ────────────────────────────────────────────────

  it('emits explore stop hint when no API surface found', async () => {
    mockExploreUrl.mockResolvedValue({
      site: 'demo',
      target_url: 'https://demo.test',
      final_url: 'https://demo.test',
      title: 'Demo',
      framework: {},
      stores: [],
      top_strategy: 'public',
      endpoint_count: 1,
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
    mockSynthesizeFromExplore.mockReturnValue({
      site: 'demo',
      explore_dir: tempDir,
      out_dir: tempDir,
      candidate_count: 0,
      candidates: [],
    });

    const hints: EarlyHint[] = [];
    await generateVerifiedFromUrl({
      url: 'https://demo.test',
      BrowserFactory: class {} as never,
      noRegister: true,
      onEarlyHint: (h) => hints.push(h),
    });

    expect(hints).toHaveLength(1);
    expect(hints[0]).toEqual({
      stage: 'explore',
      continue: false,
      reason: 'no-viable-api-surface',
      confidence: 'high',
    });
  });

  it('emits explore continue + synthesize stop hints when no candidate found', async () => {
    mockExploreUrl.mockResolvedValue({
      site: 'demo',
      target_url: 'https://demo.test',
      final_url: 'https://demo.test',
      title: 'Demo',
      framework: {},
      stores: [],
      top_strategy: 'public',
      endpoint_count: 1,
      api_endpoint_count: 1,
      capabilities: [],
      auth_indicators: [],
      out_dir: tempDir,
    });
    mockLoadExploreBundle.mockReturnValue({
      manifest: { site: 'demo', target_url: 'https://demo.test', final_url: 'https://demo.test' },
      endpoints: [{
        pattern: 'demo.test/api/hot',
        url: 'https://demo.test/api/hot',
        itemPath: 'data.items',
        itemCount: 5,
        detectedFields: { title: 'title' },
      }],
      capabilities: [],
    });
    mockSynthesizeFromExplore.mockReturnValue({
      site: 'demo',
      explore_dir: tempDir,
      out_dir: tempDir,
      candidate_count: 0,
      candidates: [],
    });

    const hints: EarlyHint[] = [];
    await generateVerifiedFromUrl({
      url: 'https://demo.test',
      BrowserFactory: class {} as never,
      noRegister: true,
      onEarlyHint: (h) => hints.push(h),
    });

    expect(hints).toHaveLength(2);
    expect(hints[0]).toMatchObject({ stage: 'explore', continue: true, reason: 'api-surface-looks-viable' });
    expect(hints[1]).toMatchObject({ stage: 'synthesize', continue: false, reason: 'no-viable-candidate' });
  });

  it('emits explore + synthesize continue hints with candidate on success path', async () => {
    const hotPath = path.join(tempDir, 'hot.json');
    fs.writeFileSync(hotPath, JSON.stringify({
      site: 'demo',
      name: 'hot',
      description: 'demo hot',
      domain: 'demo.test',
      strategy: 'public',
      browser: false,
      args: {},
      columns: ['title', 'url'],
      pipeline: [
        { fetch: { url: 'https://demo.test/api/hot' } },
        { select: 'data.items' },
      ],
    }, null, 2));

    mockExploreUrl.mockResolvedValue({
      site: 'demo',
      target_url: 'https://demo.test',
      final_url: 'https://demo.test',
      title: 'Demo',
      framework: {},
      stores: [],
      top_strategy: 'public',
      endpoint_count: 1,
      api_endpoint_count: 1,
      capabilities: [{ name: 'hot' }],
      auth_indicators: [],
      out_dir: tempDir,
    });
    mockLoadExploreBundle.mockReturnValue({
      manifest: { site: 'demo', target_url: 'https://demo.test', final_url: 'https://demo.test' },
      endpoints: [{
        pattern: 'demo.test/api/hot',
        url: 'https://demo.test/api/hot',
        itemPath: 'data.items',
        itemCount: 5,
        detectedFields: { title: 'title', url: 'url' },
      }],
      capabilities: [{ name: 'hot', strategy: 'public', endpoint: 'demo.test/api/hot', itemPath: 'data.items' }],
    });
    mockSynthesizeFromExplore.mockReturnValue({
      site: 'demo',
      explore_dir: tempDir,
      out_dir: tempDir,
      candidate_count: 1,
      candidates: [{ name: 'hot', path: hotPath, strategy: 'public' }],
    });

    const page = { goto: vi.fn() } as unknown as IPage;
    mockBrowserSession.mockImplementation(async (_factory, fn) => fn(page));
    mockCascadeProbe.mockResolvedValue({
      bestStrategy: Strategy.PUBLIC,
      probes: [{ strategy: Strategy.PUBLIC, success: true }],
      confidence: 1.0,
    });
    mockExecutePipeline.mockResolvedValue([
      { title: 'Post 1', url: 'https://demo.test/1' },
      { title: 'Post 2', url: 'https://demo.test/2' },
    ]);

    const hints: EarlyHint[] = [];
    const result = await generateVerifiedFromUrl({
      url: 'https://demo.test',
      BrowserFactory: class {} as never,
      noRegister: true,
      onEarlyHint: (h) => hints.push(h),
    });

    expect(result.status).toBe('success');
    expect(hints).toHaveLength(3);
    expect(hints[0]).toMatchObject({ stage: 'explore', continue: true });
    expect(hints[1]).toMatchObject({
      stage: 'synthesize',
      continue: true,
      reason: 'candidate-ready-for-verify',
      candidate: { name: 'hot', command: 'demo/hot', reusability: 'unverified-candidate' },
    });
    expect(hints[2]).toMatchObject({
      stage: 'cascade',
      continue: true,
      reason: 'candidate-ready-for-verify',
      candidate: { name: 'hot', command: 'demo/hot' },
    });
    // No candidate on explore hint
    expect(hints[0]).not.toHaveProperty('candidate');
  });

  it('emits cascade stop hint when auth-too-complex', async () => {
    const hotPath = path.join(tempDir, 'hot.json');
    fs.writeFileSync(hotPath, JSON.stringify({
      site: 'demo',
      name: 'hot',
      description: 'demo hot',
      domain: 'demo.test',
      strategy: 'public',
      browser: false,
      args: {},
      columns: ['title', 'url'],
      pipeline: [
        { fetch: { url: 'https://demo.test/api/hot' } },
        { select: 'data.items' },
      ],
    }, null, 2));

    mockExploreUrl.mockResolvedValue({
      site: 'demo',
      target_url: 'https://demo.test',
      final_url: 'https://demo.test',
      title: 'Demo',
      framework: {},
      stores: [],
      top_strategy: 'cookie',
      endpoint_count: 1,
      api_endpoint_count: 1,
      capabilities: [{ name: 'hot' }],
      auth_indicators: [],
      out_dir: tempDir,
    });
    mockLoadExploreBundle.mockReturnValue({
      manifest: { site: 'demo', target_url: 'https://demo.test', final_url: 'https://demo.test' },
      endpoints: [{
        pattern: 'demo.test/api/hot',
        url: 'https://demo.test/api/hot',
        itemPath: 'data.items',
        itemCount: 5,
        detectedFields: { title: 'title', url: 'url' },
      }],
      capabilities: [{ name: 'hot', strategy: 'cookie', endpoint: 'demo.test/api/hot', itemPath: 'data.items' }],
    });
    mockSynthesizeFromExplore.mockReturnValue({
      site: 'demo',
      explore_dir: tempDir,
      out_dir: tempDir,
      candidate_count: 1,
      candidates: [{ name: 'hot', path: hotPath, strategy: 'public' }],
    });

    const page = { goto: vi.fn() } as unknown as IPage;
    mockBrowserSession.mockImplementation(async (_factory, fn) => fn(page));
    mockCascadeProbe.mockResolvedValue({
      bestStrategy: Strategy.COOKIE,
      probes: [
        { strategy: Strategy.PUBLIC, success: false },
        { strategy: Strategy.COOKIE, success: false },
      ],
      confidence: 0.3,
    });

    const hints: EarlyHint[] = [];
    await generateVerifiedFromUrl({
      url: 'https://demo.test',
      BrowserFactory: class {} as never,
      noRegister: true,
      onEarlyHint: (h) => hints.push(h),
    });

    expect(hints).toHaveLength(3);
    expect(hints[0]).toMatchObject({ stage: 'explore', continue: true });
    expect(hints[1]).toMatchObject({ stage: 'synthesize', continue: true, reason: 'candidate-ready-for-verify' });
    expect(hints[2]).toMatchObject({ stage: 'cascade', continue: false, reason: 'auth-too-complex' });
    // No candidate on stop hint
    expect(hints[2]).not.toHaveProperty('candidate');
  });

  it('does NOT emit P2 hint for unsupported-required-args (P1-only decision)', async () => {
    const detailPath = path.join(tempDir, 'detail.json');
    fs.writeFileSync(detailPath, JSON.stringify({
      site: 'demo',
      name: 'detail',
      description: 'demo detail',
      domain: 'demo.test',
      strategy: 'public',
      browser: false,
      args: {
        id: { type: 'str', required: true },
      },
      columns: ['title', 'url'],
      pipeline: [
        { fetch: { url: 'https://demo.test/api/detail?id=${{ args.id }}' } },
        { select: 'data.item' },
      ],
    }, null, 2));

    mockExploreUrl.mockResolvedValue({
      site: 'demo',
      target_url: 'https://demo.test/detail/123',
      final_url: 'https://demo.test/detail/123',
      title: 'Demo detail',
      framework: {},
      stores: [],
      top_strategy: 'public',
      endpoint_count: 1,
      api_endpoint_count: 1,
      capabilities: [{ name: 'detail' }],
      auth_indicators: [],
      out_dir: tempDir,
    });
    mockLoadExploreBundle.mockReturnValue({
      manifest: { site: 'demo', target_url: 'https://demo.test/detail/123', final_url: 'https://demo.test/detail/123' },
      endpoints: [{
        pattern: 'demo.test/api/detail',
        url: 'https://demo.test/api/detail?id=123',
        itemPath: 'data.item',
        itemCount: 1,
        detectedFields: { title: 'title', url: 'url' },
      }],
      capabilities: [{ name: 'detail', strategy: 'public', endpoint: 'demo.test/api/detail', itemPath: 'data.item' }],
    });
    mockSynthesizeFromExplore.mockReturnValue({
      site: 'demo',
      explore_dir: tempDir,
      out_dir: tempDir,
      candidate_count: 1,
      candidates: [{ name: 'detail', path: detailPath, strategy: 'public' }],
    });

    const hints: EarlyHint[] = [];
    const result = await generateVerifiedFromUrl({
      url: 'https://demo.test/detail/123',
      BrowserFactory: class {} as never,
      goal: 'detail',
      noRegister: true,
      onEarlyHint: (h) => hints.push(h),
    });

    expect(result.status).toBe('needs-human-check');
    expect(result.escalation!.reason).toBe('unsupported-required-args');
    // Only explore continue hint is emitted; NO synthesize hint before the P1 terminal
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({ stage: 'explore', continue: true });
    // Specifically: no synthesize hint was emitted
    expect(hints.find(h => h.stage === 'synthesize')).toBeUndefined();
  });

  it('does not emit hints when onEarlyHint is not provided', async () => {
    mockExploreUrl.mockResolvedValue({
      site: 'demo',
      target_url: 'https://demo.test',
      final_url: 'https://demo.test',
      title: 'Demo',
      framework: {},
      stores: [],
      top_strategy: 'public',
      endpoint_count: 1,
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
    mockSynthesizeFromExplore.mockReturnValue({
      site: 'demo',
      explore_dir: tempDir,
      out_dir: tempDir,
      candidate_count: 0,
      candidates: [],
    });

    // Should not throw even without onEarlyHint
    const result = await generateVerifiedFromUrl({
      url: 'https://demo.test',
      BrowserFactory: class {} as never,
      noRegister: true,
    });

    expect(result.status).toBe('blocked');
  });
});
