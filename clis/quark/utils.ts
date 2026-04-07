import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import type { IPage } from '@jackwener/opencli/types';

export const SHARE_API = 'https://drive-h.quark.cn/1/clouddrive/share/sharepage';
export const DRIVE_API = 'https://drive-pc.quark.cn/1/clouddrive/file';
export const TASK_API = 'https://drive-pc.quark.cn/1/clouddrive/task';

export interface ApiResponse<T = unknown> {
  status: number;
  code: number;
  message: string;
  data: T;
  metadata?: { _total?: number };
}

export interface ShareFile {
  fid: string;
  file_name: string;
  size: number;
  dir: boolean;
  created_at: number;
  updated_at: number;
}

export interface DriveFile {
  fid: string;
  file_name: string;
  size: number;
  dir: boolean;
}

export function extractPwdId(url: string): string {
  const m = url.match(/\/s\/([a-zA-Z0-9]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9]+$/.test(url)) return url;
  throw new ArgumentError(`Invalid Quark share URL: ${url}`);
}

export async function fetchJson<T = unknown>(
  page: IPage,
  url: string,
  options?: { method?: string; body?: object },
): Promise<ApiResponse<T>> {
  const method = options?.method || 'GET';
  const body = options?.body ? JSON.stringify(options.body) : undefined;

  const js = `fetch(${JSON.stringify(url)}, {
    method: ${JSON.stringify(method)},
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ${body ? `body: ${JSON.stringify(body)},` : ''}
  }).then(r => r.json())`;

  return page.evaluate(js) as unknown as ApiResponse<T>;
}

export async function apiGet<T = unknown>(page: IPage, url: string): Promise<T> {
  const resp = await fetchJson<T>(page, url);
  if (resp.status !== 200) throw new CommandExecutionError(`quark: API error: ${resp.message}`);
  return resp.data;
}

export async function apiPost<T = unknown>(page: IPage, url: string, body: object): Promise<T> {
  const resp = await fetchJson<T>(page, url, { method: 'POST', body });
  if (resp.status !== 200) throw new CommandExecutionError(`quark: API error: ${resp.message}`);
  return resp.data;
}

export async function getToken(page: IPage, pwdId: string, passcode = ''): Promise<string> {
  const data = await fetchJson<{ stoken: string }>(page, `${SHARE_API}/token?pr=ucpro&fr=pc`, {
    method: 'POST',
    body: { pwd_id: pwdId, passcode, support_visit_limit_private_share: true },
  });
  if (data.status !== 200) throw new CommandExecutionError(`quark: Failed to get token: ${data.message}`);
  return data.data.stoken;
}

export async function listMyDrive(page: IPage, pdirFid: string): Promise<DriveFile[]> {
  const allFiles: DriveFile[] = [];
  let pageNum = 1;
  let total = 0;

  do {
    const url = `${DRIVE_API}/sort?pr=ucpro&fr=pc&pdir_fid=${pdirFid}&_page=${pageNum}&_size=200&_fetch_total=1&_sort=file_type:asc,file_name:asc`;
    const data = await fetchJson<{ list: DriveFile[] }>(page, url);
    if (data.status !== 200) throw new CommandExecutionError(`quark: Failed to list drive: ${data.message}`);
    const files = data.data?.list || [];
    allFiles.push(...files);
    total = data.metadata?._total || 0;
    pageNum++;
  } while (allFiles.length < total);

  return allFiles;
}

export async function findFolder(page: IPage, path: string): Promise<string> {
  const parts = path.split('/').filter(Boolean);
  let currentFid = '0';

  for (const part of parts) {
    const files = await listMyDrive(page, currentFid);
    const existing = files.find(f => f.dir && f.file_name === part);

    if (existing) {
      currentFid = existing.fid;
    } else {
      throw new CommandExecutionError(`quark: Folder "${part}" not found in "${path}"`);
    }
  }

  return currentFid;
}

export function formatDate(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

export function formatSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

export interface TaskStatus {
  status: number;
  save_as?: {
    save_as_sum_num: number;
  };
}

export async function getTaskStatus(page: IPage, taskId: string): Promise<TaskStatus | null> {
  const url = `${TASK_API}?pr=ucpro&fr=pc&task_id=${taskId}&retry_index=0`;
  return apiGet<TaskStatus>(page, url);
}

export async function pollTask(
  page: IPage,
  taskId: string,
  onDone?: (task: TaskStatus) => void,
  maxAttempts = 30,
  intervalMs = 500,
): Promise<boolean> {
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

