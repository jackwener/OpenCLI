/**
 * antigravity serve — Anthropic-compatible `/v1/messages` proxy server.
 *
 * Starts an HTTP server that accepts Anthropic Messages API requests,
 * forwards them to a running Antigravity app via CDP, polls for the response,
 * and returns it in Anthropic format.
 *
 * Usage:
 *   opencli antigravity serve --port 8082
 *   ANTHROPIC_BASE_URL=http://localhost:8082 claude
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { CDPBridge } from '../../browser/cdp.js';
import type { IPage } from '../../src/types.js';
import { resolveElectronEndpoint } from '../../src/launcher.js';
import { EXIT_CODES, getErrorMessage } from '../../src/errors.js';

// ─── Types ───────────────────────────────────────────────────────────

interface AnthropicRequest {
  model?: string;
  max_tokens?: number;
  system?: string | Array<{ type: string; text: string }>;
  messages: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>;
  stream?: boolean;
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{ type: 'text'; text: string }>;
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence';
  stop_sequence: null;
  usage: { input_tokens: number; output_tokens: number };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function generateMsgId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = 'msg_';
  for (let i = 0; i < 24; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function estimateTokens(text: string): number {
  // Rough approximation: ~4 chars per token for English, ~2 for CJK
  return Math.max(1, Math.ceil(text.length / 3));
}

function extractTextContent(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === 'string') return content;
  return content
    .filter(b => b.type === 'text' && b.text)
    .map(b => b.text!)
    .join('\n');
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key, anthropic-version, Authorization',
  });
  res.end(body);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── DOM helpers ─────────────────────────────────────────────────────

/**
 * Click the 'New Conversation' button to reset context.
 */
async function startNewConversation(page: IPage): Promise<void> {
  await page.evaluate(`
    (() => {
      const btn = document.querySelector('[data-tooltip-id="new-conversation-tooltip"]');
      if (btn) btn.click();
    })()
  `);
  await sleep(1000); // Give UI time to clear
}

/**
 * Switch the active model in Antigravity UI.
 */
async function switchModel(page: IPage, anthropicModelId: string): Promise<void> {
  // Map standard model IDs to Antigravity UI names based on actual UI
  let targetName = 'claude sonnet 4.6'; // Default fallback
  const id = anthropicModelId.toLowerCase();
  
  if (id.includes('sonnet')) {
    targetName = 'claude sonnet 4.6';
  } else if (id.includes('opus')) {
    targetName = 'claude opus 4.6';
  } else if (id.includes('gemini') && id.includes('pro')) {
    targetName = 'gemini 3.1 pro (high)';
  } else if (id.includes('gemini') && id.includes('flash')) {
    targetName = 'gemini 3 flash';
  } else if (id.includes('gpt')) {
    targetName = 'gpt-oss 120b';
  }

  try {
    await page.evaluate(`
      async () => {
        const targetModelName = ${JSON.stringify(targetName)};
        const trigger = document.querySelector('div[aria-haspopup="dialog"] > div[tabindex="0"]');
        if (!trigger) return; // Silent fail if UI changed
        
        // Open dropdown only if not already selected
        if (trigger.innerText.toLowerCase().includes(targetModelName)) return;
        
        trigger.click();
        await new Promise(r => setTimeout(r, 200));
        
        const spans = Array.from(document.querySelectorAll('[role="dialog"] span'));
        const target = spans.find(s => s.innerText.toLowerCase().includes(targetModelName));
        if (target) {
          const optionNode = target.closest('.cursor-pointer') || target;
          optionNode.click();
        } else {
          // Close if not found
          trigger.click(); 
        }
      }
    `);
    await sleep(500); // Wait for switch
  } catch (err) {
    console.error(`[serve] Warning: Could not switch to model ${targetName}:`, err);
  }
}

/**
 * Check if the Antigravity UI is currently generating a response
 * by looking for Stop/Cancel buttons or loading indicators.
 */
async function isGenerating(page: IPage): Promise<boolean> {
  const result = await page.evaluate(`
    (() => {
      // Look for a cancel/stop button in the UI
      const cancelBtn = document.querySelector('button[aria-label*="cancel" i], button[aria-label*="stop" i], button[title*="cancel" i], button[title*="stop" i]');
      return !!cancelBtn;
    })()
  `);
  return Boolean(result);
}

/**
 * Walk from the scroll container and find the deepest element that
 * has multiple non-empty children (our message container).
 */
