import { describe, expect, it } from 'vitest';
import { parseAnswerTarget } from './answer-target.js';

describe('zhihu answer target parser', () => {
    it('accepts exact answer target shapes', () => {
        expect(parseAnswerTarget('123')).toEqual({ answerId: '123', questionId: '' });
        expect(parseAnswerTarget('  123  ')).toEqual({ answerId: '123', questionId: '' });
        expect(parseAnswerTarget('answer:10:123')).toEqual({ answerId: '123', questionId: '10' });
        expect(parseAnswerTarget('https://www.zhihu.com/question/10/answer/123')).toEqual({ answerId: '123', questionId: '10' });
        expect(parseAnswerTarget('https://zhihu.com/question/10/answer/123?utm=1#x')).toEqual({ answerId: '123', questionId: '10' });
        expect(parseAnswerTarget('https://www.zhihu.com/answer/123')).toEqual({ answerId: '123', questionId: '' });
        expect(parseAnswerTarget('https://zhihu.com/answer/123?utm=1#x')).toEqual({ answerId: '123', questionId: '' });
    });

    it('rejects empty and malformed non-URL targets', () => {
        expect(parseAnswerTarget(null)).toBeNull();
        expect(parseAnswerTarget(undefined)).toBeNull();
        expect(parseAnswerTarget('')).toBeNull();
        expect(parseAnswerTarget('   ')).toBeNull();
        expect(parseAnswerTarget('not-an-id')).toBeNull();
        expect(parseAnswerTarget('-123')).toBeNull();
        expect(parseAnswerTarget('answer:10')).toBeNull();
        expect(parseAnswerTarget('answer:10:abc')).toBeNull();
    });

    it('requires exact HTTPS Zhihu hosts and answer paths', () => {
        for (const target of [
            'http://www.zhihu.com/question/10/answer/123',
            'https://user@www.zhihu.com/question/10/answer/123',
            'https://user:pass@www.zhihu.com/question/10/answer/123',
            'https://www.zhihu.com:444/question/10/answer/123',
            'https://www.zhihu.com.evil.com/question/10/answer/123',
            'https://example.com/question/10/answer/123',
            'https://zhuanlan.zhihu.com/question/10/answer/123',
            'https://www.zhihu.com/question/10',
            'https://www.zhihu.com/question/10/answer/123/extra',
            'https://www.zhihu.com/answer/123/extra',
        ]) {
            expect(parseAnswerTarget(target)).toBeNull();
        }
    });
});
