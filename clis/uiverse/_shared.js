import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export const UIVERSE_BASE_URL = 'https://uiverse.io';

const ROUTE_DATA_KEY = 'routes/$username.$friendlyId';
const CODE_DATA_KEY = 'routes/resource.post.code.$id';
const EXPORT_TARGET_BUTTON_LABELS = ['React', 'Vue', 'Svelte', 'Lit'];

function trimPathSegment(value) {
  return String(value || '').trim().replace(/^\/+|\/+$/g, '');
}

export function parseComponentInput(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    throw new Error('Missing component input. Pass a full Uiverse URL or an author/slug identifier.');
  }

  let pathname = raw;
  if (/^https?:\/\//i.test(raw)) {
    const url = new URL(raw);
    if (url.hostname !== 'uiverse.io' && url.hostname !== 'www.uiverse.io') {
      throw new Error(`Unsupported non-Uiverse URL: ${raw}`);
    }
    pathname = url.pathname;
  }

  const cleaned = trimPathSegment(pathname);
  const segments = cleaned.split('/').filter(Boolean);
  if (segments.length !== 2) {
    throw new Error(`Could not parse author/slug from input: ${raw}`);
  }

  const [username, slug] = segments;
  if (!username || !slug) {
    throw new Error(`Invalid component identifier: ${raw}. Expected author/slug.`);
  }

  return {
    raw,
    username,
    slug,
    url: `${UIVERSE_BASE_URL}/${username}/${slug}`,
  };
}

async function fetchJsonInBrowser(page, url) {
  const raw = await page.evaluate(`(async () => {
    const url = ${JSON.stringify(url)};
    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        accept: 'application/json, text/plain, */*',
      },
    });
    const text = await response.text();
    return JSON.stringify({
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      text,
      url,
    });
  })()`);

  const result = JSON.parse(raw);
  if (!result?.ok) {
    throw new Error(`Request failed: ${result?.status} ${result?.statusText} (${result?.url || url})`);
  }

  try {
    return JSON.parse(result.text);
  } catch {
    throw new Error(`Response was not valid JSON: ${url}`);
  }
}

export async function getPostDetails(page, input) {
  const normalized = parseComponentInput(input);
  await page.goto(normalized.url);

  const raw = await page.evaluate(`(async () => {
    const key = ${JSON.stringify(ROUTE_DATA_KEY)};
    const loaderData = window.__remixContext?.state?.loaderData || {};
    const routeData = loaderData[key];
    return JSON.stringify({ routeData: routeData || null, keys: Object.keys(loaderData) });
  })()`);

  const parsed = JSON.parse(raw);
  let routeData = parsed?.routeData;
  if (!routeData?.post?.id) {
    const routeUrl = `${normalized.url}?_data=${encodeURIComponent(ROUTE_DATA_KEY)}`;
    routeData = await fetchJsonInBrowser(page, routeUrl);
  }

  if (!routeData?.post?.id) {
    throw new Error(`Could not resolve post.id from the component page: ${normalized.url}`);
  }

  return {
    ...normalized,
    post: routeData.post,
    routeData,
  };
}

export async function getRawCode(page, postId) {
  const codeUrl = `${UIVERSE_BASE_URL}/resource/post/code/${postId}?v=1&_data=${encodeURIComponent(CODE_DATA_KEY)}`;
  const payload = await fetchJsonInBrowser(page, codeUrl);
  if (typeof payload?.html !== 'string' || typeof payload?.css !== 'string') {
    throw new Error(`Unexpected code payload shape: ${codeUrl}`);
  }
  return payload;
}

export function inferLanguage(target, post) {
  if (target === 'react') return 'tsx';
  if (target === 'vue') return 'vue';
  if (target === 'html') return post?.isTailwind ? 'html+tailwind' : 'html';
  if (target === 'css') return 'css';
  return 'text';
}

export function getCodeLength(code) {
  return String(code || '').length;
}

function normalizeExportTarget(target) {
  return String(target || '').trim().toLowerCase() === 'vue' ? 'Vue' : 'React';
}

