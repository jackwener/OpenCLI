import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

export const channelsCommand = cli({
  site: 'discord-app',
  name: 'channels',
  description: 'List channels in the current Discord server',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [],
  columns: ['Index', 'Channel', 'Type'],
  func: async (page: IPage) => {
    const channels = await page.evaluate(`
      (function() {
        const results = [];

        // Discord channel links: <a> tags with href like /channels/GUILD/CHANNEL
        const links = document.querySelectorAll('a[href*="/channels/"][data-list-item-id^="channels___"]');

        links.forEach(function(el) {
          var label = el.getAttribute('aria-label') || '';
          if (!label) return;

          // Skip categories
          if (/[（(]category[）)]/i.test(label)) return;

          // Strip any leading status prefix before the first comma (e.g. "unread, ", locale-agnostic)
          var commaIdx = label.search(/[,，]/);
          var cleaned = commaIdx !== -1 ? label.slice(commaIdx + 1).trimStart() : label;

          // Extract name and type from "name (type)" or "name（type）"
          var m = cleaned.match(/^(.+?)\s*[（(](.+?)[）)]\s*$/);
          // If no type annotation found, skip — real channels always have "(Type channel)" in aria-label
          if (!m) return;
          var name = m[1].trim();
          var rawType = m[2].toLowerCase();

          // Discord channel names are ASCII-only; skip placeholder entries (e.g. locked channels)
          if (!name || !/^[\x20-\x7E]+$/.test(name)) return;

          var type = 'Text';
          if (rawType.includes('voice')) type = 'Voice';
          else if (rawType.includes('forum')) type = 'Forum';
          else if (rawType.includes('announcement')) type = 'Announcement';
          else if (rawType.includes('stage')) type = 'Stage';

          results.push({ Index: results.length + 1, Channel: name, Type: type });
        });

        return results;
      })()
    `);

    if (channels.length === 0) {
      return [{ Index: 0, Channel: 'No channels found', Type: '—' }];
    }
    return channels;
  },
});
