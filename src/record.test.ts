import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  analyzeRecordedRequests,
  buildWriteRecordedYaml,
  createRecordedEntry,
  generateFullCaptureInterceptorJs,
  generateRecordedCandidates,
} from './record.js';
import { render } from './pipeline/template.js';

describe('record request-body capture', () => {
  it('captures a JSON fetch request body alongside the JSON response body', () => {
    const entry = createRecordedEntry({
      url: 'https://api.example.com/tasks',
      method: 'POST',
      requestContentType: 'application/json',
      requestBodyText: '{"title":"Ship #601","priority":"high"}',
      responseBody: { id: 'task_123', ok: true },
    });

    expect(entry).toMatchObject({
      method: 'POST',
      requestContentType: 'application/json',
      requestBody: { title: 'Ship #601', priority: 'high' },
      responseBody: { id: 'task_123', ok: true },
    });
  });

  it('captures a JSON request body from fetch(Request)', async () => {
    class MockXMLHttpRequest {
      open(): void {}
      send(): void {}
      setRequestHeader(): void {}
      addEventListener(): void {}
      getResponseHeader(): string | null { return null; }
      responseText = '';
    }

    const mockFetch = vi.fn(async () => new Response(
      JSON.stringify({ id: 'task_123', ok: true }),
      { headers: { 'content-type': 'application/json' } },
    ));

    vi.stubGlobal('fetch', mockFetch);
    vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest);
    vi.stubGlobal('window', globalThis);

    // eslint-disable-next-line no-eval
    eval(generateFullCaptureInterceptorJs());

    const request = new Request('https://api.example.com/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Ship #601' }),
    });

    await globalThis.fetch(request);

    const recorded = (globalThis as typeof globalThis & { __opencli_record?: Array<{ requestBody: unknown }> }).__opencli_record;
    expect(recorded).toHaveLength(1);
    expect(recorded?.[0]?.requestBody).toEqual({ title: 'Ship #601' });
  });

  it('captures a JSON request body from XHR send()', async () => {
    class MockXMLHttpRequest {
      __listeners: Record<string, Array<() => void>> = {};
      __rec_url?: string;
      __rec_method?: string;
      __rec_request_content_type?: string | null;
      responseText = JSON.stringify({ id: 'task_456', ok: true });

      open(method: string, url: string): void {
        this.__rec_method = method;
        this.__rec_url = url;
      }

      send(): void {
        for (const listener of this.__listeners.load ?? []) listener.call(this);
      }

      setRequestHeader(name: string, value: string): void {
        if (name.toLowerCase() === 'content-type') this.__rec_request_content_type = value;
      }

      addEventListener(event: string, listener: () => void): void {
        this.__listeners[event] ??= [];
        this.__listeners[event].push(listener);
      }

      getResponseHeader(name: string): string | null {
        return name.toLowerCase() === 'content-type' ? 'application/json' : null;
      }
    }

    const mockFetch = vi.fn(async () => new Response(
      JSON.stringify({ ok: true }),
      { headers: { 'content-type': 'application/json' } },
    ));

    vi.stubGlobal('fetch', mockFetch);
    vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest);
    vi.stubGlobal('window', globalThis);

    // eslint-disable-next-line no-eval
    eval(generateFullCaptureInterceptorJs());

    const xhr = new XMLHttpRequest();
    xhr.open('PATCH', 'https://api.example.com/tasks/submit');
    xhr.setRequestHeader('content-type', 'application/json;charset=utf-8');
    xhr.send('{"done":true}');

    const recorded = (globalThis as typeof globalThis & { __opencli_record?: Array<{ requestBody: unknown }> }).__opencli_record;
    expect(recorded).toHaveLength(1);
    expect(recorded?.[0]?.requestBody).toEqual({ done: true });
  });

  it('does not interrupt fetch when reading a Request body fails', async () => {
    class MockXMLHttpRequest {
      open(): void {}
      send(): void {}
      setRequestHeader(): void {}
      addEventListener(): void {}
      getResponseHeader(): string | null { return null; }
      responseText = '';
    }

    class BrokenRequest extends Request {
      override clone(): Request {
        throw new Error('clone failed');
      }
    }

    const mockFetch = vi.fn(async () => new Response(
      JSON.stringify({ id: 'task_123', ok: true }),
      { headers: { 'content-type': 'application/json' } },
    ));

    vi.stubGlobal('fetch', mockFetch);
    vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest);
    vi.stubGlobal('window', globalThis);

    // eslint-disable-next-line no-eval
    eval(generateFullCaptureInterceptorJs());

    const request = new BrokenRequest('https://api.example.com/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Ship #601' }),
    });

    await expect(globalThis.fetch(request)).resolves.toBeInstanceOf(Response);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('record write candidates', () => {
  it('keeps a POST request with JSON request body and object response as a write candidate', () => {
    const result = analyzeRecordedRequests([
      createRecordedEntry({
        url: 'https://api.example.com/tasks/create',
        method: 'POST',
        requestContentType: 'application/json',
        requestBodyText: '{"title":"Ship #601"}',
        responseBody: { id: 'task_123', ok: true },
      }),
    ]);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      kind: 'write',
      req: { method: 'POST' },
    });
  });

  it('accepts vendor JSON content types for write candidates', () => {
    const result = analyzeRecordedRequests([
      createRecordedEntry({
        url: 'https://api.example.com/tasks',
        method: 'POST',
        requestContentType: 'application/vnd.api+json',
        requestBodyText: '{"title":"Ship #601"}',
        responseBody: { id: 'task_123', ok: true },
      }),
    ]);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      kind: 'write',
      req: { method: 'POST' },
    });
  });

  it('rejects a POST request that has no usable JSON request body', () => {
    const result = analyzeRecordedRequests([
      createRecordedEntry({
        url: 'https://api.example.com/tasks/create',
        method: 'POST',
        requestContentType: 'application/json',
        requestBodyText: '',
        responseBody: { id: 'task_123', ok: true },
      }),
    ]);

    expect(result.candidates).toEqual([]);
  });

  it('rejects array request and response bodies for first-version write candidates', () => {
    const result = analyzeRecordedRequests([
      createRecordedEntry({
        url: 'https://api.example.com/tasks/batch',
        method: 'POST',
        requestContentType: 'application/json',
        requestBodyText: '[{"title":"Ship #601"}]',
        responseBody: [{ id: 'task_123' }],
      }),
    ]);

    expect(result.candidates).toEqual([]);
  });

  it('generates a write YAML candidate from a replayable JSON write request', () => {
    const candidates = generateRecordedCandidates('demo', 'https://demo.example.com/app', [
      createRecordedEntry({
        url: 'https://api.example.com/tasks/create',
        method: 'POST',
        requestContentType: 'application/json',
        requestBodyText: '{"title":"Ship #601"}',
        responseBody: { id: 'task_123', ok: true },
      }),
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      kind: 'write',
      name: 'create',
      strategy: 'cookie',
    });
    expect(JSON.stringify(candidates[0].yaml)).toContain('Ship #601');
  });

  it('builds a write template that replays the recorded JSON body with application/json', () => {
    const candidate = buildWriteRecordedYaml(
      'demo',
      'https://demo.example.com/app',
      createRecordedEntry({
        url: 'https://api.example.com/tasks/create',
        method: 'POST',
        requestContentType: 'application/json',
        requestBodyText: '{"title":"Ship #601"}',
        responseBody: { id: 'task_123', ok: true },
      }),
      'create',
    );

    expect(candidate.name).toBe('create');
    expect(JSON.stringify(candidate.yaml)).toContain('method: \\"POST\\"');
    expect(JSON.stringify(candidate.yaml)).toContain('content-type');
    expect(JSON.stringify(candidate.yaml)).toContain('Ship #601');
  });
});

