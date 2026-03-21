import { describe, expect, it } from 'vitest';
import { __test__ } from './cdp.js';

describe('chatgpt cdp helpers', () => {
  it('formats a ready ChatGPT CDP status row', () => {
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
      reasoningMode: 'pro',
      reasoningLabel: 'Pro',
      reasoningTriggerFound: true,
    })).toEqual({
      Status: 'Connected',
      Mode: 'CDP',
      Url: 'https://chatgpt.com/?window_style=main_view',
      Title: 'ChatGPT',
      Turns: 6,
      Composer: 'Ready',
      Reasoning: 'Pro',
      Busy: 'No',
    });
  });

  it('formats send results as async submissions instead of completed replies', () => {
    expect(__test__.formatChatGPTSendResultRow({
      mode: 'CDP',
      reasoningLabel: 'Pro',
      submitMethod: 'button',
      injectedText: 'Research this carefully',
    })).toEqual({
      Status: 'Submitted',
      Mode: 'CDP',
      Reasoning: 'Pro',
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

  it('keeps single-line content even when it matches a UI label', () => {
    expect(__test__.normalizeChatGPTText('Copy')).toBe('Copy');
  });

  it('strips localized reasoning-state chrome from multiline content', () => {
    expect(__test__.normalizeChatGPTText('ChatGPT 说：\n已完成推理\n立即回答\nPartial answer\n来源')).toBe('Partial answer');
  });

  it('normalizes reasoning aliases to supported top-level modes', () => {
    expect(__test__.normalizeChatGPTReasoningInput('auto')).toBe('instant');
    expect(__test__.normalizeChatGPTReasoningInput('gpt-5.4 thinking')).toBe('thinking');
    expect(__test__.normalizeChatGPTReasoningInput('pro')).toBe('pro');
  });

  it('detects reasoning mode labels from ChatGPT picker text', () => {
    expect(__test__.detectChatGPTReasoningMode('GPT-5.4 Pro')).toBe('pro');
    expect(__test__.detectChatGPTReasoningMode('Thinking')).toBe('thinking');
    expect(__test__.detectChatGPTReasoningMode('Instant')).toBe('instant');
    expect(__test__.detectChatGPTReasoningMode('Auto 自动决定思考时长')).toBe('instant');
    expect(__test__.detectChatGPTReasoningMode('Something else')).toBe('');
  });
});
