import { describe, expect, it } from 'vitest';
import { mergeTranscriptSnapshots } from './utils.js';

describe('mergeTranscriptSnapshots', () => {
  it('extends the transcript when the next snapshot overlaps with the tail', () => {
    const merged = mergeTranscriptSnapshots(
      'Alice 00:00\nHello team\nBob 00:05\nHi',
      'Bob 00:05\nHi\nAlice 00:10\nNext topic',
    );

    expect(merged).toBe(
      'Alice 00:00\nHello team\nBob 00:05\nHi\nAlice 00:10\nNext topic',
    );
  });

  it('does not duplicate a snapshot that is already contained in the transcript', () => {
    const merged = mergeTranscriptSnapshots(
      'Alice 00:00\nHello team\nBob 00:05\nHi',
      'Bob 00:05\nHi',
    );

    expect(merged).toBe('Alice 00:00\nHello team\nBob 00:05\nHi');
  });

  it('keeps both windows when a virtualized panel returns adjacent chunks without full history', () => {
    const merged = mergeTranscriptSnapshots(
      'Alice 00:00\nHello team\nBob 00:05\nHi',
      'Alice 00:10\nNext topic\nBob 00:15\nAction items',
    );

    expect(merged).toBe(
      'Alice 00:00\nHello team\nBob 00:05\nHi\nAlice 00:10\nNext topic\nBob 00:15\nAction items',
    );
  });
});
