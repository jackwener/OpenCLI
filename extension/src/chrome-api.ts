/** Native browser management. Calls use Chrome IDs and do not acquire page leases. */
export const CHROME_METHODS = {
  'tabs.query': '(queryInfo: object) => Tab[]',
  'tabs.get': '(tabId: number) => Tab',
  'tabs.create': '(createProperties: object) => Tab',
  'tabs.duplicate': '(tabId: number) => Tab',
  'tabs.update': '(tabId: number, updateProperties: object) => Tab',
  'tabs.move': '(tabIds: number | number[], moveProperties: object) => Tab | Tab[]',
  'tabs.remove': '(tabIds: number | number[]) => void',
  'tabs.group': '(options: {tabIds: number[], groupId?: number, createProperties?: {windowId?: number}}) => number',
  'tabs.ungroup': '(tabIds: number | number[]) => void',
  'tabGroups.query': '(queryInfo: object) => TabGroup[]',
  'tabGroups.get': '(groupId: number) => TabGroup',
  'tabGroups.update': '(groupId: number, updateProperties: {title?: string, color?: string, collapsed?: boolean}) => TabGroup',
  'tabGroups.move': '(groupId: number, moveProperties: {index: number, windowId?: number}) => TabGroup',
  'windows.get': '(windowId: number, queryOptions?: object) => Window',
  'windows.getAll': '(queryOptions?: object) => Window[]',
  'windows.create': '(createData: object) => Window',
  'windows.update': '(windowId: number, updateInfo: object) => Window',
  'windows.remove': '(windowId: number) => void',
} as const;
export class ChromeApiError extends Error {
  readonly hint?: string;
  constructor(readonly code: string, message: string) { super(message); }
}
export const nativeError = (code: string, message: string) => new ChromeApiError(code, message);
const READ = new Set(['tabs.query', 'tabs.get', 'tabGroups.query', 'tabGroups.get', 'windows.get', 'windows.getAll']);
function resolve(method: string) {
  if (!Object.hasOwn(CHROME_METHODS, method)) throw nativeError('unsupported_chrome_method', `Unsupported Chrome method ${method}. Use chrome describe to list browser-management methods.`);
  const [namespace, name] = method.split('.');
  const receiver = (chrome as unknown as Record<string, Record<string, unknown>>)[namespace];
  return { receiver, fn: receiver?.[name], namespace, name };
}
export async function describeChrome(method?: string) {
  if (!method) return { methods: Object.keys(CHROME_METHODS), ids: 'Use numeric Chrome IDs from tabs.query/tabGroups.query/windows.getAll, not page targetIds.', lifecycle: 'Native-created tabs and windows are user-managed and persist after the CLI exits.' };
  const { fn, namespace, name } = resolve(method);
  return {
    method, signature: CHROME_METHODS[method as keyof typeof CHROME_METHODS], available: typeof fn === 'function',
    access: READ.has(method) ? 'read' : 'write', declaredPermissions: chrome.runtime.getManifest().permissions ?? [],
    grantedPermissions: await chrome.permissions.getAll(), documentation: `https://developer.chrome.com/docs/extensions/reference/api/${namespace}#method-${name}`,
    ...(namespace === 'tabGroups' ? { colors: ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'] } : {})
  };
}

export async function callChrome(method: string, args: unknown[], protectedTabs: Set<number>, protectedGroups: Set<number>) {
  const { receiver, fn } = resolve(method);
  if (!Array.isArray(args)) throw nativeError('invalid_args', 'Chrome args must be an array of positional arguments.');
  if (typeof fn !== 'function') throw nativeError('chrome_api_unavailable', `chrome.${method} is unavailable.`);
  try {
    if (!READ.has(method)) {
      let tabs: chrome.tabs.Tab[] = [];
      const first = args[0] as any;
      if (method.startsWith('tabGroups.') || ['windows.update', 'windows.remove'].includes(method)) {
        if (!Number.isInteger(first)) throw nativeError('invalid_args', 'Use an explicit numeric group or window ID.');
      }
      if (method.startsWith('tabGroups.')) {
        if (protectedGroups.has(first)) throw nativeError('managed_resource_conflict', 'This group is managed by OpenCLI browser sessions. Use an ordinary Chrome group.');
        tabs = await chrome.tabs.query({ groupId: first });
      } else if (method === 'tabs.group') {
        if (!Array.isArray(first?.tabIds) || !first.tabIds.length || first.tabIds.some((id: unknown) => !Number.isInteger(id))) throw nativeError('invalid_args', 'tabs.group requires a non-empty tabIds array.');
        if (first.groupId !== undefined) {
          if (protectedGroups.has(first.groupId)) throw nativeError('managed_resource_conflict', 'Cannot add tabs to an OpenCLI-managed group.');
          tabs.push(...await chrome.tabs.query({ groupId: first.groupId }));
        }
        tabs.push(...await Promise.all(first.tabIds.map((id: number) => chrome.tabs.get(id))));
      } else if (['tabs.update', 'tabs.move', 'tabs.remove', 'tabs.ungroup', 'tabs.duplicate'].includes(method)) {
        const ids = Array.isArray(first) ? first : [first];
        if (!ids.length || ids.some(id => !Number.isInteger(id))) throw nativeError('invalid_args', 'Use explicit numeric tab IDs from tabs.query.');
        tabs = await Promise.all(ids.map(id => chrome.tabs.get(id)));
      } else if (['windows.update', 'windows.remove'].includes(method)) tabs = await chrome.tabs.query({ windowId: first });
      else if (method === 'windows.create' && first?.tabId !== undefined) tabs = [await chrome.tabs.get(first.tabId)];
      if (tabs.some(t => protectedTabs.has(t.id!) || protectedGroups.has(t.groupId))) {
        throw nativeError('managed_resource_conflict', 'The operation touches an active OpenCLI session. Finish that session before reorganizing its tabs.');
      }
    }
    return await Reflect.apply(fn, receiver, args) ?? null;
  } catch (error) {
    if (error instanceof ChromeApiError) throw error;
    throw nativeError('chrome_api_error', `chrome.${method}: ${(error as Error).message}`);
  }
}
