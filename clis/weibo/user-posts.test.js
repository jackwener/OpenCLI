import { describe, expect, it } from 'vitest';

import { testInternals } from './user-posts.js';

describe('weibo user-posts', () => {
    it('converts Asia/Shanghai date boundaries to unix seconds', () => {
        expect(testInternals.dateToTimestamp('2025-06-01')).toBe(1748707200);
        expect(testInternals.dateToTimestamp('2025-01-01')).toBe(1735660800);
    });

});
