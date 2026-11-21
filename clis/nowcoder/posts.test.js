import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { log } from '@jackwener/opencli/logger';
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
const NORMAL_AUTHOR_ID = 125006155;
const ANONYMOUS_PRESENTATION_ID = 1030037872;
const CONTENT_TIME = Date.parse('2026-08-01T12:00:00+08:00');
const MOMENT_TIME = Date.parse('2026-08-01T20:00:00+08:00');
const LIVE_CAPTURE = JSON.parse(readFileSync(
    new URL('./__fixtures__/search-detail.capture.json', import.meta.url),
    'utf8',
));

afterEach(() => {
    vi.restoreAllMocks();
});

function pageWith(data, envelope = {}) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        fetchJson: vi.fn().mockResolvedValue({ success: true, code: 0, msg: 'OK', data, ...envelope }),
    };
}

function contentFeed({
    includeOuterId = false,
    entityType = 8,
    authorId = 646661816,
    presentationAuthorId = authorId,
    title = entityType === 73 ? '长文章' : '讨论帖',
} = {}) {
    return {
        rc_type: 0,
        ...(includeOuterId ? { contentId: CONTENT_ID } : {}),
        contentType: 250,
        userBrief: { userId: presentationAuthorId, nickname: '内容作者', educationInfo: '示例大学' },
        contentData: {
            id: CONTENT_ID,
            uuid: CONTENT_UUID,
            authorId: String(authorId),
            entityId: 1662830,
            entityType,
            title,
            content: '<p>内容摘要 &amp; 题解</p>',
            createTime: CONTENT_TIME,
            isAnonymousFlag: false,
        },
        momentData: null,
        frequencyData: { likeCnt: 4, commentCnt: 3, viewCnt: 20, followCnt: 2, shareCnt: 1 },
    };
}

function momentFeed({
    includeOuterId = false,
    anonymous = false,
    userId = NORMAL_AUTHOR_ID,
    presentationUserId = anonymous ? ANONYMOUS_PRESENTATION_ID : userId,
} = {}) {
    return {
        rc_type: 0,
        ...(includeOuterId ? { contentId: MOMENT_ID } : {}),
        contentType: 74,
        userBrief: {
            userId: presentationUserId,
            nickname: anonymous ? '匿名牛油' : '动态作者',
            educationInfo: anonymous ? null : '示例大学',
        },
        contentData: null,
        momentData: {
            id: Number(MOMENT_ID),
            uuid: MOMENT_UUID,
            userId,
            isAnonymousFlag: anonymous,
            title: '一面记录',
            content: '动态正文',
            createdAt: MOMENT_TIME,
        },
        frequencyData: { likeCnt: 1, commentCnt: 2, viewCnt: 5 },
    };
}

function wrapped(rcType, data, title = null) {
    return {
        rc_type: rcType,
        entityDataId: 0,
        triggerId: null,
        trackId: 'fixture-track',
        title,
        expandType: 0,
        extraInfo: {},
        data,
    };
}

function jobItem(id, {
    title = 'Unity客户端开发',
    company = '4399游戏',
    time = Date.parse('2026-08-02T10:00:00+08:00'),
} = {}) {
    return {
        rc_type: 1001,
        entityDataId: id,
        triggerId: null,
        trackId: 'fixture-track',
        title: null,
        expandType: 0,
        extraInfo: {},
        data: {
            id,
            jobName: title,
            companyId: 768,
            recommendInternCompany: { companyId: 768, companyName: company },
            updateTime: time,
            refreshTime: time - 1000,
            createTime: time - 2000,
        },
    };
}

function jobGroup(items = [
    jobItem(404850),
    jobItem(466896, { title: 'AI工具应用实习生', company: '英雄游戏' }),
]) {
    return wrapped(213, items, 'Python-职位');
}

function companyResult() {
    return wrapped(205, {
        companyName: '华为',
        companyId: 239,
        companyPlace: '深圳',
        jobCount: 12,
    });
}

