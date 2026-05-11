import { ArgumentError, AuthRequiredError, CommandExecutionError, getErrorMessage } from '@jackwener/opencli/errors';
export const SHARE_API = 'https://drive-h.quark.cn/1/clouddrive/share/sharepage';
export const DRIVE_API = 'https://drive-pc.quark.cn/1/clouddrive/file';
export const TASK_API = 'https://drive-pc.quark.cn/1/clouddrive/task';
const QUARK_DOMAIN = 'pan.quark.cn';
const AUTH_HINT = 'Quark Drive requires a logged-in browser session';
function isAuthFailure(message, status) {
    if (status === 401 || status === 403)
        return true;
    return /not logged in|login required|please log in|authentication required|unauthorized|forbidden|未登录|请先登录|需要登录|登录/.test(message.toLowerCase());
}
function getErrorStatus(error) {
    if (!error || typeof error !== 'object' || !('status' in error))
        return undefined;
    const status = error.status;
    return typeof status === 'number' ? status : undefined;
}
function unwrapApiData(resp, action) {
    if (resp.status === 200)
        return resp.data;
    if (isAuthFailure(resp.message, resp.status)) {
        throw new AuthRequiredError(QUARK_DOMAIN, AUTH_HINT);
    }
    throw new CommandExecutionError(`quark: ${action}: ${resp.message}`);
}
export function extractPwdId(url) {
    const m = url.match(/\/s\/([a-zA-Z0-9]+)/);
    if (m)
        return m[1];
    if (/^[a-zA-Z0-9]+$/.test(url))
        return url;
    throw new ArgumentError(`Invalid Quark share URL: ${url}`);
}
export async function fetchJson(page, url, options) {
    const method = options?.method || 'GET';
    const body = options?.body ? JSON.stringify(options.body) : undefined;
    const js = `fetch(${JSON.stringify(url)}, {
    method: ${JSON.stringify(method)},
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ${body ? `body: ${JSON.stringify(body)},` : ''}
  }).then(async r => {
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('json')) {
      const text = await r.text().catch(() => '');
      throw Object.assign(new Error('Non-JSON response: ' + text.slice(0, 200)), { status: r.status });
    }
    return r.json();
  })`;
    try {
        return await page.evaluate(js);
    }
    catch (error) {
        if (isAuthFailure(getErrorMessage(error), getErrorStatus(error))) {
            throw new AuthRequiredError(QUARK_DOMAIN, AUTH_HINT);
        }
        throw error;
    }
}
export async function apiGet(page, url) {
    const resp = await fetchJson(page, url);
    return unwrapApiData(resp, 'API error');
}
export async function apiPost(page, url, body) {
    const resp = await fetchJson(page, url, { method: 'POST', body });
    return unwrapApiData(resp, 'API error');
}
export async function getToken(page, pwdId, passcode = '') {
    const data = await fetchJson(page, `${SHARE_API}/token?pr=ucpro&fr=pc`, {
        method: 'POST',
        body: { pwd_id: pwdId, passcode, support_visit_limit_private_share: true },
    });
    return unwrapApiData(data, 'Failed to get token').stoken;
}
export async function getShareList(page, pwdId, stoken, pdirFid = '0', options) {
    const allFiles = [];
    let pageNum = 1;
    let total = 0;
    do {
        const sortParam = options?.sort ? `&_sort=${options.sort}` : '';
        const url = `${SHARE_API}/detail?pr=ucpro&fr=pc&ver=2&pwd_id=${pwdId}&stoken=${encodeURIComponent(stoken)}&pdir_fid=${pdirFid}&force=0&_page=${pageNum}&_size=200&_fetch_total=1${sortParam}`;
        const data = await fetchJson(page, url);
        const files = unwrapApiData(data, 'Failed to get share list')?.list || [];
        allFiles.push(...files);
        total = data.metadata?._total || 0;
        pageNum++;
    } while (allFiles.length < total);
    return allFiles;
}
export async function listMyDrive(page, pdirFid) {
    const allFiles = [];
    let pageNum = 1;
    let total = 0;
    do {
        const url = `${DRIVE_API}/sort?pr=ucpro&fr=pc&pdir_fid=${pdirFid}&_page=${pageNum}&_size=200&_fetch_total=1&_sort=file_type:asc,file_name:asc`;
        const data = await fetchJson(page, url);
        const files = unwrapApiData(data, 'Failed to list drive')?.list || [];
        allFiles.push(...files);
        total = data.metadata?._total || 0;
        pageNum++;
    } while (allFiles.length < total);
    return allFiles;
}
export async function findFolder(page, path) {
    const parts = path.split('/').filter(Boolean);
    let currentFid = '0';
    for (const part of parts) {
        const files = await listMyDrive(page, currentFid);
        const existing = files.find(f => f.dir && f.file_name === part);
        if (existing) {
            currentFid = existing.fid;
        }
        else {
            throw new CommandExecutionError(`quark: Folder "${part}" not found in "${path}"`);
        }
    }
    return currentFid;
}
export function formatDate(ts) {
    if (!ts)
        return '';
    const d = new Date(ts);
    return d.toISOString().replace('T', ' ').slice(0, 19);
}
export function formatSize(bytes) {
    if (bytes <= 0)
        return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}
export async function getTaskStatus(page, taskId) {
    const url = `${TASK_API}?pr=ucpro&fr=pc&task_id=${taskId}&retry_index=0`;
    return apiGet(page, url);
}
export async function pollTask(page, taskId, onDone, maxAttempts = 30, intervalMs = 500) {
    for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, intervalMs));
        const task = await getTaskStatus(page, taskId);
        if (task?.status === 2) {
            onDone?.(task);
            return true;
        }
    }
    return false;
}
