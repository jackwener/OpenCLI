/**
 * CLI commands for daemon lifecycle management:
 *   opencli daemon status  — show daemon state
 *   opencli daemon stop    — graceful shutdown
 *   opencli daemon restart — stop + respawn
 */

import chalk from 'chalk';
import { DEFAULT_DAEMON_PORT } from '../constants.js';

const DAEMON_PORT = parseInt(process.env.OPENCLI_DAEMON_PORT ?? String(DEFAULT_DAEMON_PORT), 10);
const DAEMON_URL = `http://127.0.0.1:${DAEMON_PORT}`;

interface DaemonStatus {
  ok: boolean;
  pid: number;
  uptime: number;
  extensionConnected: boolean;
  pending: number;
  lastCliRequestTime: number;
  memoryMB: number;
  port: number;
}

async function fetchStatus(): Promise<DaemonStatus | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${DAEMON_URL}/status`, {
      headers: { 'X-OpenCLI': '1' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json() as DaemonStatus;
  } catch {
    return null;
  }
}

async function requestShutdown(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${DAEMON_URL}/shutdown`, {
      method: 'POST',
      headers: { 'X-OpenCLI': '1' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(seconds)}s`;
}

function formatTimeSince(timestampMs: number): string {
  const seconds = (Date.now() - timestampMs) / 1000;
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

export async function daemonStatus(): Promise<void> {
  const status = await fetchStatus();
  if (!status) {
    console.log(`Daemon: ${chalk.dim('not running')}`);
    return;
  }

  console.log(`Daemon: ${chalk.green('running')} (PID ${status.pid})`);
  console.log(`Uptime: ${formatUptime(status.uptime)}`);
  console.log(`Extension: ${status.extensionConnected ? chalk.green('connected') : chalk.yellow('disconnected')}`);
  console.log(`Last CLI request: ${formatTimeSince(status.lastCliRequestTime)}`);
  console.log(`Memory: ${status.memoryMB} MB`);
  console.log(`Port: ${status.port}`);
}

export async function daemonStop(): Promise<void> {
  const status = await fetchStatus();
  if (!status) {
    console.log(chalk.dim('Daemon is not running.'));
    return;
  }

  const ok = await requestShutdown();
  if (ok) {
    console.log(chalk.green('Daemon stopped.'));
  } else {
    console.error(chalk.red('Failed to stop daemon.'));
    process.exitCode = 1;
  }
}

export async function daemonRestart(): Promise<void> {
  const status = await fetchStatus();
  if (status) {
    const ok = await requestShutdown();
    if (!ok) {
      console.error(chalk.red('Failed to stop daemon.'));
      process.exitCode = 1;
      return;
    }
    // Wait for daemon to exit
    await new Promise(r => setTimeout(r, 500));
  }

  // Import BrowserBridge to spawn a new daemon
  const { BrowserBridge } = await import('../browser/mcp.js');
  const bridge = new BrowserBridge();
  try {
    console.log('Starting daemon...');
    await bridge.connect({ timeout: 10 });
    console.log(chalk.green('Daemon restarted.'));
  } catch (err) {
    console.error(chalk.red(`Failed to restart daemon: ${err instanceof Error ? err.message : err}`));
    process.exitCode = 1;
  }
}
