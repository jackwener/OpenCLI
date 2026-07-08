export const COMMAND_RESULT_UNKNOWN_CODE = 'command_result_unknown';

export const COMMAND_RESULT_UNKNOWN_HINT =
  'Inspect the browser/session state before retrying. Do not blindly retry write commands such as navigate, click, type, or eval.';

export const PROFILE_DISCONNECTED_HINT =
  'Open that Chrome profile and make sure the OpenCLI extension is enabled, or choose another profile with opencli profile use <name>.';

export type DaemonFailureContract = {
  message: string;
  errorCode: string;
  errorHint: string;
  status: number;
  countAsCommandResultUnknown: boolean;
};

export function commandResultUnknownMessage(action: string): string {
  return `Browser connection dropped after the ${action} command was dispatched; it may have completed.`;
}

export function buildExtensionDisconnectFailure(input: {
  contextId: string;
  action: string;
  dispatched: boolean;
}): DaemonFailureContract {
  if (input.dispatched) {
    return {
      message: commandResultUnknownMessage(input.action),
      errorCode: COMMAND_RESULT_UNKNOWN_CODE,
      errorHint: COMMAND_RESULT_UNKNOWN_HINT,
      status: 503,
      countAsCommandResultUnknown: true,
    };
  }
  return buildCommandDispatchFailure(input.contextId);
}

export type ProfileRouteInput = {
  /** Hard requirement (--profile / OPENCLI_PROFILE) — never falls back. */
  requestedContextId?: string;
  /** Soft preference (config defaultContextId) — arbitrated against live state. */
  preferredContextId?: string;
  /** contextIds of currently connected extension profiles. */
  connectedContextIds: string[];
};

export type ProfileRouteResult =
  | { ok: true; contextId: string; /** set when a stale preference was overridden by the only live profile */ fallbackFrom?: string }
  | { ok: false; errorCode: 'profile_disconnected' | 'profile_required' | 'extension_not_connected'; error: string; errorHint?: string };

/**
 * Decide which extension profile serves a command. The arbiter lives with the
 * daemon because the daemon is the only component that knows live connections:
 * a REQUIREMENT fails loud when offline, a PREFERENCE falls back to the only
 * connected profile — which keeps the documented promise "with only one
 * connected profile, OpenCLI uses it automatically" true even when a persisted
 * default outlives the extension instance it names.
 */
export function resolveProfileRoute(input: ProfileRouteInput): ProfileRouteResult {
  const requested = input.requestedContextId?.trim() || undefined;
  const preferred = input.preferredContextId?.trim() || undefined;
  const connected = input.connectedContextIds;

  if (requested) {
    if (connected.includes(requested)) return { ok: true, contextId: requested };
    return {
      ok: false,
      errorCode: 'profile_disconnected',
      error: `Browser profile "${requested}" is not connected.`,
      errorHint: PROFILE_DISCONNECTED_HINT,
    };
  }

  if (preferred && connected.includes(preferred)) return { ok: true, contextId: preferred };

  if (connected.length === 1) {
    return { ok: true, contextId: connected[0], ...(preferred ? { fallbackFrom: preferred } : {}) };
  }

  if (connected.length > 1) {
    return {
      ok: false,
      errorCode: 'profile_required',
      error: preferred
        ? `Default browser profile "${preferred}" is not connected and multiple profiles are available; choose one with --profile.`
        : 'Multiple Browser Bridge profiles are connected; choose one with --profile.',
      errorHint: preferred
        ? 'Run opencli profile list, then update the stale default with opencli profile use <name> or pass --profile <name>.'
        : 'Run opencli profile list, then use opencli --profile <name> ... or opencli profile use <name>.',
    };
  }

  return {
    ok: false,
    errorCode: 'extension_not_connected',
    error: 'Extension not connected. Please install the opencli Browser Bridge extension.',
  };
}

export function buildCommandTimeoutFailure(action: string, timeoutMs: number): DaemonFailureContract {
  return {
    message: `Browser ${action} command timed out after ${Math.round(timeoutMs / 1000)}s; it may still complete in the browser.`,
    errorCode: COMMAND_RESULT_UNKNOWN_CODE,
    errorHint: COMMAND_RESULT_UNKNOWN_HINT,
    status: 408,
    countAsCommandResultUnknown: true,
  };
}

export function buildCommandDispatchFailure(contextId: string): DaemonFailureContract {
  return {
    message: `Browser profile "${contextId}" disconnected before command dispatch`,
    errorCode: 'profile_disconnected',
    errorHint: PROFILE_DISCONNECTED_HINT,
    status: 503,
    countAsCommandResultUnknown: false,
  };
}

export function getResponseCorsHeaders(pathname: string, origin?: string): Record<string, string> | undefined {
  if (pathname !== '/ping') return undefined;
  if (!origin || !origin.startsWith('chrome-extension://')) return undefined;
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
  };
}
