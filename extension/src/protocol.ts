/**
 * opencli browser protocol — shared types between daemon, extension, and CLI.
 *
 * 5 actions: exec, navigate, tabs, cookies, screenshot.
 * Everything else is just JS code sent via 'exec'.
 */

export type Action =
  | 'exec'
  | 'navigate'
  | 'tabs'
  | 'cookies'
  | 'screenshot'
  | 'close-window'
  | 'sessions'
  | 'set-file-input'
  | 'insert-text'
  | 'bind-current'
  | 'network-capture-start'
  | 'network-capture-read'
  | 'cdp';

export interface Command {
  /** Unique request ID */
  id: string;
  /** Action type */
  action: Action;
  /** Target tab ID (omit for active tab) */
  tabId?: number;
  /** JS code to evaluate in page context (exec action) */
  code?: string;
  /** Logical workspace for automation session reuse */
  workspace?: string;
  /** URL to navigate to (navigate action) */
  url?: string;
  /** Sub-operation for tabs: list, new, close, select */
  op?: 'list' | 'new' | 'close' | 'select';
  /** Tab index for tabs select/close */
  index?: number;
  /** Cookie domain filter */
  domain?: string;
  /** Optional hostname/domain to require for current-tab binding */
  matchDomain?: string;
  /** Optional pathname prefix to require for current-tab binding */
  matchPathPrefix?: string;
  /** Screenshot format: png (default) or jpeg */
  format?: 'png' | 'jpeg';
  /** JPEG quality (0-100), only for jpeg format */
  quality?: number;
  /** Whether to capture full page (not just viewport) */
  fullPage?: boolean;
  /** Local file paths for set-file-input action */
  files?: string[];
  /** CSS selector for file input element (set-file-input action) */
  selector?: string;
  /** Raw text payload for insert-text action */
  text?: string;
  /** URL substring filter pattern for network capture actions */
  pattern?: string;
  /** CDP method name for 'cdp' action (e.g. 'Accessibility.getFullAXTree') */
  cdpMethod?: string;
  /** CDP method params for 'cdp' action */
  cdpParams?: Record<string, unknown>;
}

export interface Result {
  /** Matching request ID */
  id: string;
  /** Whether the command succeeded */
  ok: boolean;
  /** Result data on success */
  data?: unknown;
  /** Error message on failure */
  error?: string;
}

/** Default daemon host (overridable in extension popup) */
export const DEFAULT_DAEMON_HOST = 'localhost';

/** Default daemon port */
export const DEFAULT_DAEMON_PORT = 19825;

/** Normalize legacy host input that may accidentally include a scheme or port. */
export function normalizeDaemonHost(host: string | null | undefined): string {
  let value = (host || '').trim();
  if (!value) return DEFAULT_DAEMON_HOST;

  if (value.includes('://')) {
    try {
      value = new URL(value).hostname || value;
    } catch {
      value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    }
  }

  value = value.replace(/[/?#].*$/, '');

  const bracketedIpv6Match = value.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketedIpv6Match?.[1]) return bracketedIpv6Match[1];

  const colonCount = (value.match(/:/g) || []).length;
  if (colonCount === 1) {
    const [hostname] = value.split(':');
    value = hostname || value;
  }

  return value.trim() || DEFAULT_DAEMON_HOST;
}

/** Build ping / WebSocket URLs for a daemon host and port. */
export function buildDaemonEndpoints(host: string, port: number): { ping: string; ws: string } {
  const h = normalizeDaemonHost(host);
  const p = Number.isFinite(port) && port >= 1 && port <= 65535 ? port : DEFAULT_DAEMON_PORT;
  const hostPart = h.includes(':') && !h.startsWith('[') ? `[${h}]` : h;
  return {
    ping: `http://${hostPart}:${p}/ping`,
    ws: `ws://${hostPart}:${p}/ext`,
  };
}

/** Base reconnect delay for extension WebSocket (ms) */
export const WS_RECONNECT_BASE_DELAY = 2000;
/** Max reconnect delay (ms) — kept short since daemon is long-lived */
export const WS_RECONNECT_MAX_DELAY = 5000;
