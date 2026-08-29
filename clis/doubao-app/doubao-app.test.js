import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { statusCommand } from './status.js';
import {
  cleanupSubmissionScript,
  clickSendScript,
  injectTextScript,
  inspectSurfaceScript,
  isDoubaoChatUrl,
  prepareSubmissionScript,
  readMessagesScript,
  responseAfterPromptScript,
  submittedMessageScript,
} from './utils.js';

function evaluateInDom(html, script, url = 'chrome://doubao-chat/chat/123') {
  const dom = new JSDOM(html, { runScripts: 'dangerously', url });
  return dom.window.eval(script);
}

describe('doubao-app renderer helpers', () => {
  it('recognizes both current and legacy Doubao chat renderer URLs', () => {
    expect(isDoubaoChatUrl('chrome://doubao-chat/chat/123')).toBe(true);
    expect(isDoubaoChatUrl('doubao://doubao-chat/chat')).toBe(true);
    expect(isDoubaoChatUrl('doubao://doubao-background/')).toBe(false);
    expect(isDoubaoChatUrl('doubao://doubao-chat/cross-site-support/')).toBe(false);
  });

  it('finds the nested contenteditable composer on the current renderer', () => {
    const surface = evaluateInDom(`
      <div data-testid="chat_input_input"><div contenteditable="true"></div></div>
      <div data-testid="union_message"></div>
    `, inspectSurfaceScript());

    expect(surface).toMatchObject({ composerReady: true, messageSurfaceReady: true });
    expect(surface.url).toBe('chrome://doubao-chat/chat/123');
  });

  it('injects exact text into the nested contenteditable instead of treating the root as a textarea', () => {
    const result = evaluateInDom(`
      <div data-testid="chat_input_input"><div contenteditable="true"></div></div>
    `, injectTextScript('hello from OpenCLI'));

    expect(result).toEqual({ ok: true, text: 'hello from OpenCLI' });
  });

  it('keeps the legacy textarea composer compatible', () => {
    const html = '<textarea data-testid="chat_input_input"></textarea>';
    expect(evaluateInDom(html, inspectSurfaceScript())).toMatchObject({ composerReady: true });
    expect(evaluateInDom(html, injectTextScript('legacy message'))).toEqual({
      ok: true,
      text: 'legacy message',
    });
  });

  it('rejects a disabled send button', () => {
    const result = evaluateInDom('<button data-testid="chat_input_send_button" disabled></button>', clickSendScript());
    expect(result).toEqual({ ok: false, error: 'Send button is disabled' });
  });

  it('reads roles from explicit union-message markers', () => {
    const messages = evaluateInDom(`
      <section data-testid="union_message">
        <div data-testid="send_message"></div>
        <div data-testid="message_text_content">same prompt</div>
      </section>
      <section data-testid="union_message">
        <div data-testid="receive_message"></div>
        <div data-testid="message_text_content">current reply</div>
      </section>
    `, readMessagesScript());

    expect(messages).toEqual([
      { role: 'User', text: 'same prompt' },
      { role: 'Assistant', text: 'current reply' },
    ]);
  });

  it('confirms a replacement user-turn identity when a virtualized list keeps the same count', () => {
    const dom = new JSDOM(`
      <section data-testid="union_message">
        <div data-testid="send_message"></div>
        <div data-testid="message_text_content">repeatable prompt</div>
      </section>
    `, { runScripts: 'dangerously', url: 'chrome://doubao-chat/chat/123' });
    const token = 'virtualized-replacement';
    dom.window.eval(prepareSubmissionScript(token));
    dom.window.document.querySelector('[data-testid="union_message"]').remove();
    dom.window.document.body.insertAdjacentHTML('beforeend', `
      <section data-testid="union_message">
        <div data-testid="send_message"></div>
        <div data-testid="message_text_content">repeatable prompt</div>
      </section>
    `);

    expect(dom.window.document.querySelectorAll('[data-testid="union_message"]')).toHaveLength(1);
    expect(dom.window.eval(submittedMessageScript('repeatable prompt ', token))).toBe(true);
    expect(dom.window.eval(cleanupSubmissionScript(token))).toBe(true);
  });

  it('binds a repeated prompt to its new turn and waits for authoritative completion', () => {
    const dom = new JSDOM(`
      <section data-testid="union_message">
        <div data-testid="send_message"></div>
        <div data-testid="message_text_content">repeatable prompt</div>
      </section>
      <section data-testid="union_message">
        <div data-testid="receive_message"></div>
        <div data-testid="message_text_content">older reply</div>
        <div data-testid="message_action_bar"></div>
      </section>
    `, { runScripts: 'dangerously', url: 'chrome://doubao-chat/chat/123' });
    const token = 'repeated-prompt';
    dom.window.eval(prepareSubmissionScript(token));
    dom.window.document.body.insertAdjacentHTML('beforeend', `
      <section data-testid="union_message">
        <div data-testid="send_message"></div>
        <div data-testid="message_text_content">repeatable prompt</div>
      </section>
      <section data-testid="union_message" id="current-reply">
        <div data-testid="receive_message"></div>
        <div data-testid="message_text_content">current reply</div>
      </section>
    `);

    expect(dom.window.eval(submittedMessageScript('repeatable prompt', token))).toBe(true);
    expect(dom.window.eval(responseAfterPromptScript('repeatable prompt', token))).toEqual({
      phase: 'streaming',
      text: 'current reply',
    });

    dom.window.document.querySelector('#current-reply')
      .insertAdjacentHTML('beforeend', '<div data-testid="message_action_bar"></div>');
    const stop = dom.window.document.createElement('button');
    stop.setAttribute('data-testid', 'chat_input_end_button');
    stop.getBoundingClientRect = () => ({ width: 20, height: 20 });
    dom.window.document.body.append(stop);
    expect(dom.window.eval(responseAfterPromptScript('repeatable prompt', token))).toEqual({
      phase: 'streaming',
      text: 'current reply',
    });

    stop.remove();
    expect(dom.window.eval(responseAfterPromptScript('repeatable prompt', token))).toEqual({
      phase: 'candidate',
      text: 'current reply',
    });
    expect(dom.window.eval(cleanupSubmissionScript(token))).toBe(true);
  });
});

describe('doubao-app status', () => {
  it('rejects a background renderer even when CDP is connected', async () => {
    const page = {
      evaluate: async () => ({
        url: 'chrome://doubao-background/',
        title: 'doubao://doubao-background',
        composerReady: false,
      }),
    };

    await expect(statusCommand.func(page, {})).rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('reports connected only for a ready chat renderer', async () => {
    const page = {
      evaluate: async () => ({
        url: 'chrome://doubao-chat/chat/123',
        title: '对话主题 - 豆包工作',
        composerReady: true,
      }),
    };

    await expect(statusCommand.func(page, {})).resolves.toEqual([{
      Status: 'Connected',
      Url: 'chrome://doubao-chat/chat/123',
      Title: '对话主题 - 豆包工作',
    }]);
  });
});
