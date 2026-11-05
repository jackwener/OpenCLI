import { Command, InvalidArgumentError, Option } from 'commander';
import { normalizeContextId, resolveProfileSelection } from '../browser/profile.js';
import { emitFailure, emitResult } from '../command-output.js';
import { installCommanderNamespaceStructuredHelp } from '../help.js';
import { listTraceHistory, showTraceHistory, TRACE_STREAMS, type TraceListReport, type TraceShowReport } from '../observation/history.js';

function integer(value: string): number {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new InvalidArgumentError('Expected a non-negative safe integer.');
  return Number(value);
}

function nonempty(value: string): string {
  if (!value.trim()) throw new InvalidArgumentError('Expected a non-empty value.');
  return value;
}

function plain(value: unknown): string {
  return String(value ?? 'unknown').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
}

function formatTraceList(report: TraceListReport): string {
  const lines = [`Traces (${report.traces.length} shown of ${report.total})`];
  for (const trace of report.traces) {
    lines.push(`${plain(trace.traceId)}  profile=${plain(trace.contextId)}  ${trace.status}  ${trace.createdAt}`);
    lines.push(`  command=${plain(trace.command)}  session=${plain(trace.session)}${trace.expired ? '  retention date elapsed' : ''}`);
    if (trace.error) lines.push(`  ${plain(trace.error.code)} ${plain(trace.error.message)}`);
  }
  if (report.nextOffset !== null) lines.push(`Next page: --offset ${report.nextOffset}`);
  if (report.diagnostics.skipped) lines.push(`Skipped ${report.diagnostics.skipped} unreadable, incomplete, or unsupported receipt(s).`);
  return lines.join('\n');
}

function formatTraceShow(report: TraceShowReport): string {
  const lines = [
    `Trace ${plain(report.trace.traceId)}  profile=${plain(report.trace.contextId)}  ${report.trace.status}`,
    `Captured events=${report.summary.events}  issues=${report.summary.issues}`,
    `Time range ${report.summary.firstEventAt ?? 'unknown'} to ${report.summary.lastEventAt ?? 'unknown'}`,
    `Events (${report.events.length} shown of ${report.selection.total} matching)`,
  ];
  for (const event of report.events) {
    lines.push(`L${event.line} ${new Date(event.ts).toISOString()} ${event.stream}${event.issue ? ' [issue]' : ''} ${plain(JSON.stringify(event.summary))}`);
    if (event.data !== undefined) lines.push(`  ${plain(JSON.stringify(event.data))}`);
  }
  if (report.selection.nextOffset !== null) lines.push(`Next page: --offset ${report.selection.nextOffset}`);
  const diagnostics = report.diagnostics;
  if (Object.values(diagnostics).some(value => value > 0)) {
    lines.push(`Read gaps: malformed=${diagnostics.malformedRecords} unsupported=${diagnostics.unsupportedEvents} oversized=${diagnostics.oversizedRecords}`);
  }
  return lines.join('\n');
}

function addReadOptions(command: Command, defaultLimit: number): Command {
  return command
    .option('--profile <name>', 'Stored profile id or local alias (default: all profiles)', nonempty)
    .option('--limit <n>', 'Maximum rows (1-1000)', integer, defaultLimit)
    .option('--offset <n>', 'Start at this matching row', integer, 0)
    .addOption(new Option('-f, --format <fmt>', 'Output format').choices(['json', 'plain']).default('json'));
}

function contextFor(command: Command): string | undefined {
  const explicit = normalizeContextId(command.optsWithGlobals().profile ?? process.env.OPENCLI_PROFILE);
  // A saved browser default must not hide historical traces from other profiles.
  return explicit ? resolveProfileSelection(explicit)?.contextId : undefined;
}

export function registerTraceCommands(program: Command): Command {
  const trace = program.command('trace').description('Inspect saved execution traces offline')
    .option('--profile <name>', 'Stored profile id or local alias', nonempty);
  addReadOptions(trace.command('list').description('List saved traces, newest first'), 20)
    .addOption(new Option('--status <status>', 'Export outcome').choices(['success', 'failure']))
    .option('--site <site>', 'Match an exact adapter site', nonempty)
    .option('--command <name>', 'Match an exact recorded command', nonempty)
    .option('--session <name>', 'Match an exact session name', nonempty)
    .option('--since <spec>', 'Exports since 24h, 7d, or an ISO date', nonempty)
    .action(async (opts, command: Command) => {
      const report = await listTraceHistory({ ...opts, contextId: contextFor(command) });
      if (opts.format === 'plain') console.log(formatTraceList(report));
      else emitResult(report);
    });
  addReadOptions(trace.command('show').description('Read events from an exact trace id or unique prefix').argument('<trace-id>'), 100)
    .addOption(new Option('--stream <stream>', 'Only events from this stream').choices(TRACE_STREAMS))
    .option('--issues', 'Only errors, warnings, and failed network events', false)
    .option('--include-data', 'Include bounded, redacted event payloads', false)
    .action(async (id: string, opts, command: Command) => {
      const report = await showTraceHistory(id, { ...opts, contextId: contextFor(command) });
      if (opts.format === 'plain') console.log(formatTraceShow(report));
      else emitResult(report);
    });
  installCommanderNamespaceStructuredHelp(trace, { globalCommand: program, description: trace.description() });
  return trace;
}

/** Dedicated startup keeps history inspection available when adapters cannot load. */
export async function runTraceCli(argv: string[]): Promise<void> {
  const program = new Command().name('opencli').enablePositionalOptions()
    .option('--profile <name>', 'Stored profile id or local alias', nonempty)
    .exitOverride().configureOutput({ writeErr: () => {} });
  registerTraceCommands(program);
  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (error) {
    if ((error as { code?: string }).code === 'commander.helpDisplayed') return;
    emitFailure(error);
  }
}
