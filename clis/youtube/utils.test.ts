import { describe, expect, it, vi } from 'vitest';
import { extractJsonAssignmentFromHtml, prepareYoutubeApiPage } from './utils.js';

describe('youtube utils', () => {
  it('extractJsonAssignmentFromHtml parses bootstrap objects with nested braces in strings', () => {
    const html = `
      <script>
        var ytInitialPlayerResponse = {
          "title": "brace { inside } string",
          "nested": { "count": 2, "text": "quote \\"value\\"" }
        };
      </script>
    `;

    expect(extractJsonAssignmentFromHtml(html, 'ytInitialPlayerResponse')).toEqual({
      title: 'brace { inside } string',
      nested: { count: 2, text: 'quote "value"' },
    });
  });

  it('extractJsonAssignmentFromHtml supports window assignments', () => {
    const html = `
      <script>
        window["ytInitialData"] = {"contents":{"items":[1,2,3]}};
      </script>
    `;

    expect(extractJsonAssignmentFromHtml(html, 'ytInitialData')).toEqual({
      contents: { items: [1, 2, 3] },
    });
  });

  it('prepareYoutubeApiPage loads the quiet API bootstrap page', async () => {
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
    };

    await expect(prepareYoutubeApiPage(page as any)).resolves.toBeUndefined();
    expect(page.goto).toHaveBeenCalledWith('https://www.youtube.com', { waitUntil: 'none' });
    expect(page.wait).toHaveBeenCalledWith(2);
  });
});
