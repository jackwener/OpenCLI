import { describe, expect, it, vi } from 'vitest';
import type { IPage } from '@jackwener/opencli/types';
import type { GeminiSnapshot } from './utils.js';
import { __test__, waitForGeminiResponse, waitForGeminiSubmission } from './utils.js';

function snapshot(overrides: Partial<GeminiSnapshot> = {}): GeminiSnapshot {
  return {
    turns: [],
    transcriptLines: [],
    composerHasText: false,
    isGenerating: false,
    structuredTurnsTrusted: true,
    ...overrides,
  };
}

function createPageMock(): IPage {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(),
    getCookies: vi.fn().mockResolvedValue([]),
    snapshot: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    typeText: vi.fn().mockResolvedValue(undefined),
    pressKey: vi.fn().mockResolvedValue(undefined),
    scrollTo: vi.fn().mockResolvedValue(undefined),
    getFormState: vi.fn().mockResolvedValue({}),
    wait: vi.fn().mockResolvedValue(undefined),
    tabs: vi.fn().mockResolvedValue([]),
    selectTab: vi.fn().mockResolvedValue(undefined),
    networkRequests: vi.fn().mockResolvedValue([]),
    consoleMessages: vi.fn().mockResolvedValue([]),
    scroll: vi.fn().mockResolvedValue(undefined),
    autoScroll: vi.fn().mockResolvedValue(undefined),
    installInterceptor: vi.fn().mockResolvedValue(undefined),
    getInterceptedRequests: vi.fn().mockResolvedValue([]),
    waitForCapture: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(''),
    nativeType: vi.fn().mockResolvedValue(undefined),
    nativeKeyPress: vi.fn().mockResolvedValue(undefined),
  } as unknown as IPage;
}

describe('Gemini snapshot diff helpers', () => {
  it('reports appended trusted turns when the current snapshot extends the baseline', () => {
    const before = snapshot({
      turns: [{ Role: 'Assistant', Text: '旧回答' }],
    });
    const current = snapshot({
      turns: [
        { Role: 'Assistant', Text: '旧回答' },
        { Role: 'User', Text: '请只回复：OK' },
      ],
    });

    expect(__test__.diffTrustedStructuredTurns(before, current)).toEqual({
      appendedTurns: [{ Role: 'User', Text: '请只回复：OK' }],
      hasTrustedAppend: true,
      hasNewUserTurn: true,
      hasNewAssistantTurn: false,
    });
  });

  it('treats restored structured turns as untrusted when the pre-send snapshot had no trustworthy turns', () => {
    const before = snapshot({
      turns: [],
      transcriptLines: ['旧问题', '旧回答'],
      structuredTurnsTrusted: false,
    });
    const current = snapshot({
      turns: [
        { Role: 'User', Text: '旧问题' },
        { Role: 'Assistant', Text: '旧回答' },
      ],
      transcriptLines: ['旧问题', '旧回答'],
      structuredTurnsTrusted: true,
    });

    expect(__test__.diffTrustedStructuredTurns(before, current)).toEqual({
      appendedTurns: [],
      hasTrustedAppend: false,
      hasNewUserTurn: false,
      hasNewAssistantTurn: false,
    });
  });

  it('keeps transcript delta lines raw for later conservative fallback checks', () => {
    const before = snapshot({
      transcriptLines: ['baseline'],
    });
    const current = snapshot({
      transcriptLines: ['baseline', '关于“请只回复：OK”，这里是解释。'],
      structuredTurnsTrusted: false,
    });

    expect(__test__.diffTranscriptLines(before, current)).toEqual([
      '关于“请只回复：OK”，这里是解释。',
    ]);
  });
});