function detailData(kind, entityType = 8) {
    const content = kind === 'content';
    return {
        id: content ? CONTENT_ID : Number(MOMENT_ID),
        uuid: content ? CONTENT_UUID : MOMENT_UUID,
        entityId: content ? 1662830 : Number(MOMENT_ID),
        entityType: content ? entityType : 74,
        ...(content ? { authorId: 646661816 } : { userId: NORMAL_AUTHOR_ID }),
        title: content ? '长面经' : '一面记录',
        content: content ? '不应读取的备用字段' : '动态正文',
        richText: content
            ? '<h2>步骤</h2>\n  <ol>\n    <li>第一项<br>续行</li>\n    <li><pre>  x &lt; y\n    z</pre></li>\n  </ol>\n  <img alt="流程图"><script>leak</script>'
            : '不应读取',
        ...(content ? { createTime: CONTENT_TIME } : { createdAt: MOMENT_TIME }),
        userBrief: content
            ? { userId: 646661816, nickname: '内容作者', educationInfo: '示例大学' }
            : { userId: NORMAL_AUTHOR_ID, nickname: '动态作者', educationInfo: null },
        frequencyData: { likeCnt: 4, commentCnt: 3, viewCnt: 20 },
        ip4Location: content ? '上海' : '广东',
        isAnonymousFlag: false,
    };
}

