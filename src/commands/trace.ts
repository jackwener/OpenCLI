import { Command, InvalidArgumentError, Option } from 'commander';
import { normalizeContextId, resolveProfileSelection } from '../browser/profile.js';
import { normalizeOutputFormat } from '../output-format.js';
import { render } from '../output.js';
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

function renderList(report: TraceListReport, fmt: string): void {
  const rows = report.traces.map(trace => ({
    traceId: plain(trace.traceId), contextId: plain(trace.contextId),
    status: trace.status, createdAt: trace.createdAt, expired: trace.expired, site: plain(trace.site),
    command: plain(trace.command), session: plain(trace.session),
    error: trace.error ? plain(`${trace.error.code ?? ''} ${trace.error.message}`) : null,
  }));
  render(fmt === 'json' || fmt === 'yaml' ? report : rows, {
    fmt, fmtExplicit: true,
    columns: ['traceId', 'contextId', 'status', 'createdAt', 'command', 'session', 'error'],
    footerExtra: `total=${report.total}, nextOffset=${report.nextOffset}, skipped=${report.diagnostics.skipped}`,
  });
}

function renderShow(report: TraceShowReport, fmt: string): void {
  const rows = report.events.map(event => ({
    line: event.line, time: new Date(event.ts).toISOString(), stream: event.stream, issue: event.issue,
    summary: plain(JSON.stringify(event.summary)),
    ...(event.data === undefined ? {} : { data: plain(JSON.stringify(event.data)) }),
  }));
  render(fmt === 'json' || fmt === 'yaml' ? report : rows, {
    fmt, fmtExplicit: true,
    columns: ['line', 'time', 'stream', 'issue', 'summary', ...(report.selection.includeData ? ['data'] : [])],
    footerExtra: `total=${report.selection.total}, nextOffset=${report.selection.nextOffset}, diagnostics=${JSON.stringify(report.diagnostics)}`,
  });
}

function addReadOptions(command: Command, defaultLimit: number): Command {
  return command
    .option('--profile <name>', 'Stored profile id or alias (default: OPENCLI_PROFILE, otherwise all profiles)', nonempty)
    .option('--limit <n>', 'Maximum rows (1-1000)', integer, defaultLimit)
    .option('--offset <n>', 'Start at this matching row', integer, 0)
    .option('-f, --format <fmt>', 'Output format: json, table, plain, yaml, md, csv', normalizeOutputFormat, 'json');
}

function contextFor(command: Command): string | undefined {
  const explicit = normalizeContextId(command.optsWithGlobals().profile ?? process.env.OPENCLI_PROFILE);
  // A saved browser default must not hide historical traces from other profiles.
  return explicit ? resolveProfileSelection(explicit)?.contextId : undefined;
}

export function registerTraceCommands(program: Command): Command {
  const trace = program.command('trace').description('Inspect saved execution traces offline')
    .option('--profile <name>', 'Stored profile id or alias (default: OPENCLI_PROFILE, otherwise all profiles)', nonempty);
  addReadOptions(trace.command('list').description('List saved traces, newest first'), 20)
    .addOption(new Option('--status <status>', 'Export outcome').choices(['success', 'failure']))
    .option('--site <site>', 'Match an exact adapter site', nonempty)
    .option('--command <name>', 'Match an exact recorded command', nonempty)
    .option('--session <name>', 'Match an exact session name', nonempty)
    .option('--since <duration>', 'Exports from the last duration (for example: 500ms, 30s, 2m, 24h)', nonempty)
    .action(async (opts, command: Command) => {
      const report = await listTraceHistory({ ...opts, contextId: contextFor(command) });
      renderList(report, opts.format);
    });
  addReadOptions(trace.command('show').description('Read events from an exact trace id or unique prefix').argument('<trace-id>'), 100)
    .addOption(new Option('--stream <stream>', 'Only events from this stream').choices(TRACE_STREAMS))
    .option('--issues', 'Only errors, warnings, and failed network events', false)
    .option('--include-data', 'Include bounded, redacted event payloads', false)
    .action(async (id: string, opts, command: Command) => {
      const report = await showTraceHistory(id, { ...opts, contextId: contextFor(command) });
      renderShow(report, opts.format);
    });
  installCommanderNamespaceStructuredHelp(trace, { globalCommand: program, description: trace.description() });
  return trace;
}
