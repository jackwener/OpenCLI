import { expect, it } from 'vitest';
import vm from 'node:vm';
import { buildDeleteScript } from './comment-delete.js';
import { buildCommentScript } from './comment.js';

// Execute the real generated scripts against a local webpack/API fixture only.
async function runScript(script, endpoint, response) {
    let writes = 0;
    const axios = { post: async () => { writes++; return response; } };
    const wrapper = vm.runInNewContext(`() => axios.post(${JSON.stringify(endpoint)})`, { axios });
    const req = () => {};
    req.c = { api: { exports: { wrapper } } };
    const chunk = [];
    chunk.push = ([ids, modules, runtime]) => runtime(req);
    const result = await vm.runInNewContext(script, {
        window: { webpackChunkxhs_pc_web: chunk },
        document: { querySelector: () => null },
        location: { pathname: '/explore/test' },
    });
    expect(writes).toBe(1);
    return result;
}

const deleteScript = buildDeleteScript({ noteId: '6aa6a0ea000000002900f122', commentId: '6aa6bdb0000000000b0074cb' });
it.each([undefined, null, {}, [], 'not-json', { data: {} }, { success: false }, { code: 1 }, { code: 0, success: false }])('does not confirm deletion on an unconfirmed/rejected response: %j', async response => {
    const result = await runScript(deleteScript, '/api/sns/web/v1/comment/delete', response);
    expect(result.ok).toBe(false);
});
it.each([{ code: 0 }, { success: true }, { data: { code: 0, success: true } }])('recognizes explicit API confirmation: %j', async response => {
    const result = await runScript(deleteScript, '/api/sns/web/v1/comment/delete', response);
    expect(result.ok).toBe(true);
});
it('extracts a created comment from the signed wrapper without repeating the write', async () => {
    const result = await runScript(buildCommentScript({ noteId: '6aa6a0ea000000002900f122', content: 'local fixture' }), '/api/sns/web/v1/comment/post', { code: 0, success: true, data: { comment: { id: 'created-id' } } });
    expect(result).toEqual({ ok: true, comment_id: 'created-id' });
});
