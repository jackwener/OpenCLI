import { Command } from 'commander';
import { emitFailure, emitResult } from '../command-output.js';
import { installCommanderNamespaceStructuredHelp } from '../help.js';
import { normalizeOutputFormat } from '../output-format.js';
import { render } from '../output.js';

export function registerPluginCommands(program: Command): Command {
  const plugin = program.command('plugin').description('Manage OpenCLI plugins');
  plugin.command('install').argument('<source>', 'github:user/repo or file://path')
    .description('Install a plugin').action(async source => {
      const { installPlugin } = await import('../plugin.js');
      const { discoverPlugins } = await import('../discovery.js');
      const installed = installPlugin(source);
      await discoverPlugins();
      emitResult({ installed: Array.isArray(installed) ? installed : [installed] });
    });
  plugin.command('uninstall').argument('<name>').description('Uninstall a plugin').action(async name => {
    const { uninstallPlugin } = await import('../plugin.js');
    uninstallPlugin(name); emitResult({ uninstalled: name });
  });
  plugin.command('update').argument('[name]').option('--all', 'Update all installed plugins')
    .description('Update plugins').action(async (name, opts) => {
      if ((!name && !opts.all) || (name && opts.all)) { emitFailure({ code: 'usage_error', message: 'Specify a plugin name or --all.' }); return; }
      const { updatePlugin, updateAllPlugins } = await import('../plugin.js');
      const { discoverPlugins } = await import('../discovery.js');
      const results = opts.all ? updateAllPlugins() : (updatePlugin(name), [{ name, success: true }]);
      await discoverPlugins();
      if (results.some(row => !row.success)) emitFailure({ code: 'plugin_update_failed', message: 'Some plugins could not be updated.', details: results });
      else emitResult(results);
    });
  plugin.command('list').description('List installed plugins')
    .option('-f, --format <fmt>', 'json, table, yaml, md, csv', normalizeOutputFormat, 'json')
    .action(async opts => {
      const { listPlugins } = await import('../plugin.js');
      render(listPlugins(), { fmt: opts.format, fmtExplicit: true });
    });
  plugin.command('create').argument('<name>').description('Create a plugin scaffold')
    .option('-d, --dir <path>', 'Output directory').option('--description <text>')
    .action(async (name, opts) => {
      const { createPluginScaffold } = await import('../plugin-scaffold.js');
      emitResult(createPluginScaffold(name, opts));
    });
  installCommanderNamespaceStructuredHelp(plugin, { globalCommand: program, description: plugin.description() });
  return plugin;
}
