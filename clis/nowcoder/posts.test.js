import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './detail.js';
import './experience.js';
import './search.js';

const detail = getRegistry().get('nowcoder/detail');
const experience = getRegistry().get('nowcoder/experience');
const search = getRegistry().get('nowcoder/search');
const CONTENT_ID = '912885704667987968';
const CONTENT_UUID = '162ac6f4410646009f97bf18012870c3';
const MOMENT_ID = '2882961';
const MOMENT_UUID = '24e01f1d510a486b92efa795b4835669';

function pageWith(data, envelope = {}) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        fetchJson: vi.fn().mockResolvedValue({ success: true, code: 0, msg: 'OK', data, ...envelope }),
    };
}

function feed(kind, includeOuterId = true) {
    const content = kind === 'content';
    const id = content ? CONTENT_ID : MOMENT_ID;
    const post = content ? {
        id, uuid: CONTENT_UUID, authorId: '646661816', entityId: 1662830, entityType: 8,
        title: '长文章', content: '<p>内容摘要 &amp; 题解</p>', createTime: Date.parse('2026-08-01T12:00:00+08:00'),
    } : {
        id: Number(id), uuid: MOMENT_UUID, userId: 125006155,
        title: '一面记录', content: '动态正文', createdAt: Date.parse('2026-08-01T20:00:00+08:00'),
    };
    return {
        ...(includeOuterId ? { contentId: id } : {}),
        contentType: content ? 250 : 74,
        userBrief: content
            ? { userId: 646661816, nickname: '内容作者', educationInfo: '示例大学' }
            : { userId: 125006155, nickname: '动态作者', educationInfo: null },
        contentData: content ? post : null,
        momentData: content ? null : post,
        frequencyData: { likeCnt: content ? 4 : 1, commentCnt: 3, viewCnt: content ? 20 : 5 },
    };
}

function detailData(kind) {
    const content = kind === 'content';
    return {
        id: content ? CONTENT_ID : Number(MOMENT_ID),
        uuid: content ? CONTENT_UUID : MOMENT_UUID,
        entityId: content ? 1662830 : Number(MOMENT_ID),
        entityType: content ? 8 : 74,
        ...(content ? { authorId: 646661816 } : { userId: 125006155 }),
        title: content ? '长面经' : '一面记录',
        content: content ? '不应读取的备用字段' : '动态正文',
        richText: content
            ? '<h2>步骤</h2>\n  <ol>\n    <li>第一项<br>续行</li>\n    <li><pre>  x &lt; y\n    z</pre></li>\n  </ol>\n  <img alt="流程图"><script>leak</script>'
            : '不应读取',
        ...(content
            ? { createTime: Date.parse('2026-08-01T12:00:00+08:00') }
            : { createdAt: Date.parse('2026-08-01T20:00:00+08:00') }),
        userBrief: content
            ? { userId: 646661816, nickname: '内容作者', educationInfo: '示例大学' }
            : { userId: 125006155, nickname: '动态作者', educationInfo: null },
        frequencyData: { likeCnt: 4, commentCnt: 3, viewCnt: 20 },
        ip4Location: content ? '上海' : '广东',
    };
}

