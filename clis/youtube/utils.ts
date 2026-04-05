/**
 * Shared YouTube utilities — URL parsing, video ID extraction, etc.
 */
import type { IPage } from '@jackwener/opencli/types';

/**
 * Extract a YouTube video ID from a URL or bare video ID string.
 * Supports: watch?v=, youtu.be/, /shorts/, /embed/, /live/, /v/
 */
export function parseVideoId(input: string): string {
  if (!input.startsWith('http')) return input;

  try {
    const parsed = new URL(input);
    if (parsed.searchParams.has('v')) {
      return parsed.searchParams.get('v')!;
    }
    if (parsed.hostname === 'youtu.be') {
      return parsed.pathname.slice(1).split('/')[0];
    }
    // Handle /shorts/xxx, /embed/xxx, /live/xxx, /v/xxx
    const pathMatch = parsed.pathname.match(/^\/(shorts|embed|live|v)\/([^/?]+)/);
    if (pathMatch) return pathMatch[2];
  } catch {
    // Not a valid URL — treat entire input as video ID
  }

  return input;
}

/**
 * Extract a JSON object assigned to a known bootstrap variable inside YouTube HTML.
 */
export function extractJsonAssignmentFromHtml(html: string, keys: string | string[]): Record<string, unknown> | null {
  const candidates = Array.isArray(keys) ? keys : [keys];
  for (const key of candidates) {
    const markers = [
      `var ${key} = `,
      `window["${key}"] = `,
      `window.${key} = `,
      `${key} = `,
    ];
    for (const marker of markers) {
      const markerIndex = html.indexOf(marker);
      if (markerIndex === -1) continue;

      const jsonStart = html.indexOf('{', markerIndex + marker.length);
      if (jsonStart === -1) continue;

      let depth = 0;
      let inString = false;
      let escaping = false;
      for (let i = jsonStart; i < html.length; i += 1) {
        const ch = html[i];
        if (inString) {
          if (escaping) {
            escaping = false;
          } else if (ch === '\\') {
            escaping = true;
          } else if (ch === '"') {
            inString = false;
          }
          continue;
        }

        if (ch === '"') {
          inString = true;
          continue;
        }
        if (ch === '{') {
          depth += 1;
          continue;
        }
        if (ch === '}') {
          depth -= 1;
          if (depth === 0) {
            try {
              return JSON.parse(html.slice(jsonStart, i + 1)) as Record<string, unknown>;
            } catch {
              break;
            }
          }
        }
      }
    }
  }

  return null;
}

/**
 * Prepare a quiet YouTube API-capable page without opening the watch UI.
 */
export async function prepareYoutubeApiPage(page: IPage): Promise<void> {
  await page.goto('https://www.youtube.com', { waitUntil: 'none' });
  await page.wait(2);
}
