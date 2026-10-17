import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeScript, discoverEndpoints, mergeEvidence } from './discover.js';
import type { IPage } from '../types.js';

afterEach(() => vi.unstubAllGlobals());
describe('API evidence discovery', () => {
  it('extracts fetch, axios, XHR and unresolved templates without executing them', () => {
    const { endpoints } = analyzeScript(`
      fetch('/api/' + 'items?token=secret', {method:'POST', body:JSON.stringify({title:'x', count:1})});
      axios.get('/search', {params:{q:'x', page:1}});
      xhr.open('PUT', '/item/1');
      fetch(\`/items/\${id}\`);
      new WebSocket('wss://example.test/events');
    `, 'app.js');
    expect(endpoints).toHaveLength(5);
    expect(endpoints.find(e => e.method === 'POST')).toMatchObject({ bodyParams: ['count', 'title'], queryParams: ['token'], evidence:'static' });
    expect(JSON.stringify(endpoints)).not.toContain('secret');
    expect(endpoints.find(e => e.url === '/search')?.queryParams).toEqual(['page', 'q']);
    expect(endpoints.find(e => e.unresolved)?.url).toBe('/items/EXPR');
  });
  it('keeps method, host and GraphQL operations distinct and merges only observed evidence', () => {
    const candidates = analyzeScript(`fetch('/items'); fetch('/items'); fetch('/items/EXPR');`).endpoints;
    const merged = mergeEvidence('https://a.test', candidates, [
      {url:'https://a.test/items', method:'GET', key:'items', body:[{id:1}]},
      {url:'https://a.test/items', method:'POST'}, {url:'https://b.test/items'},
      {url:'https://a.test/graphql', method:'POST', request:{body:{operationName:'Search',variables:{q:'x'}}}},
      {url:'https://a.test/graphql', method:'POST', request:{body:{operationName:'Detail',variables:{id:1}}}},
    ]);
    expect(merged).toHaveLength(6);
    expect(merged[0]).toMatchObject({evidence:'network+static', sources:expect.any(Array)});
    expect(merged[0].sources).toHaveLength(2);
    expect(merged.filter(e => e.operationName).map(e => e.operationName)).toEqual(['Search','Detail']);
    expect(merged.find(e => e.operationName === 'Search')?.bodyParams).toEqual(['operationName','variables']);
    expect(mergeEvidence('https://a.test', candidates, []).every(e => e.evidence === 'static')).toBe(true);
  });
  it('handles relative URLs and keeps specific static GraphQL operations separate', () => {
    const { endpoints } = analyzeScript(`fetch('api/items?token=secret'); fetch('/items/' + (1 + 2 + 3));
      fetch('/graphql', {method:'POST',body:JSON.stringify({operationName:'Search',variables:{q:'x'}})});`);
    expect(endpoints.some(e => e.url.startsWith('api/items?'))).toBe(true);
    expect(endpoints.some(e => e.url === '/items/6')).toBe(true);
    expect(JSON.stringify(endpoints)).not.toContain('secret');
    const merged = mergeEvidence('https://a.test',endpoints,[
      {url:'https://a.test/graphql',method:'POST',request:{body:{operationName:'Search'}}},
      {url:'https://a.test/graphql',method:'POST',request:{body:{operationName:'Detail'}}},
    ]);
    expect(merged.find(e => e.operationName === 'Search')?.evidence).toBe('network+static');
    expect(merged.find(e => e.operationName === 'Detail')?.evidence).toBe('network');
  });
  it('reports parse and size limits', () => {
    expect(analyzeScript('let =').error).toContain('parse_error');
    expect(analyzeScript('x'.repeat(2 * 1024 * 1024 + 1)).error).toBe('script_too_large');
  });
  it('bounds script extraction before transport, excludes data scripts, and reports omissions', async () => {
    const scripts = Array.from({length:25}, () => ({src:'',type:'',textContent:"fetch('/api')"}));
    scripts.unshift({src:'',type:'application/json',textContent:'invalid JS'});
    vi.stubGlobal('document', {scripts});
    const page = { getCurrentUrl: async () => 'https://a.test/', evaluate: async (code: string) => (0,eval)(code) } as IPage;
    const report = await discoverEndpoints(page, [], true);
    expect(report.omittedScripts).toBe(5);
    expect(report.scripts).toHaveLength(20);
    expect(report.analysisComplete).toBe(false);
    expect(report.endpoints[0].sources).toHaveLength(20);
  });
  it('does not fetch scripts unless static analysis was requested', async () => {
    const evaluate = vi.fn();
    await discoverEndpoints({getCurrentUrl: async () => 'https://a.test/',evaluate} as unknown as IPage, []);
    expect(evaluate).not.toHaveBeenCalled();
  });
});
