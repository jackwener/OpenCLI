/**
 * Channel MCP Server: declares claude/channel capability, pushes platform
 * events into the active Claude Code session via stdio transport.
 *
 * Entry point: `opencli channel start`
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import yaml from 'js-yaml'
import { acquireLock, releaseLock } from './lock.js'
import { Watcher } from './watcher.js'
import type { ChannelConfig } from './types.js'

const CONFIG_PATH = path.join(os.homedir(), '.opencli', 'channel.yaml')
const STATE_PATH = path.join(os.homedir(), '.opencli', 'channel-state.json')
const PUSH_INTERVAL = 1000   // Check queue every 1s
const STATE_INTERVAL = 10000 // Write state file every 10s

// Redirect console.log → stderr (stdout is reserved for MCP stdio protocol)
console.log = (...args: unknown[]) => console.error(...args)

function loadConfig(): ChannelConfig {
  const defaults: ChannelConfig = {
    sources: [],
    webhook: { enabled: false, port: 8788, token: '' },
  }

  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    const parsed = yaml.load(raw) as Partial<ChannelConfig>
    return {
      sources: parsed.sources ?? defaults.sources,
      webhook: { ...defaults.webhook, ...parsed.webhook },
    }
  } catch {
    console.error(`[channel] No config found at ${CONFIG_PATH}, using defaults`)
    return defaults
  }
}

export async function startChannelServer(): Promise<void> {
  // Single-instance check
  if (!acquireLock()) {
    console.error('[channel] Another channel server is already running. Exiting.')
    process.exit(1)
  }

  const config = loadConfig()

  if (config.sources.filter(s => s.enabled).length === 0 && !config.webhook.enabled) {
    console.error(`[channel] No sources configured. Edit ${CONFIG_PATH} to add sources.`)
  }

  // Initialize MCP server
  const mcp = new Server(
    { name: 'opencli-channel', version: '0.1.0' },
    {
      capabilities: {
        experimental: { 'claude/channel': {} },
      },
      instructions: `Platform events arrive as <channel source="opencli-channel" platform="..." event_type="...">.
Inform the user about new events. If the user wants to take action, use opencli commands directly (e.g. opencli twitter reply).`,
    },
  )

  // Initialize watcher
  const watcher = new Watcher(config)
  await watcher.start()

  // Push events from queue → MCP notifications
  const pushTimer = setInterval(async () => {
    const events = watcher.drain()
    for (const event of events) {
      try {
        // Cast to any: notifications/claude/channel is an experimental method
        // not in the SDK's ServerNotification union type
        await (mcp as unknown as {
          notification(n: { method: string; params: unknown }): Promise<void>
        }).notification({
          method: 'notifications/claude/channel',
          params: {
            content: event.content,
            meta: {
              platform: event.platform,
              event_type: event.eventType,
              source: event.source,
              event_id: event.id,
            },
          },
        })
      } catch (err) {
        console.error(`[channel] Failed to push notification: ${err instanceof Error ? err.message : err}`)
      }
    }
  }, PUSH_INTERVAL)

  // Write state file periodically (for `channel status`)
  const stateTimer = setInterval(() => {
    try {
      const state = {
        pid: process.pid,
        uptime: process.uptime(),
        sources: watcher.getStats(),
        pendingEvents: watcher.pendingCount,
        updatedAt: Date.now(),
      }
      fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
      fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
    } catch {
      // Non-critical, ignore
    }
  }, STATE_INTERVAL)

  // Graceful shutdown
  async function shutdown(): Promise<void> {
    clearInterval(pushTimer)
    clearInterval(stateTimer)
    await watcher.stop()
    releaseLock()
    try { fs.unlinkSync(STATE_PATH) } catch { /* ignore */ }
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
  process.stdin.on('end', shutdown) // Claude Code disconnected

  // Connect MCP over stdio
  const transport = new StdioServerTransport()
  await mcp.connect(transport)

  console.error('[channel] Server started, waiting for events...')
}
