/**
 * CLI: opencli host status | install
 */

import { fetchDaemonStatus } from '../browser/daemon-transport.js';
import { formatDuration } from '../download/progress.js';
import { log } from '../logger.js';
import { PKG_VERSION } from '../version.js';
import { installNativeHostManifest, nativeHostManifestInstalled } from '../native-manifest.js';
import { NATIVE_HOST_NAME } from '../host-protocol.js';

export async function hostStatus(): Promise<void> {
  const status = await fetchDaemonStatus();
  if (!status) {
    console.log('Host: not running (open Chrome with the OpenCLI extension enabled)');
    console.log(`Native manifest: ${nativeHostManifestInstalled() ? 'installed' : 'missing — will be written on the next browser command, or run opencli host install to repair'}`);
    return;
  }

  let extensionLabel: string;
  if (status.extensionConnected) {
    extensionLabel = status.extensionVersion
      ? `connected (v${status.extensionVersion})`
      : 'connected (version unknown)';
  } else if (status.profileRequired) {
    const count = status.profiles?.length ?? 0;
    extensionLabel = `${count} ${count === 1 ? 'profile' : 'profiles'} connected, none selected — run \`opencli profile use <name>\``;
  } else if (status.profileDisconnected) {
    extensionLabel = 'requested profile not connected — run `opencli profile use <name>`';
  } else {
    extensionLabel = 'disconnected';
  }

  const version = status.hostVersion;
  const stale = Boolean(version && version !== PKG_VERSION);
  console.log(`Host: ${stale ? 'stale' : 'running'} (PID ${status.pid})`);
  console.log(`Version: ${version ? `v${version}` : 'unknown'}${stale ? ` (CLI v${PKG_VERSION}; reload the OpenCLI extension)` : ''}`);
  console.log(`Uptime: ${formatDuration(Math.round(status.uptime * 1000))}`);
  console.log(`Extension: ${extensionLabel}`);
  if (status.sock) console.log(`Socket: ${status.sock}`);
  if (status.profiles && status.profiles.length > 0) {
    console.log(`Profiles: ${status.profiles.map((profile) => {
      const v = profile.extensionVersion ? ` v${profile.extensionVersion}` : '';
      return `${profile.contextId}${v}`;
    }).join(', ')}`);
  }
  console.log(`Memory: ${status.memoryMB} MB`);
}

export async function hostInstall(): Promise<void> {
  const result = installNativeHostManifest();
  log.success(`Installed ${NATIVE_HOST_NAME} → ${result.binaryPath}`);
  for (const file of result.files) log.status(file);
  if (result.files.length === 0) {
    log.warn('No Chrome NativeMessagingHosts directory was found. Load the OpenCLI extension, then rerun.');
  }
  log.status('Reload the OpenCLI extension so Chrome spawns the host.');
}