describe('Gemini submission state', () => {
  it('confirms submission from a trusted appended user turn', async () => {
    const page = createPageMock();
    const evaluate = vi.mocked(page.evaluate);

    evaluate
      .mockResolvedValueOnce('https://gemini.google.com/app')
      .mockResolvedValueOnce({
        turns: [
          { Role: 'Assistant', Text: '旧回答' },
          { Role: 'User', Text: '请只回复：OK' },
        ],
        transcriptLines: ['baseline', '请只回复：OK'],
        composerHasText: false,
        isGenerating: true,
        structuredTurnsTrusted: true,
      });

    const result = await waitForGeminiSubmission(page, snapshot({
      turns: [{ Role: 'Assistant', Text: '旧回答' }],
      transcriptLines: ['baseline'],
      composerHasText: true,
      structuredTurnsTrusted: true,
    }), 4);

    expect(result).toEqual({
      snapshot: {
        turns: [
          { Role: 'Assistant', Text: '旧回答' },
          { Role: 'User', Text: '请只回复：OK' },
        ],
        transcriptLines: ['baseline', '请只回复：OK'],
        composerHasText: false,
        isGenerating: true,
        structuredTurnsTrusted: true,
      },
      preSendAssistantCount: 1,
      userAnchorTurn: { Role: 'User', Text: '请只回复：OK' },
      reason: 'user_turn',
    });
  });

  it('confirms submission from composer cleared plus generating even when transcript has not changed yet', async () => {
    const page = createPageMock();
    const evaluate = vi.mocked(page.evaluate);

    evaluate
      .mockResolvedValueOnce('https://gemini.google.com/app')
      .mockResolvedValueOnce({
        turns: [],
        transcriptLines: ['baseline'],
        composerHasText: false,
        isGenerating: true,
        structuredTurnsTrusted: false,
      });

    const result = await waitForGeminiSubmission(page, snapshot({
      transcriptLines: ['baseline'],
      composerHasText: true,
      structuredTurnsTrusted: false,
    }), 2);

    expect(result).toEqual({
      snapshot: {
        turns: [],
        transcriptLines: ['baseline'],
        composerHasText: false,
        isGenerating: true,
        structuredTurnsTrusted: false,
      },
      preSendAssistantCount: 0,
      userAnchorTurn: null,
      reason: 'composer_generating',
    });
  });

  it('confirms submission from generating state even when the pre-send baseline composer was empty', async () => {
    const page = createPageMock();
    const evaluate = vi.mocked(page.evaluate);

    evaluate
      .mockResolvedValueOnce('https://gemini.google.com/app')
      .mockResolvedValueOnce({
        turns: [
          { Role: 'User', Text: '你说\n\n请只回复：DBG2' },
          { Role: 'User', Text: '请只回复：DBG2' },
        ],
        transcriptLines: ['baseline', '请只回复：DBG2'],
        composerHasText: false,
        isGenerating: true,
        structuredTurnsTrusted: true,
      });

    const result = await waitForGeminiSubmission(page, snapshot({
      turns: [{ Role: 'Assistant', Text: '需要我为你做些什么？' }],
      transcriptLines: ['baseline'],
      composerHasText: false,
      structuredTurnsTrusted: true,
    }), 2);

    expect(result).toEqual({
      snapshot: {
        turns: [
          { Role: 'User', Text: '你说\n\n请只回复：DBG2' },
          { Role: 'User', Text: '请只回复：DBG2' },
        ],
        transcriptLines: ['baseline', '请只回复：DBG2'],
        composerHasText: false,
        isGenerating: true,
        structuredTurnsTrusted: true,
      },
      preSendAssistantCount: 1,
      userAnchorTurn: { Role: 'User', Text: '请只回复：DBG2' },
      reason: 'composer_generating',
    });
  });

  it('confirms submission from composer cleared plus transcript growth when generation state is unavailable', async () => {
    const page = createPageMock();
    const evaluate = vi.mocked(page.evaluate);

    // This transcript delta may be only a prompt echo. It is allowed to confirm
    // submission only because the composer has already cleared, and it must never
    // be reused later as reply ownership evidence.
    evaluate
      .mockResolvedValueOnce('https://gemini.google.com/app')
      .mockResolvedValueOnce({
        turns: [],
        transcriptLines: ['baseline', '请只回复：OK'],
        composerHasText: false,
        isGenerating: false,
        structuredTurnsTrusted: false,
      });

    const result = await waitForGeminiSubmission(page, snapshot({
      transcriptLines: ['baseline'],
      composerHasText: true,
      structuredTurnsTrusted: false,
    }), 2);

    expect(result).toEqual({
      snapshot: {
        turns: [],
        transcriptLines: ['baseline', '请只回复：OK'],
        composerHasText: false,
        isGenerating: false,
        structuredTurnsTrusted: false,
      },
      preSendAssistantCount: 0,
      userAnchorTurn: null,
      reason: 'composer_transcript',
    });
  });

  it('does not confirm submission when old structured turns only reappear after an untrusted pre-send snapshot', async () => {
    const page = createPageMock();
    const evaluate = vi.mocked(page.evaluate);

    evaluate
      .mockResolvedValueOnce('https://gemini.google.com/app')
      .mockResolvedValueOnce({
        turns: [
          { Role: 'User', Text: '旧问题' },
          { Role: 'Assistant', Text: '旧回答' },
        ],
        transcriptLines: ['旧问题', '旧回答'],
        composerHasText: false,
        isGenerating: false,
        structuredTurnsTrusted: true,
      })
      .mockResolvedValueOnce('https://gemini.google.com/app')
      .mockResolvedValueOnce({
        turns: [
          { Role: 'User', Text: '旧问题' },
          { Role: 'Assistant', Text: '旧回答' },
        ],
        transcriptLines: ['旧问题', '旧回答'],
        composerHasText: false,
        isGenerating: false,
        structuredTurnsTrusted: true,
      });

    const result = await waitForGeminiSubmission(page, snapshot({
      turns: [],
      transcriptLines: ['旧问题', '旧回答'],
      composerHasText: true,
      structuredTurnsTrusted: false,
    }), 2);

    expect(result).toBeNull();
  });

  it('does not confirm submission from transcript growth alone when the composer never clears', async () => {
    const page = createPageMock();
    const evaluate = vi.mocked(page.evaluate);

    evaluate
      .mockResolvedValueOnce('https://gemini.google.com/app')
      .mockResolvedValueOnce({
        turns: [],
        transcriptLines: ['baseline', '请只回复：OK'],
        composerHasText: true,
        isGenerating: false,
        structuredTurnsTrusted: false,
      })
      .mockResolvedValueOnce('https://gemini.google.com/app')
      .mockResolvedValueOnce({
        turns: [],
        transcriptLines: ['baseline', '请只回复：OK'],
        composerHasText: true,
        isGenerating: false,
        structuredTurnsTrusted: false,
      });

    const result = await waitForGeminiSubmission(page, snapshot({
      transcriptLines: ['baseline'],
      composerHasText: true,
      structuredTurnsTrusted: false,
    }), 2);

    expect(result).toBeNull();
  });

  it('does not confirm transcript-only submission while url remains /app root', async () => {
    const page = createPageMock();
    const evaluate = vi.mocked(page.evaluate);

    evaluate
      .mockResolvedValueOnce('https://gemini.google.com/app')
      .mockResolvedValueOnce({
        url: 'https://gemini.google.com/app',
        turns: [],
        transcriptLines: ['baseline', 'prompt'],
        composerHasText: false,
        isGenerating: false,
        structuredTurnsTrusted: false,
      })
      .mockResolvedValueOnce('https://gemini.google.com/app')
      .mockResolvedValueOnce({
        url: 'https://gemini.google.com/app',
        turns: [],
        transcriptLines: ['baseline', 'prompt'],
        composerHasText: false,
        isGenerating: false,
        structuredTurnsTrusted: false,
      });

    const result = await waitForGeminiSubmission(page, snapshot({
      url: 'https://gemini.google.com/app',
      transcriptLines: ['baseline'],
      composerHasText: true,
      structuredTurnsTrusted: false,
    }), 2);

    expect(result).toBeNull();
  });

  it('keeps polling past ten seconds when the overall timeout budget still allows submission confirmation', async () => {
    const page = createPageMock();
    const evaluate = vi.mocked(page.evaluate);

    for (let index = 0; index < 10; index += 1) {
      evaluate
        .mockResolvedValueOnce('https://gemini.google.com/app')
        .mockResolvedValueOnce({
          turns: [],
          transcriptLines: ['baseline'],
          composerHasText: true,
          isGenerating: false,
          structuredTurnsTrusted: false,
        });
    }

    evaluate
      .mockResolvedValueOnce('https://gemini.google.com/app')
      .mockResolvedValueOnce({
        turns: [],
        transcriptLines: ['baseline', '请只回复：OK'],
        composerHasText: false,
        isGenerating: false,
        structuredTurnsTrusted: false,
      });

    const result = await waitForGeminiSubmission(page, snapshot({
      transcriptLines: ['baseline'],
      composerHasText: true,
      structuredTurnsTrusted: false,
    }), 12);

    expect(result?.reason).toBe('composer_transcript');
  });
});

