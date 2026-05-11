import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './code.js';
import './preview.js';

describe('uiverse navigateBefore hardening', () => {
  it.each(['uiverse/code', 'uiverse/preview'])('%s starts from uiverse home instead of about:blank', (name) => {
    const cmd = getRegistry().get(name);
    expect(cmd).toBeDefined();
    expect(cmd.navigateBefore).toBe('https://uiverse.io');
  });
});
