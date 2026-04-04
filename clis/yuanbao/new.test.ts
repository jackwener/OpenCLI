import { describe, expect, it, vi } from 'vitest';
import type { IPage } from '../../src/types.js';
import { AuthRequiredError } from '../../src/errors.js';
import { newCommand } from './new.js';

function createNewPageMock(overrides: {
  currentUrl?: string;
  triggerAction?: 'clicked' | 'navigate';
  hasLoginGate?: boolean;
  composerText?: string;
} = {}): IPage {
  const currentUrl = overrides.currentUrl ?? 'https://yuanbao.tencent.com/';
  const triggerAction = overrides.triggerAction ?? 'clicked';
  const hasLoginGate = overrides.hasLoginGate ?? false;
  const composerText = overrides.composerText ?? '';

  return {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockImplementation(async (script: string) => {
      if (script === 'window.location.href') return currentUrl;
      if (script.includes('微信扫码登录')) return hasLoginGate;
      if (script.includes('.ql-editor, [contenteditable="true"]')) return composerText;
      if (script.includes('const trigger = Array.from(document.querySelectorAll')) return triggerAction;
      throw new Error(`Unexpected evaluate script in test: ${script.slice(0, 80)}`);
    }),
  } as unknown as IPage;
}

describe('yuanbao new command', () => {
  it('throws AuthRequiredError when Yuanbao shows a login gate', async () => {
    const page = createNewPageMock({ hasLoginGate: true });

    await expect(newCommand.func!(page, {})).rejects.toBeInstanceOf(AuthRequiredError);
  });
});
