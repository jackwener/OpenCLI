import { Command, InvalidArgumentError } from 'commander';
import { normalizeOutputFormat } from '../output-format.js';
import { render } from '../output.js';
import { fullName, getRegistry } from '../registry.js';

function integer(value: string): number {
  if (!/^\d+$/.test(value)) throw new InvalidArgumentError('Expected a non-negative integer.');
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new InvalidArgumentError('Integer is too large.');
  return number;
}

export function registerListCommand(program: Command): void {
  program.command('list').argument('[query]', 'Filter command names and descriptions')
    .description('Find available capabilities; inspect a command with --help -f json')
    .option('--site <site>', 'Only adapters for this site')
    .option('--limit <n>', 'Maximum results (1–100)', integer, 25)
    .option('--offset <n>', 'Start offset from the previous result', integer, 0)
    .option('-f, --format <fmt>', 'json, table, yaml, md, csv', normalizeOutputFormat, 'json')
    .action((query, opts) => {
      if (opts.limit < 1 || opts.limit > 100) throw new InvalidArgumentError('--limit must be between 1 and 100.');
      const adapters = [...new Set(getRegistry().values())];
      const sites = new Set(adapters.map(cmd => cmd.site));
      const rows: Array<{ command: string; description: string; access?: string }> = adapters
        .filter(cmd => !opts.site || cmd.site === opts.site)
        .map(cmd => ({ command: fullName(cmd).replace('/', ' '), description: cmd.description, access: cmd.access }));
      if (!opts.site) {
        const walk = (cmd: Command, prefix: string[]) => {
          if (cmd === program) { for (const child of cmd.commands) if (!sites.has(child.name())) walk(child, []); return; }
          const names = [...prefix, cmd.name()];
          if (cmd.commands.length) { for (const child of cmd.commands) walk(child, names); }
          else rows.push({ command: names.join(' '), description: cmd.description() });
        };
        walk(program, []);
      }
      const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
      const matches = rows.filter(row => terms.every(term => `${row.command} ${row.description}`.toLowerCase().includes(term)))
        .sort((a, b) => a.command.localeCompare(b.command));
      const commands = matches.slice(opts.offset, opts.offset + opts.limit);
      render(opts.format === 'json' ? {
        commands, total: matches.length,
        ...(opts.offset + commands.length < matches.length ? { nextOffset: opts.offset + commands.length } : {})
      } : commands,
        { fmt: opts.format, fmtExplicit: true });
    });
}
