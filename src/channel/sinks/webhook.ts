/**
 * Webhook sink — POST events to a URL.
 */

import type { ChannelEvent, ChannelSink } from '../types.js';

export class WebhookSink implements ChannelSink {
  readonly name = 'webhook';
  private url = '';
  private headers: Record<string, string> = {};

  async init(config: Record<string, unknown>): Promise<void> {
    if (typeof config.url !== 'string' || !config.url) {
      throw new Error('Webhook sink requires a "url" config.');
    }
    // Validate URL scheme to prevent SSRF
    const parsed = new URL(config.url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Webhook sink only supports http/https URLs, got: ${parsed.protocol}`);
    }
    this.url = config.url;
    if (config.headers && typeof config.headers === 'object') {
      this.headers = config.headers as Record<string, string>;
    }
  }

  async deliver(events: ChannelEvent[]): Promise<void> {
    for (const event of events) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);
        try {
          const res = await fetch(this.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...this.headers },
            body: JSON.stringify(event),
            signal: controller.signal,
          });
          if (!res.ok) {
            console.error(`[webhook] ${res.status} ${res.statusText} for event ${event.id}`);
          }
        } finally {
          clearTimeout(timeout);
        }
      } catch (e) {
        console.error(`[webhook] Failed to deliver event ${event.id}:`, e);
      }
    }
  }
}
