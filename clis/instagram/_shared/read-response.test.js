import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import '../user.js';
import '../search.js';
function fixture(body,status=200) {
    const fetch = vi.fn(async()=>new Response(body,{status}));
    return {fetch,page:{goto:vi.fn(),evaluate:async script=>new Function('fetch',`return (${script})`)(fetch)}};
}
// profile reads through the web client instead; see ../profile.test.js.
describe.each(['user','search'])('Instagram %s errors',name=>{
    const args={username:'fixture',query:'fixture',limit:1};
    const run=page=>getRegistry().get(`instagram/${name}`).func(page,args);
    it('rejects HTTP 429 without retries or fallback',async()=>{
        const {fetch,page}=fixture('<html>limited</html>',429);
        await expect(run(page)).rejects.toMatchObject({code:'COMMAND_EXEC',hint:expect.stringContaining('Wait before retrying')});
        expect(fetch).toHaveBeenCalledTimes(1);
    });
    it('reports HTML without exposing its private contents',async()=>{
        const {page}=fixture('<html>PRIVATE CONTENT</html>');
        await expect(run(page)).rejects.toMatchObject({code:'COMMAND_EXEC',message:expect.stringContaining('HTML instead of JSON')});
        try {await run(page);} catch(e){expect(e.message).not.toContain('PRIVATE CONTENT');}
    });
    it.each(['<html><form action="/accounts/login/">Login</form></html>','{"message":"login_required","status":"fail"}'])('classifies explicit login evidence',async body=>{
        await expect(run(fixture(body).page)).rejects.toMatchObject({code:'AUTH_REQUIRED'});
    });
    it('reports malformed payloads instead of empty success',async()=>{
        await expect(run(fixture('{}').page)).rejects.toMatchObject({code:'COMMAND_EXEC'});
    });
    it('converts network errors to typed errors',async()=>{
        const page={goto:vi.fn(),evaluate:async script=>new Function('fetch',`return (${script})`)(async()=>{throw new TypeError('Failed to fetch');})};
        await expect(run(page)).rejects.toMatchObject({code:'COMMAND_EXEC'});
    });
    it('has no homepage pre-navigation',()=>{
        expect(getRegistry().get(`instagram/${name}`).navigateBefore).toBe(false);
    });
});
it('navigates user directly to the requested profile',async()=>{
    const {page}=fixture('{"items":[]}');
    await getRegistry().get('instagram/user').func(page,{username:'fixture',limit:1});
    expect(page.goto).toHaveBeenCalledWith('https://www.instagram.com/fixture/');
});
