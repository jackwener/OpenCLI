/**
 * Browser module — public API re-exports.
 *
 * This barrel replaces the former monolithic browser.ts.
 * External code should import from './browser/index.js' (or './browser.js' via Node resolution).
 */

export { Page } from './page.js';
export { PlaywrightMCP } from './mcp.js';
export { getTokenFingerprint, formatBrowserConnectError } from './errors.js';
export type { ConnectFailureKind, ConnectFailureInput } from './errors.js';
export { resolveCdpEndpoint } from './discover.js';

// Test-only helpers — exposed for unit tests
import { createJsonRpcRequest } from './mcp.js';
import { extractTabEntries, diffTabIndexes, appendLimited } from './tabs.js';
import { buildMcpArgs, buildMcpLaunchSpec, findMcpServerPath, resetMcpServerPathCache, setMcpDiscoveryTestHooks, defaultUserDataDir, defaultSessionFile } from './discover.js';
import { withTimeoutMs } from '../runtime.js';

export const __test__ = {
  createJsonRpcRequest,
  extractTabEntries,
  diffTabIndexes,
  appendLimited,
  buildMcpArgs,
  buildMcpLaunchSpec,
  findMcpServerPath,
  resetMcpServerPathCache,
  setMcpDiscoveryTestHooks,
  defaultUserDataDir,
  defaultSessionFile,
  withTimeoutMs,
};
