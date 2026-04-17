import { describe, expect, it } from 'vitest';
import { CliError } from '@jackwener/opencli/errors';
import { __test__ } from './target.js';
describe('zhihu target parser', () => {
    it('parses typed answer IDs into canonical targets', () => {
        expect(__test__.parseTarget('answer:123:456')).toEqual({
            kind: 'answer',
            questionId: '123',
            id: '456',
            url: 'https://www.zhihu.com/question/123/answer/456',
        });
    });
    it('parses question URLs into canonical targets', () => {
        expect(__test__.parseTarget('https://www.zhihu.com/question/123456')).toEqual({
            kind: 'question',
            id: '123456',
            url: 'https://www.zhihu.com/question/123456',
        });
    });
    it('canonicalizes question URLs with query strings and fragments', () => {
        expect(__test__.parseTarget('https://www.zhihu.com/question/123456/?utm_source=share#answer-1')).toEqual({
            kind: 'question',
            id: '123456',
            url: 'https://www.zhihu.com/question/123456',
        });
    });
    it('canonicalizes answer URLs with query strings and fragments', () => {
        expect(__test__.parseTarget('https://www.zhihu.com/question/123456/answer/7890/?utm_psn=1#comment')).toEqual({
            kind: 'answer',
            questionId: '123456',
            id: '7890',
            url: 'https://www.zhihu.com/question/123456/answer/7890',
        });
    });
    it('canonicalizes article URLs with query strings and fragments', () => {
        expect(__test__.parseTarget('https://zhuanlan.zhihu.com/p/98765/?utm_id=1#heading')).toEqual({
            kind: 'article',
            id: '98765',
            url: 'https://zhuanlan.zhihu.com/p/98765',
        });
    });
    it('canonicalizes user URLs with trailing slash, query strings, and fragments', () => {
        expect(__test__.parseTarget('https://www.zhihu.com/people/example-user/?utm_term=share#about')).toEqual({
            kind: 'user',
            slug: 'example-user',
            url: 'https://www.zhihu.com/people/example-user',
        });
    });
    it('rejects non-https Zhihu URLs', () => {
        expect(() => __test__.parseTarget('http://www.zhihu.com/question/123456')).toThrowError(CliError);
    });
    it('rejects Zhihu URLs with embedded credentials', () => {
        expect(() => __test__.parseTarget('https://user@www.zhihu.com/question/123456')).toThrowError(CliError);
    });
    it('rejects Zhihu URLs with explicit ports', () => {
        expect(() => __test__.parseTarget('https://www.zhihu.com:8443/question/123456')).toThrowError(CliError);
    });
    it('rejects Zhihu URLs with empty authority usernames', () => {
        expect(() => __test__.parseTarget('https://@www.zhihu.com/question/123456')).toThrowError(CliError);
    });
    it('rejects Zhihu URLs with empty authority username and password markers', () => {
        expect(() => __test__.parseTarget('https://:@www.zhihu.com/question/123456')).toThrowError(CliError);
    });
    it('rejects ambiguous bare numeric IDs', () => {
        expect(() => __test__.parseTarget('123456')).toThrowError(CliError);
    });
    it('rejects malformed typed IDs', () => {
        expect(() => __test__.parseTarget('answer:123')).toThrowError(/answer:<questionId>:<answerId>/);
    });
    it('rejects unsupported target kinds per command', () => {
        expect(() => __test__.assertAllowedKinds('follow', {
            kind: 'article',
            id: '1',
            url: 'https://zhuanlan.zhihu.com/p/1',
        })).toThrowError(/follow/);
    });
});
