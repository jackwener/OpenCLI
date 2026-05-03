import { describe, it, expect } from 'vitest';
import { __test__ } from './publish.js';
import './publish.js';

describe('xianyu/publish', () => {
    describe('buildPublishUrl', () => {
        it('returns the correct goofish publish URL', () => {
            expect(__test__?.buildPublishUrl()).toBe('https://www.goofish.com/publish');
        });
    });
});
