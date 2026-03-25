import * as fs from 'node:fs';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { ensureChatbotPage, resolveConnectionId } from './_shared.js';

export const exportCommand = cli({
  site: 'dory',
  name: 'export',
  description: 'Export the current Dory conversation to a Markdown file',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'connection', required: false, help: 'Connection name or ID to navigate to before exporting' },
    { name: 'output', required: false, help: 'Output file path (default: /tmp/dory-export.md)' },
  ],
  columns: ['Status', 'File', 'Messages'],
  func: async (page: IPage, kwargs: any) => {
    const rawConn = kwargs.connection as string | undefined;
    const connectionId = rawConn ? await resolveConnectionId(page, rawConn) : undefined;
    await ensureChatbotPage(page, connectionId);
    const outputPath = (kwargs.output as string) || '/tmp/dory-export.md';

    const messages = await page.evaluate(`
      (function() {
        const log = document.querySelector('[role="log"]');
        if (!log) return [];
        const results = [];
        const wrappers = log.querySelectorAll('.is-user, .is-assistant');
        wrappers.forEach(function(el) {
          const isUser = el.classList.contains('is-user');
          const text = (el.innerText || el.textContent || '').trim();
          if (text) results.push({ role: isUser ? 'User' : 'Assistant', text: text });
        });
        return results;
      })()
    `);

    const url = await page.evaluate('window.location.href');
    const title = await page.evaluate('document.title');

    let md = `# Dory Conversation Export\n\n`;
    md += `**Source:** ${url}\n`;
    md += `**Page:** ${title}\n\n---\n\n`;

    if (messages && messages.length > 0) {
      for (const msg of messages) {
        md += `## ${msg.role}\n\n${msg.text}\n\n---\n\n`;
      }
    } else {
      // Fallback: dump entire log
      const fallback = await page.evaluate(`
        (function() {
          const log = document.querySelector('[role="log"]');
          return log ? (log.innerText || log.textContent || '') : document.body.innerText;
        })()
      `);
      md += fallback;
    }

    fs.writeFileSync(outputPath, md);

    return [
      {
        Status: 'Success',
        File: outputPath,
        Messages: messages ? messages.length : 0,
      },
    ];
  },
});
