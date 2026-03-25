/**
 * Channel — Event subscription protocol for OpenCLI.
 *
 * CLI subcommands:
 *   opencli channel sources [name]        — list available sources
 *   opencli channel subscribe <origin>    — subscribe to events
 *   opencli channel unsubscribe <origin>  — remove subscription
 *   opencli channel subscriptions         — list current subscriptions
 *   opencli channel start [-d]            — start polling daemon
 *   opencli channel stop                  — stop daemon
 *   opencli channel status                — show stats
 *   opencli channel poll <origin>         — one-shot poll
 */

import { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';

import { CursorStore } from './cursor-store.js';
import { Dedup } from './dedup.js';
import { SubscriptionRegistry } from './registry.js';
import { Scheduler, type SinkFactory } from './scheduler.js';
import type { ChannelSink, ChannelSource } from './types.js';

// Sources
import { GitHubSource } from './sources/github.js';

// Sinks
import { StdoutSink } from './sinks/stdout.js';
import { WebhookSink } from './sinks/webhook.js';

// ── Constants ───────────────────────────────────────────────────────

const CHANNEL_DIR = join(homedir(), '.opencli', 'channel');
const PID_FILE = join(CHANNEL_DIR, 'daemon.pid');

// ── Source / Sink registries ────────────────────────────────────────

function getSources(): Map<string, ChannelSource> {
  const map = new Map<string, ChannelSource>();
  map.set('github', new GitHubSource());
  return map;
}

/** Factory that creates a fresh sink instance per subscription. */
function createSink(name: string, _config: Record<string, unknown>): ChannelSink {
  switch (name) {
    case 'stdout': return new StdoutSink();
    case 'webhook': return new WebhookSink();
    default: throw new Error(`Unknown sink: ${name}`);
  }
}

// ── CLI registration ────────────────────────────────────────────────

export function registerChannelCommand(program: Command): void {
  const channel = program
    .command('channel')
    .description('Event subscription — subscribe to platform events and receive them in your session');

  // ── sources ─────────────────────────────────────────────────────

  channel
    .command('sources [name]')
    .description('List available event sources (or subscribable items for a specific source)')
    .action(async (name?: string) => {
      const sources = getSources();

      if (!name) {
        // List all sources
        console.log('Available sources:\n');
        for (const [sourceName, source] of sources) {
          console.log(`  ${sourceName}`);
          const items = await source.listSubscribable({});
          for (const item of items.slice(0, 5)) {
            console.log(`    ${item.origin}  —  ${item.description}`);
          }
          if (items.length > 5) console.log(`    ... and ${items.length - 5} more`);
          console.log();
        }
        return;
      }

      const source = sources.get(name);
      if (!source) {
        console.error(`Unknown source: ${name}`);
        console.error(`Available: ${[...sources.keys()].join(', ')}`);
        process.exit(1);
      }

      const items = await source.listSubscribable({});
      console.log(`Subscribable items from ${name}:\n`);
      for (const item of items) {
        console.log(`  ${item.origin}  —  ${item.description}`);
      }
    });

  // ── subscribe ───────────────────────────────────────────────────

  channel
    .command('subscribe <origin>')
    .description('Subscribe to events from an origin (e.g. github:owner/repo#42)')
    .option('-s, --sink <sink>', 'Sink to deliver events to', 'stdout')
    .option('-i, --interval <ms>', 'Poll interval in milliseconds', '60000')
    .option('--webhook-url <url>', 'Webhook URL (when sink=webhook)')
    .action(async (origin: string, opts: { sink: string; interval: string; webhookUrl?: string }) => {
      // Validate origin can be parsed by some source
      const sources = getSources();
      let parsed = false;
      for (const source of sources.values()) {
        if (source.parseOrigin(origin)) { parsed = true; break; }
      }
      if (!parsed) {
        console.error(`Cannot parse origin: ${origin}`);
        console.error('Expected format: github:owner/repo, github:owner/repo#42, etc.');
        process.exit(1);
      }

      // Validate interval
      const intervalMs = parseInt(opts.interval, 10);
      if (isNaN(intervalMs) || intervalMs < 0) {
        console.error(`Invalid interval: ${opts.interval}. Must be a positive number in milliseconds.`);
        process.exit(1);
      }

      // Validate webhook config
      if (opts.sink === 'webhook' && !opts.webhookUrl) {
        console.error('Webhook sink requires --webhook-url.');
        process.exit(1);
      }

      const sinkConfig: Record<string, unknown> = {};
      if (opts.sink === 'webhook' && opts.webhookUrl) {
        sinkConfig.url = opts.webhookUrl;
      }

      const registry = new SubscriptionRegistry();
      await registry.load();
      const sub = registry.add(origin, opts.sink, sinkConfig, intervalMs);
      await registry.save();

      console.log(`✅ Subscribed to ${origin}`);
      console.log(`   ID: ${sub.id}`);
      console.log(`   Sink: ${opts.sink}`);
      console.log(`   Interval: ${opts.interval}ms`);
    });

  // ── unsubscribe ─────────────────────────────────────────────────

  channel
    .command('unsubscribe <origin>')
    .description('Remove subscription for an origin')
    .action(async (origin: string) => {
      const registry = new SubscriptionRegistry();
      await registry.load();
      const removed = registry.remove(origin);
      await registry.save();

      if (removed) {
        console.log(`✅ Unsubscribed from ${origin}`);
      } else {
        console.log(`No subscription found for ${origin}`);
      }
    });

  // ── subscriptions ───────────────────────────────────────────────

  channel
    .command('subscriptions')
    .alias('list')
    .description('List current subscriptions')
    .option('-f, --format <fmt>', 'Output format: table, json', 'table')
    .action(async (opts: { format: string }) => {
      const registry = new SubscriptionRegistry();
      await registry.load();
      const subs = registry.list();

      if (subs.length === 0) {
        console.log('No subscriptions. Use `opencli channel subscribe <origin>` to add one.');
        return;
      }

      if (opts.format === 'json') {
        console.log(JSON.stringify(subs, null, 2));
        return;
      }

      // Table output
      const header = ['ORIGIN', 'SINK', 'INTERVAL', 'CREATED'];
      const rows = subs.map(s => [
        s.origin,
        s.sink,
        s.intervalMs > 0 ? `${s.intervalMs}ms` : 'default',
        new Date(s.createdAt).toLocaleDateString(),
      ]);

      const widths = header.map((h, i) =>
        Math.max(h.length, ...rows.map(r => r[i].length)),
      );

      console.log(header.map((h, i) => h.padEnd(widths[i])).join('  '));
      console.log(widths.map(w => '─'.repeat(w)).join('  '));
      for (const row of rows) {
        console.log(row.map((v, i) => v.padEnd(widths[i])).join('  '));
      }
    });

  // ── start ───────────────────────────────────────────────────────

  channel
    .command('start')
    .description('Start the channel polling daemon')
    .option('-d, --daemon', 'Run in background')
    .action(async (opts: { daemon?: boolean }) => {
      if (opts.daemon) {
        // Check for stale PID file
        if (existsSync(PID_FILE)) {
          const existingPid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
          try {
            process.kill(existingPid, 0);
            console.error(`Channel daemon already running (PID: ${existingPid}). Use 'opencli channel stop' first.`);
            process.exit(1);
          } catch {
            // Stale PID, clean up
            unlinkSync(PID_FILE);
          }
        }

        // Spawn detached child
        const child = spawn(process.execPath, [process.argv[1], 'channel', 'start'], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
        if (!child.pid) {
          console.error('Failed to spawn daemon process.');
          process.exit(1);
        }
        writeFileSync(PID_FILE, String(child.pid));
        console.log(`Channel daemon started (PID: ${child.pid})`);
        return;
      }

      // Foreground mode
      console.log('Starting channel daemon (foreground)...');
      const registry = new SubscriptionRegistry();
      await registry.load();

      const subs = registry.list();
      if (subs.length === 0) {
        console.log('No subscriptions. Use `opencli channel subscribe <origin>` first.');
        process.exit(0);
      }

      const cursors = new CursorStore();
      await cursors.load();

      const sources = getSources();

      const dedup = new Dedup();
      const scheduler = new Scheduler(sources, createSink, registry, cursors, dedup);

      const shutdown = (): void => {
        console.log('\nStopping channel daemon...');
        scheduler.stop();
        try { unlinkSync(PID_FILE); } catch {}
        // Flush cursors before exit
        cursors.save().catch(() => {}).finally(() => process.exit(0));
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      // Write PID for status/stop
      writeFileSync(PID_FILE, String(process.pid));

      console.log(`Polling ${subs.length} subscription(s)...`);
      for (const sub of subs) {
        console.log(`  ${sub.origin} → ${sub.sink}`);
      }
      console.log();

      await scheduler.start();
    });

  // ── stop ────────────────────────────────────────────────────────

  channel
    .command('stop')
    .description('Stop the channel daemon')
    .action(() => {
      if (!existsSync(PID_FILE)) {
        console.log('No daemon running (no PID file).');
        return;
      }

      const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
      try {
        process.kill(pid, 'SIGTERM');
        unlinkSync(PID_FILE);
        console.log(`Channel daemon stopped (PID: ${pid})`);
      } catch {
        unlinkSync(PID_FILE);
        console.log('Daemon was not running. Cleaned up PID file.');
      }
    });

  // ── status ──────────────────────────────────────────────────────

  channel
    .command('status')
    .description('Show channel daemon status and cursor positions')
    .action(async () => {
      // Check daemon
      let daemonRunning = false;
      if (existsSync(PID_FILE)) {
        const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
        try {
          process.kill(pid, 0); // Check if alive
          daemonRunning = true;
        } catch {
          // Not running
        }
      }
      console.log(`Daemon: ${daemonRunning ? '🟢 running' : '⚪ stopped'}`);
      console.log();

      // Subscriptions
      const registry = new SubscriptionRegistry();
      await registry.load();
      const subs = registry.list();
      console.log(`Subscriptions: ${subs.length}`);

      if (subs.length === 0) return;

      // Cursors
      const cursors = new CursorStore();
      await cursors.load();

      console.log();
      const header = ['ORIGIN', 'SINK', 'LAST POLL', 'EVENTS'];
      const rows = subs.map(s => {
        const c = cursors.get(s.origin);
        return [
          s.origin,
          s.sink,
          c?.lastPoll ? new Date(c.lastPoll).toLocaleString() : 'never',
          String(c?.eventsDelivered ?? 0),
        ];
      });

      const widths = header.map((h, i) =>
        Math.max(h.length, ...rows.map(r => r[i].length)),
      );
      console.log(header.map((h, i) => h.padEnd(widths[i])).join('  '));
      console.log(widths.map(w => '─'.repeat(w)).join('  '));
      for (const row of rows) {
        console.log(row.map((v, i) => v.padEnd(widths[i])).join('  '));
      }
    });

  // ── poll (one-shot) ─────────────────────────────────────────────

  channel
    .command('poll <origin>')
    .description('One-shot poll: fetch events and print to stdout')
    .option('--since <cursor>', 'Poll from specific cursor/timestamp')
    .action(async (origin: string, opts: { since?: string }) => {
      const sources = getSources();

      // Find matching source
      let matchedSource: ChannelSource | undefined;
      for (const source of sources.values()) {
        if (source.parseOrigin(origin)) {
          matchedSource = source;
          break;
        }
      }

      if (!matchedSource) {
        console.error(`Cannot parse origin: ${origin}`);
        process.exit(1);
      }

      const config = matchedSource.parseOrigin(origin)!;
      const cursor = opts.since ?? null;

      const result = await matchedSource.poll(config, cursor);

      for (const event of result.events) {
        process.stdout.write(JSON.stringify(event) + '\n');
      }

      if (result.events.length === 0) {
        console.error('(no new events)');
      } else {
        console.error(`${result.events.length} event(s). cursor: ${result.cursor}`);
      }
    });
}
