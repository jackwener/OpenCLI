/**
 * Check whether a given origin string belongs to a browser extension.
 * Accepts both chrome-extension:// (Chrome) and moz-extension:// (Firefox).
 */
export function isExtensionOrigin(origin: string): boolean {
  return origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://');
}

export const COMMAND_RESULT_UNKNOWN_CODE = 'command_result_unknown';

export const COMMAND_RESULT_UNKNOWN_HINT =
  'Inspect the browser/session state before retrying. Do not blindly retry write commands such as navigate, click, type, or eval.';

export const PROFILE_DISCONNECTED_HINT =
  'Open that browser profile and make sure the OpenCLI extension is enabled, or choose another profile with opencli profile use <name>.';

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

export function buildCommandDispatchFailure(contextId: string): DaemonFailureContract {
  return {
    message: `Browser profile "${contextId}" disconnected before command dispatch`,
    errorCode: 'profile_disconnected',
    errorHint: PROFILE_DISCONNECTED_HINT,
    status: 503,
    countAsCommandResultUnknown: false,
  };
}

const CORS_ALLOWED_PATHS = ['/ping', '/ext/poll-register', '/ext/poll', '/ext/poll-result'];

export function getResponseCorsHeaders(pathname: string, origin?: string): Record<string, string> | undefined {
  if (!CORS_ALLOWED_PATHS.includes(pathname)) return undefined;
  if (!origin || !isExtensionOrigin(origin)) return undefined;
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
  };
}
