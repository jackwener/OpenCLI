import { Command } from 'commander';
import { fetchDaemonStatus } from '../browser/daemon-transport.js';
import { isDaemonStale } from '../browser/daemon-version.js';
import { aliasForContextId, loadProfileConfig, renameProfile, setDefaultProfile } from '../browser/profile.js';
import { emitResult } from '../command-output.js';
import { installCommanderNamespaceStructuredHelp } from '../help.js';
import { PKG_VERSION } from '../version.js';

export function registerProfileCommands(program: Command): Command {
  const profile = program.command('profile').description('Manage Chrome profiles');
  profile.command('list').description('List connected and saved Chrome profiles').action(async () => {
    const status = await fetchDaemonStatus();
    const config = loadProfileConfig();
    const connected = status?.profiles ?? [];
    const ids = new Set([...connected.map(p => p.contextId), ...Object.values(config.aliases), ...(config.defaultContextId ? [config.defaultContextId] : [])]);
    emitResult({
      daemonRunning: !!status, daemonStale: status ? isDaemonStale(status, PKG_VERSION) : false,
      profiles: [...ids].map(contextId => ({
contextId, alias: aliasForContextId(config, contextId),
        default: contextId === config.defaultContextId, connected: connected.some(p => p.contextId === contextId),
        extensionVersion: connected.find(p => p.contextId === contextId)?.extensionVersion
}))
    });
  });
  profile.command('rename').argument('<contextId>').argument('<alias>').description('Assign a local alias')
    .action((contextId, alias) => { renameProfile(contextId, alias); emitResult({ contextId, alias }); });
  profile.command('use').argument('<profile>').description('Select the default Chrome profile')
    .action(name => { const config = setDefaultProfile(name); emitResult({ defaultContextId: config.defaultContextId }); });
  installCommanderNamespaceStructuredHelp(profile, { globalCommand: program, description: profile.description() });
  return profile;
}