function findMessageContainer(root: Element | null, depth = 0): Element | null {
  if (!root || depth > 12) return null;
  const nonEmpty = Array.from(root.children).filter(
    c => (c as HTMLElement).innerText?.trim().length > 5
  );
  if (nonEmpty.length >= 2) return root;
  if (nonEmpty.length === 1) return findMessageContainer(nonEmpty[0], depth + 1);
  return root;
}

// ─── Antigravity CDP Operations ──────────────────────────────────────

/**
 * Get the full chat text for change-detection polling.
 */
async function getConversationText(page: IPage): Promise<string> {
  const text = await page.evaluate(`
    (() => {
      const container = document.getElementById('conversation');
      if (!container) return '';
      // Read only the first child div (actual chat content),
      // skipping UI chrome like file change panels, model selectors, etc.
      const chatContent = container.children[0];
      return chatContent ? chatContent.innerText : container.innerText;
    })()
  `);
  return String(text ?? '');
}

/**
 * Get the text of the last assistant reply by navigating to the message container
 * and extracting the last non-empty message block.
 */
async function getLastAssistantReply(page: IPage, userText?: string): Promise<string> {
  const text = await page.evaluate(`
    (() => {
      const conv = document.getElementById('conversation')?.children[0];
      const scroll = conv?.querySelector('.overflow-y-auto');
      
      // Walk down until we find a container with multiple message siblings
      function findMsgContainer(el, depth) {
        if (!el || depth > 12) return null;
        const nonEmpty = Array.from(el.children).filter(c => c.innerText && c.innerText.trim().length > 5);
        if (nonEmpty.length >= 2) return el;
        if (nonEmpty.length === 1) return findMsgContainer(nonEmpty[0], depth + 1);
        return null;
      }
      
      const container = findMsgContainer(scroll || conv, 0);
      if (!container) return '';
      
      // Get all non-empty children (skip trailing empty UI divs)
      const msgs = Array.from(container.children).filter(
        c => c.innerText && c.innerText.trim().length > 5
      );
      
      if (msgs.length === 0) return '';
      
      // The last element is the last assistant reply
      const last = msgs[msgs.length - 1];
      return last.innerText || '';
    })()
  `);
  let reply = String(text ?? '').trim();

  // Strip echoed user message from the top (Antigravity sometimes includes it)
  if (userText && reply.startsWith(userText)) {
    reply = reply.slice(userText.length).trim();
  }

  // Strip thinking block: "Thought for Xs\n..." at the start
  reply = reply.replace(/^Thought for[^\n]*\n+/i, '').trim();

  // Strip "Copy" button text at the end
  reply = reply.replace(/\s*\bCopy\b\s*$/m, '').trim();

  // De-duplicate trailing repeated content (e.g., "OK\n\nOK" → "OK")
  const half = Math.floor(reply.length / 2);
  const firstHalf = reply.slice(0, half).trim();
  const secondHalf = reply.slice(half).trim();
  if (firstHalf && firstHalf === secondHalf) {
    reply = firstHalf;
  }

  return reply;
}

async function sendMessage(page: IPage, message: string, bridge?: CDPBridge): Promise<void> {
  if (!bridge) {
    // Fallback: use JS-based approach
    await page.evaluate(`
      (() => {
        const container = document.getElementById('antigravity.agentSidePanelInputBox');
        const editor = container?.querySelector('[data-lexical-editor="true"]');
        if (!editor) throw new Error('Could not find input box');
        editor.focus();
        document.execCommand('insertText', false, ${JSON.stringify(message)});
      })()
    `);
    await sleep(500);
    await page.pressKey('Enter');
    return;
  }

  // Get the bounding box of the Lexical editor for a physical mouse click
  const rect = await page.evaluate(`
    (() => {
      const container = document.getElementById('antigravity.agentSidePanelInputBox');
      if (!container) throw new Error('Could not find antigravity.agentSidePanelInputBox');
      const editor = container.querySelector('[data-lexical-editor="true"]');
      if (!editor) throw new Error('Could not find Antigravity input box');
      const r = editor.getBoundingClientRect();
      return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    })()
  `);
  const { x, y } = JSON.parse(String(rect));

  // Physical mouse click to give the element real browser focus
  await bridge.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(50);
  await bridge.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(200);

  // Inject text at the CDP level (no deprecated execCommand)
  await bridge.send('Input.insertText', { text: message });
  await sleep(300);

  // Send Enter via native CDP key event
  await bridge.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await sleep(50);
  await bridge.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
}

