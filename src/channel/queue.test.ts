import { describe, it, expect, beforeEach } from 'vitest'
import { EventQueue } from './queue.js'
import type { ChannelEvent } from './types.js'

function makeEvent(id: string, content = 'test'): ChannelEvent {
  return {
    id,
    source: 'test/source',
    platform: 'test',
    eventType: 'new_item',
    content,
    timestamp: Date.now(),
  }
}

describe('EventQueue', () => {
  let queue: EventQueue

  beforeEach(() => {
    queue = new EventQueue({ maxSize: 5, dedupWindowSize: 10 })
  })

  it('pushes and drains events', () => {
    queue.push(makeEvent('a'))
    queue.push(makeEvent('b'))
    const events = queue.drain()
    expect(events).toHaveLength(2)
    expect(events[0].id).toBe('a')
    expect(queue.drain()).toHaveLength(0)
  })

  it('deduplicates by event id', () => {
    queue.push(makeEvent('a'))
    queue.push(makeEvent('a'))
    expect(queue.drain()).toHaveLength(1)
  })

  it('deduplicates across drains (dedup window)', () => {
    queue.push(makeEvent('a'))
    queue.drain()
    queue.push(makeEvent('a'))
    expect(queue.drain()).toHaveLength(0)
  })

  it('discards oldest when max size exceeded', () => {
    for (let i = 0; i < 7; i++) queue.push(makeEvent(`e${i}`))
    const events = queue.drain()
    expect(events).toHaveLength(5)
    expect(events[0].id).toBe('e2')
  })

  it('prunes dedup window when exceeded', () => {
    const q = new EventQueue({ maxSize: 100, dedupWindowSize: 3 })
    q.push(makeEvent('a'))
    q.push(makeEvent('b'))
    q.push(makeEvent('c'))
    q.drain()
    q.push(makeEvent('d'))
    // 'a' should be pruned from dedup window, so re-pushing it works
    q.push(makeEvent('a'))
    expect(q.drain()).toHaveLength(2)
  })

  it('reports pending count', () => {
    queue.push(makeEvent('a'))
    queue.push(makeEvent('b'))
    expect(queue.pending).toBe(2)
  })
})
