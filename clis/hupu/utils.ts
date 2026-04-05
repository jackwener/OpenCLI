import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import type { IPage } from '@jackwener/opencli/types';

export interface HupuApiResponse {
  code?: number;
  msg?: string;
  message?: string;
}

interface BrowserFetchResult {
  ok?: boolean;
  status?: number;
  data?: HupuApiResponse | null;
  error?: string;
}

interface BrowserDataResult<T> {
  ok?: boolean;
  data?: T;
  error?: string;
}

export function stripHtml(html: string): string {
  if (!html) return '';
  const decoded = html
    .replace(/\\u003c/g, '<')
    .replace(/\\u003e/g, '>')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '');
  return decoded.replace(/<[^>]+>/g, '').trim();
}

export function decodeHtmlEntities(html: string): string {
  if (!html) return '';
  return html.replace(/&nbsp;/g, ' ')
             .replace(/&lt;/g, '<')
             .replace(/&gt;/g, '>')
             .replace(/&amp;/g, '&')
             .replace(/&quot;/g, '"')
             .replace(/&#x27;/g, "'");
}

export function getHupuThreadUrl(tid: unknown): string {
  return `https://bbs.hupu.com/${encodeURIComponent(String(tid))}-1.html`;
}

export function getHupuSearchUrl(query: unknown, page: unknown, forum?: unknown, sort?: unknown): string {
  const searchParams = new URLSearchParams();
  searchParams.append('q', String(query));
  searchParams.append('page', String(page));

  if (forum) {
    searchParams.append('topicId', String(forum));
  }

  if (sort) {
    searchParams.append('sortby', String(sort));
  }

  return `https://bbs.hupu.com/search?${searchParams.toString()}`;
}

export async function readHupuNextData<T>(
  page: IPage,
  url: string,
  actionLabel: string,
  options: {
    expectedTid?: string;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  await page.goto(url);

  const result = await page.evaluate(`
    (async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const expectedTid = ${JSON.stringify(options.expectedTid || '')};
      const timeoutMs = ${JSON.stringify(options.timeoutMs ?? 5000)};
      let lastSeenTid = '';
      let lastSeenHref = '';

      const waitFor = async (predicate, limitMs = timeoutMs) => {
        const start = Date.now();
        while (Date.now() - start < limitMs) {
          if (predicate()) return true;
          await wait(100);
        }
        return false;
      };

      const ready = await waitFor(() => {
        const script = document.getElementById('__NEXT_DATA__');
        if (!script?.textContent) return false;

        lastSeenHref = location.href;

        try {
          const parsed = JSON.parse(script.textContent);
          const threadTid = parsed?.props?.pageProps?.detail?.thread?.tid;
          lastSeenTid = typeof threadTid === 'string' ? threadTid : '';

          if (!expectedTid) return true;
          return threadTid === expectedTid;
        } catch {
          return false;
        }
      });
      if (!ready) {
        return {
          ok: false,
          error: expectedTid
            ? \`帖子数据未就绪或tid不匹配（expected=\${expectedTid}, actual=\${lastSeenTid || 'unknown'}, href=\${lastSeenHref || location.href}）\`
            : '无法找到帖子数据'
        };
      }

      try {
        const text = document.getElementById('__NEXT_DATA__')?.textContent || '';
        return {
          ok: true,
          data: JSON.parse(text)
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    })()
  `) as BrowserDataResult<T>;

  if (!result || typeof result !== 'object' || !result.ok) {
    throw new CommandExecutionError(`${actionLabel} failed: ${result?.error || 'invalid browser response'}`);
  }

  return result.data as T;
}

export async function readHupuSearchData<T>(page: IPage, url: string, actionLabel: string): Promise<T> {
  await page.goto(url);

  const result = await page.evaluate(`
    (async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitFor = async (predicate, timeoutMs = 5000) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (predicate()) return true;
          await wait(100);
        }
        return false;
      };

      const extractFromScript = () => {
        const marker = 'window.$$data=';
        for (const script of Array.from(document.scripts)) {
          const text = script.textContent || '';
          const dataIndex = text.indexOf(marker);
          if (dataIndex === -1) continue;

          const jsonStart = dataIndex + marker.length;
          let braceCount = 0;
          let jsonEnd = jsonStart;
          let inString = false;
          let escapeNext = false;

          for (let i = jsonStart; i < text.length; i++) {
            const char = text[i];

            if (escapeNext) {
              escapeNext = false;
              continue;
            }

            if (char === '\\\\') {
              escapeNext = true;
              continue;
            }

            if (char === '"') {
              inString = !inString;
              continue;
            }

            if (!inString) {
              if (char === '{') {
                braceCount++;
              } else if (char === '}') {
                braceCount--;
                if (braceCount === 0) {
                  jsonEnd = i;
                  break;
                }
              }
            }
          }

          if (jsonEnd > jsonStart) {
            return text.substring(jsonStart, jsonEnd + 1);
          }
        }
        return '';
      };

      const ready = await waitFor(() => {
        return typeof window.$$data !== 'undefined' || Boolean(extractFromScript());
      });
      if (!ready) {
        return { ok: false, error: '无法找到搜索数据' };
      }

      try {
        if (typeof window.$$data !== 'undefined') {
          return {
            ok: true,
            data: JSON.parse(JSON.stringify(window.$$data))
          };
        }

        const jsonString = extractFromScript();
        return {
          ok: true,
          data: JSON.parse(jsonString)
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    })()
  `) as BrowserDataResult<T>;

  if (!result || typeof result !== 'object' || !result.ok) {
    throw new CommandExecutionError(`${actionLabel} failed: ${result?.error || 'invalid browser response'}`);
  }

  return result.data as T;
}

function buildBrowserJsonPostScript(
  apiUrl: string,
  body: Record<string, unknown>,
  mode: 'default' | 'reply',
): string {
  return `
    (async () => {
      const url = ${JSON.stringify(apiUrl)};
      const payload = ${JSON.stringify(body)};
      const mode = ${JSON.stringify(mode)};
      const getCookie = (name) => document.cookie
        .split('; ')
        .find((item) => item.startsWith(name + '='))
        ?.slice(name.length + 1) || '';

      const findThumbcacheValue = () => {
        const rawEntry = document.cookie
          .split('; ')
          .find((item) => item.startsWith('.thumbcache_'));
        if (rawEntry && rawEntry.includes('=')) {
          const rawValue = rawEntry.slice(rawEntry.indexOf('=') + 1);
          try {
            return decodeURIComponent(rawValue);
          } catch {
            return rawValue;
          }
        }

        const storageKey = Object.keys(localStorage).find((key) => key.startsWith('.thumbcache_'));
        if (!storageKey) return '';
        return localStorage.getItem(storageKey) || '';
      };

      const resolveDefaultPayload = (input) => {
        const next = { ...input };
        const sensorsRaw = decodeURIComponent(getCookie('sensorsdata2015jssdkcross') || '');
        let deviceid = '';
        try {
          const sensors = JSON.parse(sensorsRaw);
          deviceid = sensors?.props?.['$device_id'] || sensors?.distinct_id || '';
        } catch {}

        if ((next.puid === '' || next.puid == null) && getCookie('ua')) {
          next.puid = getCookie('ua');
        }
        if ((next.shumei_id === '' || next.shumei_id == null) && getCookie('smidV2')) {
          next.shumei_id = getCookie('smidV2');
        }
        if ((next.deviceid === '' || next.deviceid == null) && deviceid) {
          next.deviceid = deviceid;
        }
        return next;
      };

      const resolveReplyPayload = (input) => {
        const next = { ...input };
        const thumbcache = findThumbcacheValue();
        if ((next.shumeiId === '' || next.shumeiId == null) && thumbcache) {
          next.shumeiId = thumbcache;
        }
        if ((next.deviceid === '' || next.deviceid == null) && thumbcache) {
          next.deviceid = thumbcache;
        }
        return next;
      };

      const resolvedPayload = mode === 'reply'
        ? resolveReplyPayload(payload)
        : resolveDefaultPayload(payload);

      try {
        const response = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(resolvedPayload)
        });

        const text = await response.text();
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = text ? { message: text } : null;
        }

        return {
          ok: response.ok,
          status: response.status,
          data
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    })()
  `;
}

/**
 * Execute authenticated Hupu JSON requests inside the browser page so
 * cookies and the thread referer come from the live logged-in session.
 */
export async function postHupuJson(
  page: IPage,
  tid: unknown,
  apiUrl: string,
  body: Record<string, unknown>,
  actionLabel: string,
  mode: 'default' | 'reply' = 'default',
): Promise<HupuApiResponse> {
  const referer = getHupuThreadUrl(tid);
  await page.goto(referer);

  const result = await page.evaluate(
    buildBrowserJsonPostScript(apiUrl, body, mode),
  ) as BrowserFetchResult;

  if (!result || typeof result !== 'object') {
    throw new CommandExecutionError(`${actionLabel} failed: invalid browser response`);
  }

  if (result.status === 401 || result.status === 403) {
    throw new AuthRequiredError('bbs.hupu.com', `${actionLabel} failed: please log in to Hupu first`);
  }

  if (result.error) {
    throw new CommandExecutionError(`${actionLabel} failed: ${result.error}`);
  }

  if (!result.ok) {
    const detail = result.data?.msg || result.data?.message || `HTTP ${result.status ?? 'unknown'}`;
    throw new CommandExecutionError(`${actionLabel} failed: ${detail}`);
  }

  return result.data ?? {};
}
