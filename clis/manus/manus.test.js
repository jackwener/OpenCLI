import { describe, expect, it } from 'vitest';

import { isManusUrl } from './_utils.js';

// ═══════════════════════════════════════════════════════════════════════════
// 9. isManusUrl helper
// ═══════════════════════════════════════════════════════════════════════════

describe('manus URL validation', () => {
  it('accepts valid manus.im URLs', () => {
    expect(isManusUrl('https://manus.im/app')).toBe(true);
    expect(isManusUrl('https://manus.im/app/sessions')).toBe(true);
  });

  it('rejects non-manus URLs', () => {
    expect(isManusUrl('https://other.com')).toBe(false);
    expect(isManusUrl('https://manus.im.evil.com/app')).toBe(false);
  });

  it('rejects http (non-https) URLs', () => {
    expect(isManusUrl('http://manus.im/app')).toBe(false);
  });
});
