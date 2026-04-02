/**
 * opencli browser protocol — shared types between daemon, extension, and CLI.
 *
 * 5 actions: exec, navigate, tabs, cookies, screenshot.
 * Everything else is just JS code sent via 'exec'.
 */

export type Action = 'exec' | 'navigate' | 'tabs' | 'cookies' | 'screenshot' | 'close-window' | 'sessions' | 'set-file-input';

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

/** Build ping / WebSocket URLs for a daemon host and port. */
export function buildDaemonEndpoints(host: string, port: number): { ping: string; ws: string } {
  const h = (host || DEFAULT_DAEMON_HOST).trim() || DEFAULT_DAEMON_HOST;
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