describe('record read candidates', () => {
  it('keeps existing read candidates for array responses', () => {
    const result = analyzeRecordedRequests([
      {
        url: 'https://api.example.com/feed',
        method: 'GET',
        status: null,
        requestContentType: null,
        responseContentType: 'application/json',
        requestBody: null,
        responseBody: { items: [{ title: 'A' }, { title: 'B' }] },
        contentType: 'application/json',
        body: { items: [{ title: 'A' }, { title: 'B' }] },
        capturedAt: 1,
      },
    ]);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ kind: 'read' });
  });

  it('keeps read YAML generation on the baseline fetch path', () => {
    const candidates = generateRecordedCandidates('demo', 'https://demo.example.com/app', [
      createRecordedEntry({
        url: 'https://api.example.com/search?q=test',
        method: 'GET',
        responseBody: { items: [{ title: 'A' }, { title: 'B' }] },
      }),
    ]);

    const yaml = candidates[0].yaml as { pipeline: Array<{ evaluate?: string }> };
    expect(yaml.pipeline[1]?.evaluate).toContain(`fetch("https://api.example.com/search?q=`);
    expect(yaml.pipeline[1]?.evaluate).toContain(`{ credentials: 'include' }`);
    expect(yaml.pipeline[1]?.evaluate).not.toContain('method: "POST"');
    expect(yaml.pipeline[1]?.evaluate).not.toContain('body: JSON.stringify');
  });

  it('renders search and page args into the read YAML fetch URL', () => {
    const candidates = generateRecordedCandidates('demo', 'https://demo.example.com/app', [
      createRecordedEntry({
        url: 'https://api.example.com/search?q=test&page=2',
        method: 'GET',
        responseBody: { items: [{ title: 'A' }, { title: 'B' }] },
      }),
    ]);

    const yaml = candidates[0].yaml as { pipeline: Array<{ evaluate?: string }> };
    const renderedEvaluate = render(yaml.pipeline[1]?.evaluate, {
      args: { keyword: 'desk', page: 3 },
    });

    expect(renderedEvaluate).toContain('https://api.example.com/search?q=desk&page=3');
  });

  it('keeps GET and POST candidates separate when they share the same URL pattern', () => {
    const candidates = generateRecordedCandidates('demo', 'https://demo.example.com/app', [
      createRecordedEntry({
        url: 'https://api.example.com/tasks',
        method: 'GET',
        responseBody: { items: [{ title: 'A' }, { title: 'B' }] },
      }),
      createRecordedEntry({
        url: 'https://api.example.com/tasks',
        method: 'POST',
        requestContentType: 'application/json',
        requestBodyText: '{"title":"Ship #601"}',
        responseBody: { id: 'task_123', ok: true },
      }),
    ]);

    expect(candidates).toHaveLength(2);
    expect(candidates.some((candidate) => candidate.kind === 'read')).toBe(true);
    expect(candidates.some((candidate) => candidate.kind === 'write')).toBe(true);
  });
});

