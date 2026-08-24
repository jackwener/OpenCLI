import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './ask.js';
import './image.js';
import './models.js';
import './status.js';
import './auth.js';

describe('aistudio command registration', () => {
  const commands = ['ask', 'image', 'models', 'status', 'login', 'whoami'];

  it('registers all commands with the aistudio site and cookie strategy', () => {
    for (const name of commands) {
      const cmd = getRegistry().get(`aistudio/${name}`);
      expect(cmd, name).toBeTruthy();
      expect(cmd.site).toBe('aistudio');
      expect(cmd.domain).toBe('aistudio.google.com');
      expect(cmd.strategy).toBe('cookie');
      expect(cmd.browser).toBe(true);
      expect(cmd.navigateBefore).toBe(false);
    }
    // ask runs on an ephemeral site session (fresh page context per call);
    // every other command keeps the persistent session.
    expect(getRegistry().get('aistudio/ask').siteSession).toBe('ephemeral');
    for (const name of ['image', 'models', 'status', 'login', 'whoami']) {
      expect(getRegistry().get(`aistudio/${name}`).siteSession).toBe('persistent');
    }
  });

  it('exposes write access for ask/image/login and read access for models/status/whoami', () => {
    expect(getRegistry().get('aistudio/ask').access).toBe('write');
    expect(getRegistry().get('aistudio/image').access).toBe('write');
    expect(getRegistry().get('aistudio/login').access).toBe('write');
    expect(getRegistry().get('aistudio/models').access).toBe('read');
    expect(getRegistry().get('aistudio/status').access).toBe('read');
    expect(getRegistry().get('aistudio/whoami').access).toBe('read');
  });

  it('keeps ask fresh-chat-only and image on plain output without forced thinking', () => {
    const ask = getRegistry().get('aistudio/ask');
    const image = getRegistry().get('aistudio/image');
    // The ephemeral site session makes every ask call a fresh chat; the dead
    // --new-chat option was removed rather than kept as a broken contract.
    expect(ask.args.find((arg) => arg.name === 'new-chat')).toBeUndefined();
    expect(image.defaultFormat).toBe('plain');
    expect(image.args.find((arg) => arg.name === 'thinking')?.default ?? '').toBe('');
  });
});