describe('Nowcoder mixed post entity contract', () => {
    it('keeps mixed search/experience order with exact identity, route, author, and timestamp mappings', async () => {
        const searchPage = pageWith({ records: [feed('content', false), feed('moment', false)] });
        const rows = await search.func(searchPage, { query: '面试', type: 'post', limit: 2 });
        expect(rows).toMatchObject([
            { rank: 1, post_type: 'content', id: CONTENT_ID, uuid: CONTENT_UUID, entity_id: '1662830', url: `https://www.nowcoder.com/discuss/${CONTENT_ID}`, author_id: '646661816', content: '内容摘要 & 题解', time: '2026-08-01T04:00:00.000Z' },
            { rank: 2, post_type: 'moment', id: MOMENT_UUID, uuid: MOMENT_UUID, entity_id: MOMENT_ID, url: `https://www.nowcoder.com/feed/main/detail/${MOMENT_UUID}`, author_id: '125006155', time: '2026-08-01T12:00:00.000Z' },
        ]);
        expect(searchPage.fetchJson).toHaveBeenCalledWith(expect.stringContaining('/pc/search'), expect.objectContaining({ body: { query: '面试', type: 'post', page: 1, pageSize: 2 } }));
        expect(searchPage.goto).toHaveBeenCalledTimes(1);

        const experiencePage = pageWith({ records: [feed('moment'), feed('content')] });
        const experienceRows = await experience.func(experiencePage, { page: 3, limit: 2 });
        expect(experienceRows.map(({ post_type, id, rank }) => ({ post_type, id, rank }))).toEqual([
            { post_type: 'moment', id: MOMENT_UUID, rank: 1 },
            { post_type: 'content', id: CONTENT_ID, rank: 2 },
        ]);
        expect(experiencePage.fetchJson.mock.calls[0][0]).toContain('pageNo=3');
        expect(experiencePage.goto).toHaveBeenCalledTimes(1);
    });

    it('routes each detail type directly and cleans only its source-specific complete body field', async () => {
        const contentPage = pageWith(detailData('content'));
        const [content] = await detail.func(contentPage, { id: `https://www.nowcoder.com/discuss/${CONTENT_ID}?sourceSSR=search` });
        expect(contentPage.fetchJson.mock.calls[0][0]).toContain(`/content-data/detail/${CONTENT_ID}`);
        expect(contentPage.goto).toHaveBeenCalledTimes(1);
        expect(content).toMatchObject({ post_type: 'content', id: CONTENT_ID, uuid: CONTENT_UUID, entity_id: '1662830' });
        expect(content.content).toBe('步骤\n\n- 第一项\n续行\n\n-\n  x < y\n    z\n\n流程图');

        const momentPage = pageWith(detailData('moment'));
        const [moment] = await detail.func(momentPage, { id: MOMENT_UUID.toUpperCase() });
        expect(momentPage.fetchJson.mock.calls[0][0]).toContain(`/moment-data/detail/${MOMENT_UUID}`);
        expect(moment).toMatchObject({ post_type: 'moment', id: MOMENT_UUID, entity_id: MOMENT_ID, content: '动态正文' });
        expect(moment.content).not.toContain('不应读取');
    });

    it('typed-fails missing/unknown discriminants and cross-type/identity mismatches without partial rows', async () => {
        const badRows = [
            feed('content', false),
            { ...feed('content'), contentType: undefined },
            { ...feed('content'), contentType: 999 },
            { ...feed('content'), momentData: feed('moment').momentData },
            { ...feed('moment'), contentId: '2882962' },
        ];
        for (const badRow of badRows) {
            await expect(experience.func(pageWith({ records: [feed('content'), badRow] }), { page: 1, limit: 1 }))
                .rejects.toBeInstanceOf(CommandExecutionError);
        }
    });

    it('validates args/routes before browser work and rejects echoed detail identity drift', async () => {
        for (const command of [detail, search, experience]) expect(command.navigateBefore).toBe(false);
        const manifest = JSON.parse(readFileSync(new URL('../../cli-manifest.json', import.meta.url), 'utf8'));
        const navigation = Object.fromEntries(manifest
            .filter((command) => command.site === 'nowcoder' && ['detail', 'search', 'experience'].includes(command.name))
            .map((command) => [command.name, command.navigateBefore]));
        expect(navigation).toEqual({ detail: false, experience: false, search: false });

        const page = pageWith({});
        await expect(detail.func(page, { id: 'https://example.com/discuss/123' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(search.func(page, { query: '面试', type: 'user', limit: 10 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(experience.func(page, { page: 0, limit: 15 })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();

        const mismatch = detailData('moment');
        mismatch.uuid = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        await expect(detail.func(pageWith(mismatch), { id: MOMENT_UUID })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('types auth, malformed envelopes, and true empty separately', async () => {
        await expect(experience.func(pageWith(null, { success: false, code: 999, msg: 'need login' }), { page: 1, limit: 15 }))
            .rejects.toBeInstanceOf(AuthRequiredError);
        await expect(search.func(pageWith([], {}), { query: '面试', type: 'post', limit: 10 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(search.func(pageWith({ records: [] }), { query: '无结果', type: 'post', limit: 10 }))
            .rejects.toBeInstanceOf(EmptyResultError);
    });
});
