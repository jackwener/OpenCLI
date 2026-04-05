/**
 * Regression test for issue #625.
 * Facebook search must navigate in the pipeline before DOM extraction.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { describe, expect, it, vi } from 'vitest';
import { executePipeline } from '@jackwener/opencli/pipeline';
import type { IPage } from '@jackwener/opencli/types';

interface YamlCommand {
  pipeline?: Array<Record<string, unknown>>;
}

/**
 * Minimal browser mock for pipeline execution tests.
 * Only methods touched by this adapter path are implemented.
 */
function createMockPage(): IPage {
  return {
    goto: vi.fn(),
    evaluate: vi.fn().mockResolvedValue([]),
    getCookies: vi.fn().mockResolvedValue([]),
    snapshot: vi.fn().mockResolvedValue(''),
    click: vi.fn(),
    typeText: vi.fn(),
    pressKey: vi.fn(),
    scrollTo: vi.fn(),
    getFormState: vi.fn().mockResolvedValue({}),
    wait: vi.fn(),
    tabs: vi.fn().mockResolvedValue([]),
    selectTab: vi.fn(),
    networkRequests: vi.fn().mockResolvedValue([]),
    consoleMessages: vi.fn().mockResolvedValue(''),
    scroll: vi.fn(),
    autoScroll: vi.fn(),
    installInterceptor: vi.fn(),
    getInterceptedRequests: vi.fn().mockResolvedValue([]),
    waitForCapture: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(''),
  };
}

describe('facebook search pipeline', () => {
  it('navigates to search results before extracting DOM data', async () => {
    // Load the YAML adapter directly so the regression test covers the shipped command definition.
    const filePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'search.yaml');
    const raw = fs.readFileSync(filePath, 'utf8');
    const command = yaml.load(raw) as YamlCommand;
    const pipeline = command.pipeline ?? [];
    const page = createMockPage();

    await executePipeline(page, pipeline, {
      args: { query: 'AI agent', limit: 3 },
    });

    expect(page.goto).toHaveBeenNthCalledWith(1, 'https://www.facebook.com');
    expect(page.goto).toHaveBeenNthCalledWith(2, 'https://www.facebook.com/search/top?q=AI%20agent', {
      waitUntil: undefined,
      settleMs: 4000,
    });
    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(String((page.evaluate as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? '')).not.toContain('window.location.href');
  });
});