export async function extractExportCode(page, target = 'react') {
  const targetLabel = normalizeExportTarget(target);
  const raw = await page.evaluate(`(async () => {
    const targetLabel = ${JSON.stringify(targetLabel)};
    const exportButtonLabel = 'Export';
    const exportTargetButtonLabels = ${JSON.stringify(EXPORT_TARGET_BUTTON_LABELS)};

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const triggerClick = (element) => {
      if (!element) return;
      element.focus?.();
      const pointer = { bubbles: true, cancelable: true, composed: true, view: window };
      const mouse = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons: 1 };
      element.dispatchEvent(new PointerEvent('pointerdown', pointer));
      element.dispatchEvent(new MouseEvent('mousedown', mouse));
      element.dispatchEvent(new PointerEvent('pointerup', pointer));
      element.dispatchEvent(new MouseEvent('mouseup', mouse));
      element.dispatchEvent(new MouseEvent('click', mouse));
    };

    const isCompleteExportCode = (code) => {
      if (!code) return false;
      if (targetLabel === 'Vue') {
        return code.includes('<template>')
          && code.includes('</template>')
          && code.includes('<style')
          && code.includes('</style>');
      }
      return code.includes('export default')
        && (code.includes('styled-components') || code.includes('StyledWrapper') || code.includes('styled.'));
    };

    const readCode = () => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return null;
      const heading = dialog.querySelector('h1,h2,h3,h4,h5,h6');
      if (heading && (heading.textContent || '').trim() !== targetLabel) return null;
      const textarea = dialog.querySelector('textarea');
      if (textarea && textarea.value) return textarea.value;
      return null;
    };

    const exportButton = [...document.querySelectorAll('button')].find((element) => (element.textContent || '').trim() === exportButtonLabel);
    const currentTargetButton = [...document.querySelectorAll('button')].find((element) => {
      const text = (element.textContent || '').trim();
      return exportTargetButtonLabels.includes(text);
    });

    const existing = readCode();
    if (!existing && (!exportButton || !currentTargetButton)) {
      return JSON.stringify({ ok: false, error: 'Could not find the export controls on the page.' });
    }

    if (!existing) {
      const currentLabel = (currentTargetButton.textContent || '').trim();
      if (currentLabel === targetLabel) {
        triggerClick(exportButton);
      } else {
        triggerClick(currentTargetButton);
        let menuItem = null;
        for (let index = 0; index < 20; index += 1) {
          menuItem = [...document.querySelectorAll('[role="menuitem"]')].find((element) => (element.textContent || '').trim() === targetLabel);
          if (menuItem) break;
          await sleep(100);
        }
        if (!menuItem) {
          return JSON.stringify({ ok: false, error: 'Could not find target in export menu: ' + targetLabel });
        }
        triggerClick(menuItem);
      }
    }

    let longest = existing || '';
    let longestLooksComplete = isCompleteExportCode(longest);
    let stableCount = 0;

    for (let index = 0; index < 40; index += 1) {
      await sleep(200);
      const code = readCode();
      if (!code) continue;

      if (code.length > longest.length) {
        longest = code;
        longestLooksComplete = isCompleteExportCode(code);
        stableCount = 0;
        continue;
      }

      if (code === longest) {
        if (longestLooksComplete) {
          stableCount += 1;
          if (stableCount >= 2) {
            return JSON.stringify({ ok: true, code: longest, length: longest.length });
          }
        } else {
          stableCount = 0;
        }
      }
    }

    const dialog = document.querySelector('[role="dialog"]');
    if (longest && longestLooksComplete) {
      return JSON.stringify({ ok: true, code: longest, length: longest.length, fallback: true });
    }

    return JSON.stringify({
      ok: false,
      error: dialog
        ? (targetLabel + ' dialog appeared, but the exported code never reached a stable complete state.')
        : (targetLabel + ' export dialog did not appear after clicking the export controls.'),
      dialogFound: Boolean(dialog),
      dialogText: dialog ? (dialog.innerText || '').slice(0, 200) : null,
      longestLength: longest.length,
    });
  })()`);

  const data = JSON.parse(raw);
  if (!data?.ok || typeof data.code !== 'string') {
    throw new Error(data?.error || `Failed to extract ${targetLabel} export code.`);
  }
  return data.code;
}

