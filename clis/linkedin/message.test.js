import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import './message.js';

const { conversationIsFor, readBackMatches, requireText, TEXT_MAX } = await import('./message.js').then((m) => m.__test__);

describe('linkedin message adapter', () => {
  const command = getRegistry().get('linkedin/message');

  it('registers a write command that is dry-run unless --send', () => {
    expect(command).toBeDefined();
    expect(command.access).toBe('write');
    expect(command.browser).toBe(true);
    const send = command.args.find((a) => a.name === 'send');
    expect(send.default).toBe(false);
    expect(command.args.find((a) => a.name === 'expected-name').required).toBe(true);
  });

  it('a draft must be addressed to exactly the expected person', () => {
    expect(conversationIsFor({ recipients: ['Brittany Pollard'] }, 'Brittany Pollard')).toBe(true);
    expect(conversationIsFor({ recipients: ['Brittany Pollard', 'Lori William'] }, 'Brittany Pollard')).toBe(false);
    expect(conversationIsFor({ recipients: ['Lori William'] }, 'Brittany Pollard')).toBe(false);
    // An existing conversation has no pills: its header names the person.
    expect(conversationIsFor({ recipients: [], headerNames: ['Brittany Pollard · 1st'] }, 'Brittany Pollard')).toBe(true);
    expect(conversationIsFor({ recipients: [], headerNames: ['Messaging'] }, 'Brittany Pollard')).toBe(false);
    expect(conversationIsFor({}, 'Brittany Pollard')).toBe(false);
  });

  it('the read-back is the conversation\'s last message, whitespace aside', () => {
    expect(readBackMatches(['earlier', 'Hi Jane,  one question.'], 'Hi Jane, one question.')).toBe(true);
    expect(readBackMatches(['Hi Jane, one question.', 'their reply'], 'Hi Jane, one question.')).toBe(false);
    expect(readBackMatches([], 'x')).toBe(false);
  });

  it('refuses an empty or over-long text before opening a browser', () => {
    expect(() => requireText('')).toThrow(ArgumentError);
    expect(() => requireText('x'.repeat(TEXT_MAX + 1))).toThrow(ArgumentError);
    expect(() => requireText('Hi\n\nthere')).toThrow(/one paragraph/);
    expect(requireText('  Hi  ')).toBe('Hi');
  });
});
