import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callChrome, describeChrome } from './chrome-api';
const protectedTabs = new Set([10]);
const protectedGroups = new Set([20]);
let api: any;
beforeEach(() => {
  api = {
    runtime:{getManifest:() => ({permissions:['tabs','tabGroups']})},
    permissions:{getAll:async () => ({permissions:['tabs','tabGroups']})},
    tabs: {get:vi.fn(async (id: number) => ({id,groupId:id === 11 ? 20 : -1})),
      query:vi.fn(async () => []),group:vi.fn(async () => 30),ungroup:vi.fn(),remove:vi.fn(),update:vi.fn(),
      create:vi.fn(function(this: unknown) { expect(this).toBe(api.tabs); return {id:12}; })},
    tabGroups:{get:vi.fn(),update:vi.fn(async (id,props) => ({id,...props})),move:vi.fn()},
    windows:{remove:vi.fn(),create:vi.fn()},
  };
  vi.stubGlobal('chrome', api);
});
afterEach(() => vi.unstubAllGlobals());
const call = (method: string, args: unknown[]) => callChrome(method,args,protectedTabs,protectedGroups);
describe('native Chrome management', () => {
  it('describes supported methods and actual permissions', async () => {
    expect((await describeChrome()).methods).toContain('tabs.group');
    expect(await describeChrome('tabGroups.update')).toMatchObject({available:true,access:'write',declaredPermissions:['tabs','tabGroups']});
    await expect(call('runtime.sendMessage',[])).rejects.toMatchObject({code:'unsupported_chrome_method'});
  });
  it('creates and edits ordinary groups with native IDs, preserving the receiver', async () => {
    expect(await call('tabs.create',[{url:'about:blank'}])).toEqual({id:12});
    expect(await call('tabs.group',[{tabIds:[1,2]}])).toBe(30);
    expect(await call('tabGroups.update',[30,{title:'Research',color:'blue'}])).toEqual({id:30,title:'Research',color:'blue'});
    expect(await call('tabs.ungroup',[[1,2]])).toBe(null);
  });
  it('rejects mutations affecting managed tabs, groups or windows', async () => {
    for (const [method,args] of [
      ['tabs.group',[{tabIds:[10]}]], ['tabs.group',[{tabIds:[1],groupId:20}]],
      ['tabs.remove',[11]], ['tabGroups.update',[20,{title:'bad'}]], ['windows.create',[{tabId:10}]],
    ] as Array<[string,unknown[]]>) await expect(call(method,args)).rejects.toMatchObject({code:'managed_resource_conflict'});
    api.tabs.query.mockResolvedValue([{id:10,groupId:-1}]);
    await expect(call('windows.remove',[1])).rejects.toMatchObject({code:'managed_resource_conflict'});
    expect(api.tabs.group).not.toHaveBeenCalled();
    expect(api.windows.remove).not.toHaveBeenCalled();
  });
  it('rejects implicit tab selection and surfaces native errors without retry', async () => {
    await expect(call('tabs.update',[{active:true}])).rejects.toMatchObject({code:'invalid_args'});
    await expect(call('tabs.group',[{}])).rejects.toMatchObject({code:'invalid_args'});
    api.tabs.group.mockRejectedValue(new Error('native failure'));
    await expect(call('tabs.group',[{tabIds:[1]}])).rejects.toMatchObject({code:'chrome_api_error'});
    expect(api.tabs.group).toHaveBeenCalledTimes(1);
  });
});
