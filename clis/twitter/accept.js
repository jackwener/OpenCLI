import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'twitter',
    name: 'accept',
    access: 'write',
    description: 'Auto-accept DM requests containing specific keywords',
    domain: 'x.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'query', type: 'string', required: true, positional: true, help: 'Keywords to match (comma-separated for OR, e.g. "群,微信")' },
        { name: 'max', type: 'int', required: false, default: 20, help: 'Maximum number of requests to accept (default: 20)' },
        { name: 'timeout', type: 'int', required: false, default: 600, help: 'Max seconds for the overall command (default: 600 — batch op)' },
    ],
    columns: ['index', 'status', 'user', 'message'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for twitter accept');
        const keywords = kwargs.query.split(',').map((k) => k.trim()).filter(Boolean);
        const maxAccepts = kwargs.max ?? 20;
        const results = [];
        let acceptCount = 0;
        // Track already-visited conversations to avoid infinite loops
        const visited = new Set();
        for (let round = 0; round < maxAccepts + 50; round++) {
            if (acceptCount >= maxAccepts)
                break;
            // Step 1: Navigate to DM requests page
            await page.goto('https://x.com/messages/requests');
            await page.wait(4);
            // Step 2: Get conversations with scroll-to-load
            const convInfo = await page.evaluate(`(async () => {
        try {
          // Wait for initial items
          let attempts = 0;
          while (attempts < 10) {
            const convs = document.querySelectorAll('[data-testid="conversation"]');
            if (convs.length > 0) break;
            await new Promise(r => setTimeout(r, 1000));
            attempts++;
          }

          // Scroll to load more
          const seenCount = new Set();
          let noNewCount = 0;
          for (let scroll = 0; scroll < 20; scroll++) {
            const convs = Array.from(document.querySelectorAll('[data-testid="conversation"]'));
            const prevSize = seenCount.size;
            convs.forEach((_, i) => seenCount.add(i));
            if (convs.length >= ${maxAccepts + 10}) break;

            // Scroll last item into view
            if (convs.length > 0) {
              convs[convs.length - 1].scrollIntoView({ behavior: 'instant', block: 'end' });
            }
            await new Promise(r => setTimeout(r, 1500));

            if (seenCount.size <= prevSize) {
              noNewCount++;
              if (noNewCount >= 3) break;
            } else {
              noNewCount = 0;
            }
          }

          const convs = Array.from(document.querySelectorAll('[data-testid="conversation"]'));
          if (convs.length === 0) return { ok: false, count: 0, items: [] };

          const items = convs.map((conv, idx) => {
            const text = conv.innerText || '';
            const link = conv.querySelector('a[href]');
            const href = link ? link.href : '';
            const lines = text.split('\\n').filter(l => l.trim());
            const user = lines[0] || 'Unknown';
            return { idx, text, href, user };
          });
          return { ok: true, count: convs.length, items };
        } catch(e) {
          return { ok: false, error: String(e), count: 0, items: [] };
        }
      })()`);
            if (!convInfo?.ok || convInfo.count === 0) {
                if (results.length === 0) {
                    results.push({ index: 1, status: 'info', user: 'System', message: 'No message requests found' });
                }
                break;
            }
            let foundInThisRound = false;
            // Step 3: Find first unvisited conversation with keyword match in preview
            for (const item of convInfo.items) {
                if (acceptCount >= maxAccepts)
                    break;
                const convKey = item.href || `conv-${item.idx}`;
                if (visited.has(convKey))
                    continue;
                visited.add(convKey);
                // Check if preview text contains any keyword
                const previewMatch = keywords.some((k) => item.text.includes(k));
                if (!previewMatch)
                    continue;
                // Step 4: Click this conversation to open it
                const clickResult = await page.evaluate(`(async () => {
          try {
            const convs = Array.from(document.querySelectorAll('[data-testid="conversation"]'));
            const conv = convs[${item.idx}];
            if (!conv) return { ok: false, error: 'Conversation element not found' };
            conv.click();
            await new Promise(r => setTimeout(r, 2000));
            return { ok: true };
          } catch(e) {
            return { ok: false, error: String(e) };
          }
        })()`);
                if (!clickResult?.ok)
                    continue;
                // Wait for conversation to load
                await page.wait(2);
                // Step 5: Read full chat content and find Accept button
                const res = await page.evaluate(`(async () => {
          try {
            const keywords = ${JSON.stringify(keywords)};

            // Get username from conversation header
            const heading = document.querySelector('[data-testid="conversation-header"]') ||
                            document.querySelector('[data-testid="DM-conversation-header"]');
            let username = 'Unknown';
            if (heading) {
              username = heading.innerText.trim().split('\\n')[0];
            }

            // Read full chat area text
            const chatArea = document.querySelector('[data-testid="DmScrollerContainer"]') ||
                             document.querySelector('[data-testid="DMConversationBody"]') ||
                             document.querySelector('main [data-testid="cellInnerDiv"]')?.closest('section') ||
                             document.querySelector('main');
            const text = chatArea ? chatArea.innerText : '';

            // Verify keyword match in full chat content
            const matchedKw = keywords.filter(k => text.includes(k));
            if (matchedKw.length === 0) {
              return { status: 'skipped', user: username, message: 'No keyword match in full content' };
            }

            // Find the Accept button
            const allBtns = Array.from(document.querySelectorAll('[role="button"]'));
            const acceptBtn = allBtns.find(btn => {
              const t = btn.innerText.trim().toLowerCase();
              return t === 'accept' || t === '接受';
            });

            if (!acceptBtn) {
              return { status: 'no_button', user: username, message: 'Keyword matched but no Accept button (already accepted?)' };
            }

            // Click Accept
            acceptBtn.click();
            await new Promise(r => setTimeout(r, 2000));

            // Check for confirmation dialog
            const btnsAfter = Array.from(document.querySelectorAll('[role="button"]'));
            const confirmBtn = btnsAfter.find(btn => {
              const t = btn.innerText.trim().toLowerCase();
              return (t === 'accept' || t === '接受') && btn !== acceptBtn;
            });
            if (confirmBtn) {
              confirmBtn.click();
              await new Promise(r => setTimeout(r, 1000));
            }

            return { status: 'accepted', user: username, message: 'Accepted! Matched: ' + matchedKw.join(', ') };
          } catch(e) {
            return { status: 'error', user: 'system', message: String(e) };
          }
        })()`);
                if (res?.status === 'accepted') {
                    acceptCount++;
                    foundInThisRound = true;
                    results.push({
                        index: acceptCount,
                        status: 'accepted',
                        user: res.user || 'Unknown',
                        message: res.message || 'Accepted',
                    });
                    // After accept, Twitter redirects to /messages — loop back to /messages/requests
                    await page.wait(2);
                    break; // break inner loop, outer loop will re-navigate to requests
                }
                else if (res?.status === 'no_button') {
                    // Already accepted, skip
                    continue;
                }
            }
            // If no match found in this round, we've exhausted all visible requests
            if (!foundInThisRound) {
                break;
            }
        }
        if (results.length === 0) {
            results.push({ index: 0, status: 'info', user: 'System', message: `No requests matched keywords "${keywords.join(', ')}"` });
        }
        return results;
    }
});
