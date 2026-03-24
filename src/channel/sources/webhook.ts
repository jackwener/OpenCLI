/**
 * Webhook event source: HTTP server that receives external POST events.
 * Listens on localhost only. Optional Bearer token auth.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { ChannelEvent, EventHandler, EventSource, WebhookConfig } from '../types.js'

const MAX_BODY = 64 * 1024 // 64 KB

export class WebhookSource implements EventSource {
  readonly type = 'webhook'

  private readonly config: WebhookConfig
  private readonly handlers: EventHandler[] = []
  private server: ReturnType<typeof createServer> | null = null
  private resolvedToken: string
  private assignedPort = 0

  constructor(config: WebhookConfig) {
    this.config = config
    this.resolvedToken = config.token.startsWith('$')
      ? process.env[config.token.slice(1)] ?? ''
      : config.token
  }

  onEvent(handler: EventHandler): void {
    this.handlers.push(handler)
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      this.handleRequest(req, res).catch(() => {
        res.writeHead(500)
        res.end()
      })
    })

    return new Promise((resolve) => {
      this.server!.listen(this.config.port, '127.0.0.1', () => {
        const addr = this.server!.address()
        this.assignedPort = typeof addr === 'object' && addr ? addr.port : this.config.port
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => resolve())
      })
    }
  }

  getPort(): number {
    return this.assignedPort
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }

    if (this.resolvedToken) {
      const auth = req.headers['authorization'] ?? ''
      if (auth !== `Bearer ${this.resolvedToken}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized' }))
        return
      }
    }

    let body: string
    try {
      body = await this.readBody(req)
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Body too large' }))
      return
    }

    let payload: { source?: string; event?: string; data?: unknown; message?: string }
    try {
      payload = JSON.parse(body)
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Invalid JSON' }))
      return
    }

    const event: ChannelEvent = {
      id: `webhook:${payload.source ?? 'unknown'}:${Date.now()}`,
      source: `webhook/${payload.source ?? 'unknown'}`,
      platform: payload.source ?? 'webhook',
      eventType: payload.event ?? 'notification',
      content: payload.message ?? JSON.stringify(payload.data ?? payload).slice(0, 500),
      raw: payload,
      timestamp: Date.now(),
    }

    for (const handler of this.handlers) {
      handler(event)
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (c: Buffer) => {
        size += c.length
        if (size > MAX_BODY) { req.destroy(); reject(new Error('Body too large')); return }
        chunks.push(c)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      req.on('error', reject)
    })
  }
}