describe('Gemini reply state', () => {
  it('does not reuse an older identical reply when the submission baseline has no structured user anchor', async () => {
    const page = createPageMock();
    const evaluate = vi.mocked(page.evaluate);

    evaluate
      .mockResolvedValueOnce('https://gemini.google.com/app')
      .mockResolvedValueOnce({
        turns: [{ Role: 'Assistant', Text: 'OK' }],
        transcriptLines: ['baseline', 'OK'],
        composerHasText: false,
        isGenerating: false,
        structuredTurnsTrusted: true,
      })
      .mockResolvedValueOnce('https://gemini.google.com/app')
      .mockResolvedValueOnce({
        turns: [
          { Role: 'Assistant', Text: 'OK' },
          { Role: 'Assistant', Text: 'OK' },
        ],
        transcriptLines: ['baseline', 'OK'],
        composerHasText: false,
        isGenerating: false,
        structuredTurnsTrusted: true,
      })
      .mockResolvedValueOnce('https://gemini.google.com/app')
      .mockResolvedValueOnce({
        turns: [
          { Role: 'Assistant', Text: 'OK' },
          { Role: 'Assistant', Text: 'OK' },
        ],
        transcriptLines: ['baseline', 'OK'],
        composerHasText: false,
        isGenerating: false,
        structuredTurnsTrusted: true,
      });

    const result = await waitForGeminiResponse(page, {
      snapshot: snapshot({
        turns: [{ Role: 'Assistant', Text: 'OK' }],
        transcriptLines: ['baseline', 'OK'],
        composerHasText: false,
        isGenerating: true,
        structuredTurnsTrusted: true,
      }),
      preSendAssistantCount: 1,
      userAnchorTurn: null,
      reason: 'composer_generating',
    }, '请只回复：OK', 6);

    expect(result).toBe('OK');
  });

  it('does not treat prepended older history as the current round reply when reply ownership has no user anchor', async () => {
    const page = createPageMock();
    const evaluate = vi.mocked(page.evaluate);

    evaluate
      .mockResolvedValueOnce('https://gemini.google.com/app')
      .mockResolvedValueOnce({
        turns: [
          { Role: 'Assistant', Text: '更早的问题' },
          { Role: 'Assistant', Text: '旧回答' },
        ],
        transcriptLines: ['baseline'],
        composerHasText: false,
        isGenerating: false,
        structuredTurnsTrusted: true,
      })
      .mockResolvedValueOnce('https://gemini.google.com/app')
      .mockResolvedValueOnce({
        turns: [
          { Role: 'Assistant', Text: '更早的问题' },
          { Role: 'Assistant', Text: '旧回答' },
        ],
        transcriptLines: ['baseline'],
        composerHasText: false,
        isGenerating: false,
        structuredTurnsTrusted: true,
      })
      .mockResolvedValueOnce('https://gemini.google.com/app')
      .mockResolvedValueOnce({
        turns: [
          { Role: 'Assistant', Text: '更早的问题' },
          { Role: 'Assistant', Text: '旧回答' },
        ],
        transcriptLines: ['baseline'],
        composerHasText: false,
        isGenerating: false,
        structuredTurnsTrusted: true,
      });

    const result = await waitForGeminiResponse(page, {
      snapshot: snapshot({
        turns: [{ Role: 'Assistant', Text: '旧回答' }],
        transcriptLines: ['baseline'],
        composerHasText: false,
        isGenerating: true,
        structuredTurnsTrusted: true,
      }),
      preSendAssistantCount: 1,
      userAnchorTurn: null,
      reason: 'composer_generating',
    }, '请只回复：OK', 6);

    expect(result).toBe('');
  });

  it('accepts a reply when the submission snapshot contains only the current round user turns and later appends a new assistant', async () => {
    const page = createPageMock();
    const evaluate = vi.mocked(page.evaluate);

    evaluate
      .mockResolvedValueOnce('https://gemini.google.com/app')
      .mockResolvedValueOnce({
        turns: [
          { Role: 'User', Text: '你说\n\n请只回复：DBGREG' },
          { Role: 'User', Text: '请只回复：DBGREG' },
          { Role: 'Assistant', Text: 'DBGREG' },
        ],
        transcriptLines: ['baseline'],
        composerHasText: false,
        isGenerating: false,
        structuredTurnsTrusted: true,
      })
      .mockResolvedValueOnce('https://gemini.google.com/app')
      .mockResolvedValueOnce({
        turns: [
          { Role: 'User', Text: '你说\n\n请只回复：DBGREG' },
          { Role: 'User', Text: '请只回复：DBGREG' },
          { Role: 'Assistant', Text: 'DBGREG' },
        ],
        transcriptLines: ['baseline'],
        composerHasText: false,
        isGenerating: false,
        structuredTurnsTrusted: true,
      });

    const result = await waitForGeminiResponse(page, {
      snapshot: snapshot({
        turns: [
          { Role: 'User', Text: '你说\n\n请只回复：DBGREG' },
          { Role: 'User', Text: '请只回复：DBGREG' },
        ],
        transcriptLines: ['baseline'],
        composerHasText: false,
        isGenerating: true,
        structuredTurnsTrusted: true,
      }),
      preSendAssistantCount: 1,
      userAnchorTurn: { Role: 'User', Text: '请只回复：DBGREG' },
      reason: 'composer_generating',
    }, '请只回复：DBGREG', 6);

    expect(result).toBe('DBGREG');
  });

  it('does not trust an assistant-only submission snapshot without a stable post-submission owner', async () => {
    const page = createPageMock();
    const evaluate = vi.mocked(page.evaluate);

    evaluate
      .mockResolvedValueOnce('https://gemini.google.com/app')
      .mockResolvedValueOnce({
        turns: [{ Role: 'Assistant', Text: '完整回答' }],
        transcriptLines: ['baseline'],
        composerHasText: false,
        isGenerating: false,
        structuredTurnsTrusted: true,
      })
      .mockResolvedValueOnce('https://gemini.google.com/app')
      .mockResolvedValueOnce({
        turns: [{ Role: 'Assistant', Text: '完整回答' }],
        transcriptLines: ['baseline'],
        composerHasText: false,
        isGenerating: false,
        structuredTurnsTrusted: true,
      });

    const result = await waitForGeminiResponse(page, {
      snapshot: snapshot({
        turns: [{ Role: 'Assistant', Text: '半截回答' }],
        transcriptLines: ['baseline'],
        composerHasText: false,
        isGenerating: true,
        structuredTurnsTrusted: true,
      }),
      preSendAssistantCount: 0,
      userAnchorTurn: null,
      reason: 'composer_generating',
    }, '请解释', 4);

    expect(result).toBe('');
  });

  it('accepts an assistant reply that appears after a structured user anchor only after it stabilizes and generation stops', async () => {
    const page = createPageMock();
    const evaluate = vi.mocked(page.evaluate);

    evaluate
      .mockResolvedValueOnce('https://gemini.google.com/app')
      .mockResolvedValueOnce({
        turns: [
          { Role: 'Assistant', Text: '旧回答' },
          { Role: 'User', Text: '请解释' },
          { Role: 'Assistant', Text: '半截回答' },
        ],
        transcriptLines: ['baseline'],
        composerHasText: false,
        isGenerating: true,
        structuredTurnsTrusted: true,
      })
      .mockResolvedValueOnce('https://gemini.google.com/app')
      .mockResolvedValueOnce({
        turns: [
          { Role: 'Assistant', Text: '旧回答' },
          { Role: 'User', Text: '请解释' },
          { Role: 'Assistant', Text: '完整回答' },
        ],
        transcriptLines: ['baseline'],
        composerHasText: false,
        isGenerating: true,
        structuredTurnsTrusted: true,
      })
      .mockResolvedValueOnce('https://gemini.google.com/app')
      .mockResolvedValueOnce({
        turns: [
          { Role: 'Assistant', Text: '旧回答' },
          { Role: 'User', Text: '请解释' },
          { Role: 'Assistant', Text: '完整回答' },
        ],
        transcriptLines: ['baseline'],
        composerHasText: false,
        isGenerating: false,
        structuredTurnsTrusted: true,
      });

    const result = await waitForGeminiResponse(page, {
      snapshot: snapshot({
        turns: [
          { Role: 'Assistant', Text: '旧回答' },
          { Role: 'User', Text: '请解释' },
        ],
        transcriptLines: ['baseline'],
        composerHasText: false,
        isGenerating: true,
        structuredTurnsTrusted: true,
      }),
      preSendAssistantCount: 1,
      userAnchorTurn: { Role: 'User', Text: '请解释' },
      reason: 'user_turn',
    }, '请解释', 6);

    expect(result).toBe('完整回答');
  });

  it('uses transcript fallback only after two identical post-submission deltas and after generation stops', async () => {
    const page = createPageMock();
    const evaluate = vi.mocked(page.evaluate);

    evaluate
      .mockResolvedValueOnce('https://gemini.google.com/app')
      .mockResolvedValueOnce({
        turns: [{ Role: 'User', Text: '请只回复：OK' }],
        transcriptLines: ['baseline', 'OK'],
        composerHasText: false,
        isGenerating: true,
        structuredTurnsTrusted: true,
      })
      .mockResolvedValueOnce('https://gemini.google.com/app')
      .mockResolvedValueOnce({
        turns: [{ Role: 'User', Text: '请只回复：OK' }],
        transcriptLines: ['baseline', 'OK'],
        composerHasText: false,
        isGenerating: false,
        structuredTurnsTrusted: true,
      })
      .mockResolvedValueOnce('https://gemini.google.com/app')
      .mockResolvedValueOnce({
        turns: [{ Role: 'User', Text: '请只回复：OK' }],
        transcriptLines: ['baseline', 'OK'],
        composerHasText: false,
        isGenerating: false,
        structuredTurnsTrusted: true,
      });

    const result = await waitForGeminiResponse(page, {
      snapshot: snapshot({
        turns: [{ Role: 'User', Text: '请只回复：OK' }],
        transcriptLines: ['baseline'],
        composerHasText: false,
        isGenerating: true,
        structuredTurnsTrusted: true,
      }),
      preSendAssistantCount: 0,
      userAnchorTurn: { Role: 'User', Text: '请只回复：OK' },
      reason: 'user_turn',
    }, '请只回复：OK', 6);

    expect(result).toBe('OK');
  });

  it('ignores transcript lines that appeared before submission confirmation and only accepts post-submission transcript deltas', async () => {
    const page = createPageMock();
    const evaluate = vi.mocked(page.evaluate);

    evaluate
      .mockResolvedValueOnce('https://gemini.google.com/app')
      .mockResolvedValueOnce({
        turns: [{ Role: 'User', Text: '请只回复：OK' }],
        transcriptLines: ['baseline', '早到的提示词回声', 'OK'],
        composerHasText: false,
        isGenerating: false,
        structuredTurnsTrusted: true,
      })
      .mockResolvedValueOnce('https://gemini.google.com/app')
      .mockResolvedValueOnce({
        turns: [{ Role: 'User', Text: '请只回复：OK' }],
        transcriptLines: ['baseline', '早到的提示词回声', 'OK'],
        composerHasText: false,
        isGenerating: false,
        structuredTurnsTrusted: true,
      })
      .mockResolvedValueOnce('https://gemini.google.com/app')
      .mockResolvedValueOnce({
        turns: [{ Role: 'User', Text: '请只回复：OK' }],
        transcriptLines: ['baseline', '早到的提示词回声', 'OK'],
        composerHasText: false,
        isGenerating: false,
        structuredTurnsTrusted: true,
      });

    const result = await waitForGeminiResponse(page, {
      snapshot: snapshot({
        turns: [{ Role: 'User', Text: '请只回复：OK' }],
        transcriptLines: ['baseline', '早到的提示词回声'],
        composerHasText: false,
        isGenerating: true,
        structuredTurnsTrusted: true,
      }),
      preSendAssistantCount: 0,
      userAnchorTurn: { Role: 'User', Text: '请只回复：OK' },
      reason: 'composer_transcript',
    }, '请只回复：OK', 6);

    expect(result).toBe('OK');
  });
});
