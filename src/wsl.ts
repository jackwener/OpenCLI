/**
 * WSL detection for diagnostics.
 *
 * When opencli runs inside WSL, the Browser Bridge extension still lives in
 * Windows Chrome while the daemon listens inside the WSL VM, so every command
 * crosses the WSL2 VM boundary via localhost forwarding. That path is
 * intermittently unstable outside OpenCLI's control (notably in NAT
 * networking mode), which surfaces as "daemon running, extension not
 * connected". Doctor uses this module to turn that generic symptom into an
 * actionable hint instead of a reinstall loop.
 */

import * as fs from 'node:fs';

export type WslProbe = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Contents of /proc/version, or null when unavailable. */
  procVersion?: string | null;
};

/**
 * Whether the current process looks like it runs inside WSL.
 *
 * Accepts injected values so unit tests can simulate WSL without touching
 * the real environment. All parameters fall back to live process state.
 */
export function isWslEnvironment(probe: WslProbe = {}): boolean {
  const env = probe.env ?? process.env;
  const platform = probe.platform ?? process.platform;

  // Strong markers: only ever set inside a WSL guest.
  if (env.WSL_DISTRO_NAME?.trim()) return true;
  if (env.WSL_INTEROP?.trim()) return true;

  // WSLENV alone is not a detector: it also exists on Windows hosts when
  // interop is configured, and it can leak into native-Linux environments
  // via dotfiles or `docker run -e`. Real WSL guests always carry one of
  // the strong markers above or a microsoft kernel, so ignore it here.

  if (platform === 'linux') {
    const version = probe.procVersion !== undefined ? probe.procVersion : readProcVersion();
    if (version && version.toLowerCase().includes('microsoft')) return true;
  }

  return false;
}

function readProcVersion(): string | null {
  try {
    return fs.readFileSync('/proc/version', 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Actionable doctor issue for a disconnected extension under WSL.
 *
 * Mentions the authenticated daemon log dump: GET /logs requires the
 * X-OpenCLI header, so a bare `curl localhost:19825/logs` answers 403.
 */
export function buildWslExtensionIssue(): string {
  return (
    'WSL detected: the Browser Bridge extension runs in Windows Chrome while the daemon runs inside WSL, ' +
    'so traffic crosses the WSL2 VM boundary (localhost forwarding). That path is intermittently unstable outside ' +
    "OpenCLI's control, especially in NAT networking mode. WSL is not an officially supported OpenCLI environment (see #1565).\n" +
    '  Check the mode with: wslinfo --networking-mode\n' +
    '  If it shows "nat", switching to mirrored mode can stabilize the connection ' +
    '(recent WSL only: set networkingMode=mirrored in your .wslconfig, then apply with: wsl --shutdown).\n' +
    '  Then run: opencli daemon restart\n' +
    '  If it still fails right after a disconnect, dump the daemon log buffer with:\n' +
    `    curl -H "X-OpenCLI: 1" "localhost:19825/logs"\n` +
    '  The most stable setup is running the CLI on Windows native (PowerShell or Git Bash), since the extension already lives in Windows Chrome.'
  );
}