async function waitForReply(
  page: IPage,
  beforeText: string,
  opts: { timeout?: number; pollInterval?: number } = {},
): Promise<void> {
  const timeout = opts.timeout ?? 120_000;     // 2 minutes max
  const pollInterval = opts.pollInterval ?? 500; // 500ms polling

  const deadline = Date.now() + timeout;

  // Wait a bit to ensure the UI transitions to "generating" state after we hit Enter
  await sleep(1000);

  let hasStartedGenerating = false;
  let lastText = beforeText;
  let stableCount = 0;
  const stableThreshold = 4; // 4 * 500ms = 2s of stability fallback

  while (Date.now() < deadline) {
    const generating = await isGenerating(page);
    const currentText = await getConversationText(page);
    const textChanged = currentText !== beforeText && currentText.length > 0;

    if (generating) {
      hasStartedGenerating = true;
      stableCount = 0; // Reset stability while generating
    } else {
      if (hasStartedGenerating) {
        // It actively generated and now it stopped -> DONE
        // Provide a small buffer to let React render the final message fully
        await sleep(500);
        return;
      }
      
      // Fallback: If it never showed "Generating/Cancel", but text changed and is stable
      if (textChanged) {
        if (currentText === lastText) {
          stableCount++;
          if (stableCount >= stableThreshold) {
            return; // Text has been stable for 2 seconds -> DONE
          }
        } else {
          stableCount = 0;
          lastText = currentText;
        }
      }
    }

    await sleep(pollInterval);
  }

  throw new Error('Timeout waiting for Antigravity reply');
}

// ─── Request Handlers ────────────────────────────────────────────────

async function handleMessages(
  body: AnthropicRequest,
  page: IPage,
  bridge?: CDPBridge,
): Promise<AnthropicResponse> {
  // Extract the last user message
  const userMessages = body.messages.filter(m => m.role === 'user');
  if (userMessages.length === 0) {
    throw new Error('No user message found in request');
  }
  const lastUserMsg = userMessages[userMessages.length - 1];
  const userText = extractTextContent(lastUserMsg.content);

  if (!userText.trim()) {
    throw new Error('Empty user message');
  }

  // Optimization 1: New conversation if this is the first message in the session
  if (body.messages.length === 1) {
    console.error(`[serve] New session detected (1 message). Starting new conversation in UI.`);
    await startNewConversation(page);
  }

  // Optimization 3: Switch model if requested
  if (body.model) {
    await switchModel(page, body.model);
  }

  // Get conversation state before sending
  const beforeText = await getConversationText(page);

  // Send the message
  console.error(`[serve] Sending: "${userText.slice(0, 80)}${userText.length > 80 ? '...' : ''}"`);
  await sendMessage(page, userText, bridge);

  // Poll for reply (change detection)
  console.error('[serve] Waiting for reply...');
  await waitForReply(page, beforeText);

  // Extract the actual reply text precisely from the DOM
  const replyText = await getLastAssistantReply(page, userText);
  console.error(`[serve] Got reply: "${replyText.slice(0, 80)}${replyText.length > 80 ? '...' : ''}"`);

  return {
    id: generateMsgId(),
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: replyText }],
    model: body.model ?? 'antigravity',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: estimateTokens(userText),
      output_tokens: estimateTokens(replyText),
    },
  };
}

// ─── Server ──────────────────────────────────────────────────────────