describe('Nowcoder typed mixed post feed', () => {
    it('parses cropped live mixed search and dedicated detail shapes', async () => {
        const allPage = pageWith({ records: LIVE_CAPTURE.searchAll.records });
        const allRows = await search.func(allPage, { query: 'Python', type: 'all', limit: 10 });
        expect(allRows.map(({ post_type, id, rc_type }) => ({ post_type, id, rc_type }))).toEqual([
            { post_type: 'content', id: '1338', rc_type: 207 },
            { post_type: 'moment', id: '000000000000000000000000000004f6', rc_type: 201 },
            { post_type: 'job', id: '1275', rc_type: 213 },
        ]);

        const directPage = pageWith({ records: LIVE_CAPTURE.searchPost.records });
        const [direct] = await search.func(directPage, { query: 'Python', type: 'post', limit: 1 });
        expect(direct).toMatchObject({
            post_type: 'moment',
            id: '0000000000000000000000000000050d',
            title: 'Captured direct post',
        });

        const [content] = await detail.func(pageWith(LIVE_CAPTURE.details.content), { id: '1024' });
        expect(content).toMatchObject({
            post_type: 'content',
            id: '1024',
            entity_type: 8,
            content: 'Captured detail body',
        });

        const [moment] = await detail.func(pageWith(LIVE_CAPTURE.details.moment), {
            id: '000000000000000000000000000003eb',
        });
        expect(moment).toMatchObject({
            post_type: 'moment',
            id: '000000000000000000000000000003eb',
            entity_type: 74,
            content: 'Captured moment detail body',
        });
    });

    it('parses direct content entity types 8/73 and normal/anonymous moments with raw metadata', async () => {
        const page = pageWith({
            records: [
                contentFeed({ entityType: 73 }),
                momentFeed(),
                momentFeed({ anonymous: true, userId: 1030050879 }),
            ],
        });
        const rows = await search.func(page, { query: 'Python', type: 'post', limit: 3 });

        expect(rows.map(({ rank, post_type, rc_type, content_type, entity_type, is_anonymous }) => ({
            rank, post_type, rc_type, content_type, entity_type, is_anonymous,
        }))).toEqual([
            { rank: 1, post_type: 'content', rc_type: 0, content_type: 250, entity_type: 73, is_anonymous: false },
            { rank: 2, post_type: 'moment', rc_type: 0, content_type: 74, entity_type: 74, is_anonymous: false },
            { rank: 3, post_type: 'moment', rc_type: 0, content_type: 74, entity_type: 74, is_anonymous: true },
        ]);
        expect(rows[2]).toMatchObject({
            author: '匿名牛油',
            author_id: String(ANONYMOUS_PRESENTATION_ID),
            author_url: `https://www.nowcoder.com/users/${ANONYMOUS_PRESENTATION_ID}`,
        });
    });

    it('keeps mixed search/experience order and sends the webpage search body', async () => {
        const searchPage = pageWith({ records: [contentFeed(), momentFeed()] });
        const rows = await search.func(searchPage, { query: '面试', type: 'post', limit: 2 });
        expect(rows).toMatchObject([
            {
                rank: 1,
                post_type: 'content',
                id: CONTENT_ID,
                uuid: CONTENT_UUID,
                entity_id: '1662830',
                url: `https://www.nowcoder.com/discuss/${CONTENT_ID}`,
                author_id: '646661816',
                content: '内容摘要 & 题解',
                time: '2026-08-01T04:00:00.000Z',
            },
            {
                rank: 2,
                post_type: 'moment',
                id: MOMENT_UUID,
                uuid: MOMENT_UUID,
                entity_id: MOMENT_ID,
                url: `https://www.nowcoder.com/feed/main/detail/${MOMENT_UUID}`,
                author_id: String(NORMAL_AUTHOR_ID),
                time: '2026-08-01T12:00:00.000Z',
            },
        ]);
        expect(searchPage.fetchJson).toHaveBeenCalledWith(
            expect.stringContaining('/pc/search'),
            expect.objectContaining({
                body: { query: '面试', type: 'post', page: 1, pageSize: 2, order: '', tag: [{ id: 0 }] },
            }),
        );

        const experiencePage = pageWith({
            records: [momentFeed({ includeOuterId: true }), contentFeed({ includeOuterId: true })],
        });
        const experienceRows = await experience.func(experiencePage, { page: 3, limit: 2 });
        expect(experienceRows.map(({ post_type, id, rank }) => ({ post_type, id, rank }))).toEqual([
            { post_type: 'moment', id: MOMENT_UUID, rank: 1 },
            { post_type: 'content', id: CONTENT_ID, rank: 2 },
        ]);
        expect(experiencePage.fetchJson.mock.calls[0][0]).toContain('pageNo=3');
    });

    it('parses wrapped 207/201/213, skips 205, and preserves contiguous job rows', async () => {
        const page = pageWith({
            records: [
                wrapped(207, contentFeed({ includeOuterId: true, entityType: 73 })),
                wrapped(201, momentFeed({ includeOuterId: true })),
                jobGroup(),
                companyResult(),
            ],
        });
        const rows = await search.func(page, { query: 'Python', type: 'all', limit: 10 });

        expect(rows).toHaveLength(4);
        expect(rows.map(({ rank, post_type, rc_type }) => ({ rank, post_type, rc_type }))).toEqual([
            { rank: 1, post_type: 'content', rc_type: 207 },
            { rank: 2, post_type: 'moment', rc_type: 201 },
            { rank: 3, post_type: 'job', rc_type: 213 },
            { rank: 4, post_type: 'job', rc_type: 213 },
        ]);
        expect(rows[0]).toMatchObject({ content_type: 250, entity_type: 73 });
        expect(rows[1]).toMatchObject({ content_type: 74, entity_type: 74, is_anonymous: false });
        expect(rows[2]).toMatchObject({
            id: '404850',
            entity_id: '404850',
            title: 'Unity客户端开发',
            company: '4399游戏',
            company_id: '768',
            time: '2026-08-02T02:00:00.000Z',
            author: '',
            author_id: '',
            author_url: '',
            content: '',
            likes: '',
            comments: '',
            views: '',
            url: '',
            content_type: '',
            entity_type: '',
            job_rc_type: 1001,
        });
        expect(rows[3]).toMatchObject({ id: '466896', title: 'AI工具应用实习生', company: '英雄游戏', rank: 4 });
    });

    it('skips an unknown record between valid rows and reports a concise verbose diagnostic', async () => {
        const verbose = vi.spyOn(log, 'verbose').mockImplementation(() => {});
        const page = pageWith({
            records: [
                wrapped(207, contentFeed({ includeOuterId: true, entityType: 73 })),
                wrapped(999, { private: 'ignored' }),
                wrapped(201, momentFeed({ includeOuterId: true })),
            ],
        });
        const rows = await search.func(page, { query: 'Java', type: 'all', limit: 2 });

        expect(rows.map(({ rank, post_type }) => ({ rank, post_type }))).toEqual([
            { rank: 1, post_type: 'content' },
            { rank: 2, post_type: 'moment' },
        ]);
        expect(verbose).toHaveBeenCalledWith(expect.stringMatching(/type=unknown, rc_type=999, .*reason=unsupported rc_type 999/));
    });

    it('keeps valid rows when malformed or unmarked-author records fail per row', async () => {
        const unmarkedMismatch = momentFeed({ userId: 222222222, presentationUserId: 111111111 });
        const badContent = contentFeed({ entityType: 999 });
        const page = pageWith({
            records: [badContent, contentFeed({ entityType: 73 }), unmarkedMismatch, momentFeed()],
        });
        const rows = await search.func(page, { query: 'C++', type: 'post', limit: 4 });

        expect(rows.map(({ rank, post_type }) => ({ rank, post_type }))).toEqual([
            { rank: 1, post_type: 'content' },
            { rank: 2, post_type: 'moment' },
        ]);
    });

    it('allows missing author data without dropping the post', async () => {
        const missingBrief = contentFeed({ entityType: 73 });
        missingBrief.userBrief = null;
        const missingAuthorId = momentFeed();
        missingAuthorId.userBrief = { nickname: null, educationInfo: null };
        const page = pageWith({ records: [missingBrief, missingAuthorId] });

        const rows = await search.func(page, { query: 'Java', type: 'post', limit: 2 });

        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
            rank: 1,
            post_type: 'content',
            author: '',
            author_id: '',
            author_url: '',
            school: '',
        });
        expect(rows[1]).toMatchObject({
            rank: 2,
            post_type: 'moment',
            author: '',
            author_id: '',
            author_url: '',
        });
    });

    it('throws COMMAND_EXEC with skipped reasons when records exist but none parse', async () => {
        const page = pageWith({ records: [companyResult(), wrapped(999, [])] });
        await expect(search.func(page, { query: '华为', type: 'all', limit: 5 }))
            .rejects.toThrow(/Nowcoder search skipped all 2 records: .*company:unsupported company result.*unknown:unsupported rc_type 999/);
    });

    it('routes content entityType73 and moment detail directly', async () => {
        const content73Page = pageWith(detailData('content', 73));
        const [content73] = await detail.func(content73Page, { id: `https://www.nowcoder.com/discuss/${CONTENT_ID}?sourceSSR=search` });
        expect(content73Page.fetchJson.mock.calls[0][0]).toContain(`/content-data/detail/${CONTENT_ID}`);
        expect(content73).toMatchObject({
            post_type: 'content',
            id: CONTENT_ID,
            uuid: CONTENT_UUID,
            entity_id: '1662830',
            content_type: 250,
            entity_type: 73,
        });
        expect(content73.content).toBe('步骤\n\n- 第一项\n续行\n\n-\n  x < y\n    z\n\n流程图');

        const momentPage = pageWith(detailData('moment'));
        const [moment] = await detail.func(momentPage, { id: MOMENT_UUID.toUpperCase() });
        expect(momentPage.fetchJson.mock.calls[0][0]).toContain(`/moment-data/detail/${MOMENT_UUID}`);
        expect(moment).toMatchObject({ post_type: 'moment', id: MOMENT_UUID, entity_id: MOMENT_ID, content: '动态正文' });
        expect(moment.content).not.toContain('不应读取');
    });

    it('validates args/routes before browser work and rejects identity drift', async () => {
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