describe('record noise filtering', () => {
  it('filters analytics POST noise from write candidates', () => {
    const result = analyzeRecordedRequests([
      createRecordedEntry({
        url: 'https://api.example.com/analytics/event',
        method: 'POST',
        requestContentType: 'application/json',
        requestBodyText: '{"event":"click"}',
        responseBody: { ok: true, accepted: 1 },
      }),
    ]);

    expect(result.candidates).toEqual([]);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis as typeof globalThis & { __opencli_record?: unknown }, '__opencli_record');
  Reflect.deleteProperty(globalThis as typeof globalThis & { __opencli_record_patched?: unknown }, '__opencli_record_patched');
  Reflect.deleteProperty(globalThis as typeof globalThis & { __opencli_orig_fetch?: unknown }, '__opencli_orig_fetch');
  Reflect.deleteProperty(globalThis as typeof globalThis & { __opencli_orig_xhr_open?: unknown }, '__opencli_orig_xhr_open');
  Reflect.deleteProperty(globalThis as typeof globalThis & { __opencli_orig_xhr_send?: unknown }, '__opencli_orig_xhr_send');
  Reflect.deleteProperty(globalThis as typeof globalThis & { __opencli_orig_xhr_set_request_header?: unknown }, '__opencli_orig_xhr_set_request_header');
});