export async function startServe(opts: { port?: number } = {}): Promise<void> {
  const port = opts.port ?? 8082;

  // Lazy CDP connection — connect when first request comes in
  let cdp: CDPBridge | null = null;
  let page: IPage | null = null;
  let requestInFlight = false;

  async function ensureConnected(): Promise<IPage> {
    if (page) {
      try {
        await page.evaluate('1+1');
        return page;
      } catch {
        console.error('[serve] CDP connection lost, reconnecting...');
        cdp?.close().catch(() => {});
        cdp = null;
        page = null;
      }
    }

    const endpoint = await resolveElectronEndpoint('antigravity');

    // Note: Antigravity chat panel lives inside editor windows, not in Launchpad.
    // If multiple editor windows are open, set OPENCLI_CDP_TARGET to the window title.
    if (process.env.OPENCLI_CDP_TARGET) {
      console.error(`[serve] Using OPENCLI_CDP_TARGET=${process.env.OPENCLI_CDP_TARGET}`);
    }

    // List available targets for debugging
    try {
      const res = await fetch(`${endpoint.replace(/\/$/, '')}/json`);
      const targets = await res.json() as Array<{ title?: string; type?: string }>;
      const pages = targets.filter(t => t.type === 'page');
      console.error(`[serve] Available targets: ${pages.map(t => `"${t.title}"`).join(', ')}`);
    } catch { /* ignore */ }

    console.error(`[serve] Connecting via CDP (target pattern: "${process.env.OPENCLI_CDP_TARGET}")...`);
    cdp = new CDPBridge();
    try {
      page = await cdp.connect({ timeout: 15_000, cdpEndpoint: endpoint });
    } catch (err: unknown) {
      cdp = null;
      const errMsg = getErrorMessage(err);
      const cause = err instanceof Error ? (err.cause as Record<string, unknown> | undefined) : undefined;
      const isRefused = cause?.code === 'ECONNREFUSED' || errMsg.includes('ECONNREFUSED');
      throw new Error(
        isRefused
          ? `Cannot connect to Antigravity at ${endpoint}.\n` +
            '  1. Make sure Antigravity is running\n' +
            '  2. Launch with: --remote-debugging-port=9234'
          : `CDP connection failed: ${errMsg}`
      );
    }

    console.error('[serve] ✅ CDP connected.');

    // Quick verification
    const hasUI = await page.evaluate(`
      (() => !!document.getElementById('conversation') || !!document.getElementById('antigravity.agentSidePanelInputBox'))()
    `);
    if (!hasUI) {
      console.error('[serve] ⚠️  Warning: chat UI elements not found in this target. Try setting OPENCLI_CDP_TARGET to the correct window title.');
    }

    return page;
  }

  const server = createServer(async (req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-api-key, anthropic-version, Authorization',
      });
      res.end();
      return;
    }

    const url = req.url ?? '/';
    const pathname = url.split('?')[0];

    try {
      // GET /v1/models — return available models
      if (req.method === 'GET' && pathname === '/v1/models') {
        jsonResponse(res, 200, {
          data: [
            {
              id: 'antigravity',
              object: 'model',
              created: Math.floor(Date.now() / 1000),
              owned_by: 'antigravity',
            },
          ],
        });
        return;
      }

      // POST /v1/messages — main endpoint
      if (req.method === 'POST' && pathname === '/v1/messages') {
        if (requestInFlight) {
          jsonResponse(res, 429, {
            type: 'error',
            error: {
              type: 'rate_limit_error',
              message: 'Another request is currently being processed. Antigravity can only handle one request at a time.',
            },
          });
          return;
        }

        requestInFlight = true;
        try {
          const rawBody = await readBody(req);
          const body = JSON.parse(rawBody) as AnthropicRequest;

          if (body.stream) {
            jsonResponse(res, 400, {
              type: 'error',
              error: {
                type: 'invalid_request_error',
                message: 'Streaming is not supported. Set "stream": false.',
              },
            });
            return;
          }

          // Lazy connect on first request
          const activePage = await ensureConnected();
          const response = await handleMessages(body, activePage, cdp ?? undefined);
          jsonResponse(res, 200, response);
        } finally {
          requestInFlight = false;
        }
        return;
      }

      // Health check
      if (req.method === 'GET' && (pathname === '/' || pathname === '/health')) {
        jsonResponse(res, 200, { ok: true, cdpConnected: page !== null });
        return;
      }

      jsonResponse(res, 404, {
        type: 'error',
        error: { type: 'not_found_error', message: `Not found: ${pathname}` },
      });
    } catch (err) {
      console.error('[serve] Error:', err instanceof Error ? err.message : err);
      jsonResponse(res, 500, {
        type: 'error',
        error: {
          type: 'api_error',
          message: err instanceof Error ? err.message : 'Internal server error',
        },
      });
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.error(`\n[serve] ✅ Antigravity API proxy running at http://127.0.0.1:${port}`);
    console.error(`[serve] Compatible with Anthropic /v1/messages API`);
    console.error(`[serve] CDP connection will be established on first request.`);
    console.error(`\n[serve] Usage with Claude Code:`);
    console.error(`  ANTHROPIC_BASE_URL=http://localhost:${port} claude\n`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.error('\n[serve] Shutting down...');
    cdp?.close().catch(() => {});
    server.close();
    process.exit(EXIT_CODES.SUCCESS);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Keep alive
  await new Promise(() => {});
}

