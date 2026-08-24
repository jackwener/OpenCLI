import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

import { askCommand } from './ask.js';

function assistantTurn(turnKey, messageKey, text) {
  return `
    <section data-content-search-turn-key="${turnKey}">
      <div data-content-search-unit-key="${turnKey}:${messageKey}" data-response-annotation-target="${messageKey}">
        <div data-markdown-text-style="assistant-message">${text}</div>
      </div>
    </section>
  `;
}

function makePage(initialHtml, onPoll) {
  const dom = new JSDOM(`<body>${initialHtml}</body>`, { runScripts: 'outside-only' });
  let poll = 0;
  const page = {
    evaluate: vi.fn(async (script) => {
      if (script.includes("document.execCommand('insertText'")) return true;
      return dom.window.eval(script);
    }),
    wait: vi.fn(async (seconds) => {
      expect(seconds).toBe(0.5);
    }),
    sleep: vi.fn(async (seconds) => {
      expect(seconds).toBe(3);
      poll += 1;
      onPoll(dom.window.document, poll);
    }),
    pressKey: vi.fn().mockResolvedValue(undefined),
  };
  return page;
}

describe('codex ask', () => {
  it('detects a new assistant identity when virtualized counts stay unchanged', async () => {
    const page = makePage(
      assistantTurn('turn-old', 'msg-old', 'OLD'),
      (document) => {
        document.body.innerHTML = assistantTurn('turn-new', 'msg-new', 'VIRTUAL_OK');
      },
    );

    const result = await askCommand.func(page, { text: 'reply VIRTUAL_OK', timeout: 3 });

    expect(result).toEqual([
      { Role: 'User', Project: '', Conversation: '', Text: 'reply VIRTUAL_OK' },
      { Role: 'Assistant', Project: '', Conversation: '', Text: 'VIRTUAL_OK' },
    ]);
    expect(page.evaluate.mock.calls[0][0]).toContain('data-content-search-unit-key');
    expect(page.evaluate.mock.calls[2][0]).toContain('data-response-annotation-target');
  });

  it('does not return a new turn before its assistant message exists', async () => {
    const page = makePage(
      assistantTurn('turn-old', 'msg-old', 'OLD'),
      (document, poll) => {
        document.body.innerHTML = poll === 1
          ? `${assistantTurn('turn-old', 'msg-old', 'OLD')}<section data-content-search-turn-key="turn-new">USER\nTHINKING</section>`
          : `${assistantTurn('turn-old', 'msg-old', 'OLD')}${assistantTurn('turn-new', 'msg-new', 'FINISHED_OK')}`;
      },
    );

    const result = await askCommand.func(page, { text: 'reply FINISHED_OK', timeout: 6 });

    expect(result[1]).toEqual({
      Role: 'Assistant',
      Project: '',
      Conversation: '',
      Text: 'FINISHED_OK',
    });
    expect(page.sleep).toHaveBeenCalledTimes(2);
  });

  it('falls back to turn count for Codex builds without assistant markers', async () => {
    const page = makePage(
      '<section data-content-search-turn-key="turn-old">OLD</section>',
      (document) => {
        document.body.innerHTML = `
          <section data-content-search-turn-key="turn-old">OLD</section>
          <section data-content-search-turn-key="turn-new">LEGACY_OK</section>
        `;
      },
    );

    const result = await askCommand.func(page, { text: 'reply LEGACY_OK', timeout: 3 });

    expect(result[1]).toEqual({
      Role: 'Assistant',
      Project: '',
      Conversation: '',
      Text: 'LEGACY_OK',
    });
  });
});
