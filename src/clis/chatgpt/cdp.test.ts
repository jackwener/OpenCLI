import { describe, expect, it } from 'vitest';
import { __test__ } from './cdp.js';

describe('chatgpt cdp helpers', () => {
  it('formats a ready ChatGPT CDP status row with explicit surface metadata', () => {
    expect(__test__.formatChatGPTStatusRow({
      title: 'ChatGPT',
      url: 'https://chatgpt.com/?window_style=main_view',
      readyState: 'complete',
      likelyChatGPT: true,
      turnCount: 6,
      composerFound: true,
      composerTag: 'DIV',
      composerEmpty: true,
      draftLength: 0,
      sendButtonEnabled: true,
      busy: false,
    }, 'windows-cdp')).toEqual({
      Status: 'Connected',
      Surface: 'windows-cdp',
      Url: 'https://chatgpt.com/?window_style=main_view',
      Title: 'ChatGPT',
      Turns: 6,
      Composer: 'Ready',
      Busy: 'No',
    });
  });

  it('formats send results as successful submissions while keeping table compatibility narrow', () => {
    expect(__test__.formatChatGPTSendResultRow({
      surface: 'windows-cdp',
      submitMethod: 'button',
      injectedText: 'Research this carefully',
    })).toEqual({
      Status: 'Success',
      Surface: 'windows-cdp',
      Submit: 'button',
      InjectedText: 'Research this carefully',
    });
  });

  it('normalizes raw turns and strips repeated UI chrome lines', () => {
    expect(__test__.normalizeChatGPTTurns([
      { role: 'user', text: 'Hello there' },
      { role: 'assistant', text: 'Sure\nCopy\nShare' },
      { role: 'assistant', text: 'Sure\nCopy\nShare' },
      { role: 'assistant', text: '   ' },
    ])).toEqual([
      { Role: 'User', Text: 'Hello there' },
      { Role: 'Assistant', Text: 'Sure' },
    ]);
  });
});
