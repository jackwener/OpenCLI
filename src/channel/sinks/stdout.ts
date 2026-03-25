/**
 * Stdout sink — prints events as JSON lines.
 * Pipe-friendly, zero config.
 */

import type { ChannelEvent, ChannelSink } from '../types.js';

export class StdoutSink implements ChannelSink {
  readonly name = 'stdout';

  async init(_config: Record<string, unknown>): Promise<void> {}

  async deliver(events: ChannelEvent[]): Promise<void> {
    for (const event of events) {
      process.stdout.write(JSON.stringify(event) + '\n');
    }
  }
}
