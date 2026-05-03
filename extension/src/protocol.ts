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
  | 'bind'
  | 'network-capture-start'
  | 'network-capture-read'
  | 'cdp'
  | 'frames';

/**
 * Offscreen transport messages.
 *
 * The offscreen document owns the daemon WebSocket; the MV3 service worker only
 * executes Chrome API commands relayed through runtime messaging.
 */
export const OFFSCREEN_DOCUMENT = 'offscreen.html';
export const MSG_EXECUTE_COMMAND = 'opencli:execute-command';
export const MSG_BRIDGE_INIT = 'opencli:bridge-init';

export interface Command {
  /** Unique request ID */
  id: string;
  /** Action type */
  action: Action;
  /** Target page identity (targetId). Cross-layer contract with the daemon. */
  page?: string;
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
  /** When true, the owned automation container is created in the foreground (focused) */
  windowFocused?: boolean;
  /** Custom idle timeout in seconds for this workspace session. Overrides the default. */
  idleTimeout?: number;
  /** Explicitly allow navigation inside a borrowed bound tab. */
  allowBoundNavigation?: boolean;
  /** Frame index for cross-frame operations (0-based, from 'frames' action) */
  frameIndex?: number;
  /** Browser profile/context selected by the CLI. Used by the daemon for routing. */
  contextId?: string;
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
  /** Stable machine-readable error code on failure */
  errorCode?: string;
  /** Optional recovery hint for agent-facing CLI output */
  errorHint?: string;
  /** Page identity (targetId) — present only on page-scoped command responses */
  page?: string;
}

export interface BridgeInitMessage {
  type: typeof MSG_BRIDGE_INIT;
  contextId: string;
  version: string;
  compatRange: string;
}

export interface ExecuteCommandMessage {
  type: typeof MSG_EXECUTE_COMMAND;
  command: Command;
}

/** Default daemon port */
export const DAEMON_PORT = 19825;
export const DAEMON_HOST = 'localhost';
export const DAEMON_WS_URL = `ws://${DAEMON_HOST}:${DAEMON_PORT}/ext`;
/** Lightweight health-check endpoint — probed before each WebSocket attempt. */
export const DAEMON_PING_URL = `http://${DAEMON_HOST}:${DAEMON_PORT}/ping`;

/** Base reconnect delay for extension WebSocket (ms) */
export const WS_RECONNECT_BASE_DELAY = 2000;
/** Max reconnect delay (ms) — kept short since daemon is long-lived */
export const WS_RECONNECT_MAX_DELAY = 5000;