export function parseHtmlRootSignature(html) {
  const source = String(html || '').trim();
  const match = source.match(/^<([a-zA-Z0-9-]+)([^>]*)>/);
  if (!match) {
    return { tag: null, id: null, classes: [] };
  }

  const [, tag, attrs] = match;
  const idMatch = attrs.match(/\sid=["']([^"']+)["']/i);
  const classMatch = attrs.match(/\sclass=["']([^"']+)["']/i);
  const classes = classMatch ? classMatch[1].split(/\s+/).filter(Boolean) : [];
  return {
    tag: tag.toLowerCase(),
    id: idMatch ? idMatch[1] : null,
    classes,
  };
}

export async function locatePreviewElement(page, html) {
  const signature = parseHtmlRootSignature(html);
  const raw = await page.evaluate(`(async () => {
    const sig = ${JSON.stringify(signature)};
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const fallbackTags = sig.tag ? [sig.tag] : ['label', 'button', 'a', 'div'];

    const isVisible = (element) => {
      if (!element || !(element instanceof Element)) return false;
      if (element.closest('[role="dialog"]')) return false;
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const scoreCandidate = (element, source) => {
      const rect = element.getBoundingClientRect();
      const centerX = rect.x + rect.width / 2;
      const centerY = rect.y + rect.height / 2;
      const area = rect.width * rect.height;
      let score = 0;
      if (sig.tag && element.tagName.toLowerCase() === sig.tag) score += 30;
      if (sig.id && element.id === sig.id) score += 120;
      if (sig.classes.length && sig.classes.every((className) => element.classList.contains(className))) score += 120;
      if (centerX <= viewportWidth * 0.65) score += 40;
      if (centerY <= viewportHeight * 0.6) score += 40;
      if (area <= viewportWidth * viewportHeight * 0.2) score += 30;
      if (area <= viewportWidth * viewportHeight * 0.05) score += 20;
      return {
        source,
        tag: element.tagName.toLowerCase(),
        className: element.className || '',
        id: element.id || '',
        score,
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
      };
    };

    const candidates = [];
    const seen = new Set();
    const collect = (element, source) => {
      if (!isVisible(element)) return;
      if (seen.has(element)) return;
      seen.add(element);
      candidates.push(scoreCandidate(element, source));
    };

    if (sig.id) collect(document.getElementById(sig.id), 'id');
    if (sig.classes.length) collect(document.querySelector('.' + sig.classes.join('.')), 'classes');

    for (const tagName of fallbackTags) {
      const tagNodes = Array.from(document.querySelectorAll(tagName));
      for (const node of tagNodes.slice(0, 200)) {
        collect(node, 'tag:' + tagName);
      }
    }

    candidates.sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (left.rect.y !== right.rect.y) return left.rect.y - right.rect.y;
      if (left.rect.x !== right.rect.x) return left.rect.x - right.rect.x;
      return (left.rect.width * left.rect.height) - (right.rect.width * right.rect.height);
    });

    return JSON.stringify({ signature: sig, best: candidates[0] || null, candidates: candidates.slice(0, 5) });
  })()`);

  const result = JSON.parse(raw);
  if (!result?.best?.rect?.width || !result?.best?.rect?.height) {
    throw new Error(`Could not locate a Uiverse preview element. Candidate data: ${JSON.stringify(result)}`);
  }
  return result;
}

export function getDefaultOutputPath({ username, slug, suffix, extension }) {
  const safeUsername = trimPathSegment(username).replace(/[^a-zA-Z0-9-_]/g, '-');
  const safeSlug = trimPathSegment(slug).replace(/[^a-zA-Z0-9-_]/g, '-');
  return path.join(os.tmpdir(), `opencli-uiverse-${safeUsername}-${safeSlug}-${suffix}.${extension}`);
}

export async function saveBase64File(base64, outputPath) {
  const resolved = path.resolve(outputPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, Buffer.from(base64, 'base64'));
  return resolved;
}
