import { describe, expect, it } from 'vitest';
import { collectGeminiTranscriptAdditions, sanitizeGeminiResponseText } from './utils.js';

describe('sanitizeGeminiResponseText', () => {
  it('strips a prompt echo only when it appears as a prefixed block', () => {
    const prompt = 'Reply with the word opencli';
    const value = `Reply with the word opencli\n\nopencli`;
    expect(sanitizeGeminiResponseText(value, prompt)).toBe('opencli');
  });

  it('does not strip prompt text that appears later in a legitimate answer', () => {
    const prompt = 'opencli';
    const value = 'You asked about opencli, and opencli is the right keyword here.';
    expect(sanitizeGeminiResponseText(value, prompt)).toBe(value);
  });

  it('removes known Gemini footer noise', () => {
    const value = 'Answer body\nGemini can make mistakes.\nGoogle Terms';
    expect(sanitizeGeminiResponseText(value, '')).toBe('Answer body');
  });
});

describe('collectGeminiTranscriptAdditions', () => {
  it('joins multiple new transcript lines instead of keeping only the last line', () => {
    const before = ['Older answer'];
    const current = ['Older answer', 'First new line', 'Second new line'];
    expect(collectGeminiTranscriptAdditions(before, current, '')).toBe('First new line\nSecond new line');
  });

  it('filters prompt echoes out of transcript additions', () => {
    const prompt = 'Tell me a haiku';
    const before = ['Previous'];
    const current = ['Previous', 'Tell me a haiku', 'Tell me a haiku\n\nSoft spring rain arrives'];
    expect(collectGeminiTranscriptAdditions(before, current, prompt)).toBe('Soft spring rain arrives');
  });
});
