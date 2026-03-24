import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WebhookSource } from './webhook.js'
import type { ChannelEvent, WebhookConfig } from '../types.js'

const config: WebhookConfig = {
  enabled: true,
  port: 0, // random port for tests
  token: '',
}

describe('WebhookSource', () => {
  let source: WebhookSource
  let events: ChannelEvent[]

  beforeEach(async () => {
    events = []
    source = new WebhookSource(config)
    source.onEvent((e) => events.push(e))
    await source.start()
  })

  afterEach(async () => {
    await source.stop()
  })

  it('has correct type', () => {
    expect(source.type).toBe('webhook')
  })

  it('accepts valid POST and emits event', async () => {
    const port = source.getPort()
    const res = await fetch(`http://127.0.0.1:${port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'github', event: 'push', data: { ref: 'main' } }),
    })
    expect(res.status).toBe(200)
    expect(events).toHaveLength(1)
    expect(events[0].platform).toBe('github')
    expect(events[0].eventType).toBe('push')
  })

  it('rejects non-POST methods', async () => {
    const port = source.getPort()
    const res = await fetch(`http://127.0.0.1:${port}/events`)
    expect(res.status).toBe(405)
  })

  it('rejects invalid JSON', async () => {
    const port = source.getPort()
    const res = await fetch(`http://127.0.0.1:${port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })

  it('enforces token auth when configured', async () => {
    await source.stop()
    source = new WebhookSource({ ...config, token: 'secret123' })
    source.onEvent((e) => events.push(e))
    await source.start()
    const port = source.getPort()

    // Without token
    const res1 = await fetch(`http://127.0.0.1:${port}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'test', event: 'ping' }),
    })
    expect(res1.status).toBe(401)

    // With token
    const res2 = await fetch(`http://127.0.0.1:${port}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer secret123',
      },
      body: JSON.stringify({ source: 'test', event: 'ping' }),
    })
    expect(res2.status).toBe(200)
  })
})
