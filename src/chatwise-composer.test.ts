import { describe, expect, it } from 'vitest';
import {
  scoreChatwiseComposerCandidate,
  selectBestChatwiseComposer,
  type ChatwiseComposerCandidate,
} from './clis/chatwise/utils.js';

function candidate(overrides: Partial<ChatwiseComposerCandidate>): ChatwiseComposerCandidate {
  return {
    index: 0,
    hidden: false,
    role: 'textbox',
    classes: 'cm-content cm-lineWrapping',
    editorClasses: 'cm-editor',
    placeholder: '',
    text: '',
    rect: { y: 0, h: 30 },
    ...overrides,
  };
}

describe('scoreChatwiseComposerCandidate', () => {
  it('strongly prefers the main chat composer over auxiliary editors', () => {
    const mainComposer = candidate({
      index: 0,
      placeholder: 'placeholder Enter a message here, press ⏎ to send',
      rect: { y: 860, h: 32 },
    });
    const optionalDescription = candidate({
      index: 1,
      placeholder: 'placeholder Optional description',
      editorClasses: 'cm-editor simple-editor',
      rect: { y: 400, h: 32 },
    });
    const userContext = candidate({
      index: 2,
      text: '# User Context Document',
      editorClasses: 'cm-editor simple-editor',
      rect: { y: 460, h: 1200 },
    });

    expect(scoreChatwiseComposerCandidate(mainComposer, 900)).toBeGreaterThan(
      scoreChatwiseComposerCandidate(optionalDescription, 900),
    );
    expect(scoreChatwiseComposerCandidate(mainComposer, 900)).toBeGreaterThan(
      scoreChatwiseComposerCandidate(userContext, 900),
    );
  });
});

describe('selectBestChatwiseComposer', () => {
  it('returns the candidate that matches the main message composer', () => {
    const picked = selectBestChatwiseComposer([
      candidate({
        index: 0,
        placeholder: 'placeholder Enter a message here, press ⏎ to send',
        rect: { y: 858, h: 33 },
      }),
      candidate({
        index: 1,
        placeholder: 'placeholder Optional description',
        editorClasses: 'cm-editor simple-editor',
        rect: { y: 395, h: 30 },
      }),
      candidate({
        index: 2,
        text: '# User Context Document',
        editorClasses: 'cm-editor simple-editor',
        rect: { y: 464, h: 1200 },
      }),
    ], 900);

    expect(picked?.index).toBe(0);
  });
});
