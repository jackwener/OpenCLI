import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import { askCommand } from './ask.js';
import { newCommand } from './new.js';
import { readCommand } from './read.js';
import { sendCommand } from './send.js';
import { statusCommand } from './status.js';

describe('chatgpt default command surface compatibility', () => {
  it('keeps the existing five chatgpt commands', () => {
    const names = [...getRegistry().values()]
      .filter((cmd) => cmd.site === 'chatgpt')
      .map((cmd) => cmd.name)
      .sort();

    expect(names).toEqual(['ask', 'new', 'read', 'send', 'status']);
  });

  it('keeps default table output narrow and preserves existing default wording', () => {
    expect(statusCommand.description).toBe('Check ChatGPT Desktop App status');
    expect(statusCommand.columns).toEqual(['Status']);

    expect(sendCommand.description).toBe('Send a message to the active ChatGPT Desktop App window');
    expect(sendCommand.columns).toEqual(['Status']);
    expect(sendCommand.args.find((arg) => arg.name === 'text')?.help).toBe('Message to send');

    expect(readCommand.description).toBe('Read the last visible message from the focused ChatGPT Desktop window');
    expect(readCommand.columns).toEqual(['Role', 'Text']);
  });

  it('adds the explicit surface selector only to the narrow CDP-safe command subset', () => {
    expect(statusCommand.args.find((arg) => arg.name === 'surface')).toMatchObject({
      default: 'macos-native',
      choices: ['macos-native', 'macos-cdp', 'windows-cdp'],
    });
    expect(readCommand.args.find((arg) => arg.name === 'surface')).toMatchObject({
      default: 'macos-native',
      choices: ['macos-native', 'macos-cdp', 'windows-cdp'],
    });
    expect(sendCommand.args.find((arg) => arg.name === 'surface')).toMatchObject({
      default: 'macos-native',
      choices: ['macos-native', 'macos-cdp', 'windows-cdp'],
    });

    expect(newCommand.args.find((arg) => arg.name === 'surface')).toBeUndefined();
    expect(askCommand.args.find((arg) => arg.name === 'surface')).toBeUndefined();
  });
});
