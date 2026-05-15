/**
 * Browserbase session validation.
 *
 * OpenCLI consumes Browserbase sessions created by the `bb` CLI. Session
 * creation, proxy selection, and persistent context management stay external;
 * this module only validates a running session and returns its CDP connect URL.
 */

const API_BASE = 'https://api.browserbase.com/v1';

export interface BrowserbaseSession {
  id: string;
  status: string;
  connectUrl: string;
}

export function resolveBrowserbaseSessionId(cliSessionArg?: string): string | null {
  const fromArg = cliSessionArg?.trim();
  if (fromArg) return fromArg;
  const fromEnv = process.env.BROWSERBASE_SESSION_ID?.trim();
  return fromEnv || null;
}

export async function validateBrowserbaseSession(sessionId: string): Promise<BrowserbaseSession> {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) {
    throw new Error(
      'BROWSERBASE_API_KEY not set.\n'
      + '  Set it with: export BROWSERBASE_API_KEY=your_key\n'
      + '  Get your key at: https://browserbase.com/settings',
    );
  }

  const res = await fetch(`${API_BASE}/sessions/${sessionId}`, {
    headers: { 'x-bb-api-key': apiKey },
  });

  if (res.status === 404 || res.status === 400) {
    throw new Error(
      `Browserbase session "${sessionId}" not found.\n`
      + '  Create one with: bb sessions create',
    );
  }

  if (!res.ok) {
    throw new Error(`Browserbase API error: HTTP ${res.status}`);
  }

  const data = await res.json() as Record<string, unknown>;
  const status = String(data.status ?? '');
  if (status !== 'RUNNING') {
    const hints: Record<string, string> = {
      TIMED_OUT: 'Create a new one with: bb sessions create --timeout 3600',
      ERROR: `Check status with: bb sessions get ${sessionId}`,
      COMPLETED: 'Create a new one with: bb sessions create',
      PENDING: 'Wait for it to start, or create a new one with: bb sessions create',
    };
    throw new Error(
      `Browserbase session "${sessionId}" is ${status || 'UNKNOWN'}.\n`
      + `  ${hints[status] || 'Create a new session with: bb sessions create'}`,
    );
  }

  const connectUrl = data.connectUrl;
  if (typeof connectUrl !== 'string' || !connectUrl) {
    throw new Error(`Browserbase session "${sessionId}" did not include a connectUrl.`);
  }

  return {
    id: sessionId,
    status,
    connectUrl,
  };
}
