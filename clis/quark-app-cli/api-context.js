// cli( registration marker for OpenCLI filesystem discovery
import { makeUiCommand } from './utils.js';

makeUiCommand({
  name: 'api-context',
  description: 'Check Quark API context without opening the video player',
  access: 'read',
  timeoutSeconds: 30,
  args: [
    { name: 'fid', positional: true, required: false, default: '', help: 'Optional video fid to test AI record access' },
  ],
  columns: ['Status', 'NoteUrl', 'HasRequest', 'HasAiRecord', 'AiRecordStatus', 'Detail'],
  func: async (page, kwargs) => {
    const fid = String(kwargs.fid || '').trim();
    const result = await page.evaluate(`
      (async () => {
        let req = null;
        const chunk = window.webpackChunkquark_cloud_drive = window.webpackChunkquark_cloud_drive || [];
        chunk.push([[Date.now() + Math.floor(Math.random() * 100000)], {}, (webpackRequire) => { req = webpackRequire; }]);
        if (!req) return { ok: false, reason: 'webpack-require-not-found' };
        let note = null;
        let env = null;
        let ai = null;
        try { note = req(20058); } catch (error) { return { ok: false, reason: 'note-module-not-found: ' + String(error?.message || error) }; }
        try { env = req(506288).default; } catch (error) { return { ok: false, reason: 'env-module-not-found: ' + String(error?.message || error) }; }
        try { ai = req(388329); } catch (error) { return { ok: false, reason: 'ai-module-not-found: ' + String(error?.message || error) }; }
        const out = {
          ok: true,
          noteUrl: env?.noteUrl || '',
          hasRequest: typeof note?.noteRequestCatch === 'function',
          hasAiRecord: typeof ai?.getAiRecordByFid === 'function',
          aiRecordStatus: '',
          detail: '',
        };
        const fid = ${JSON.stringify(fid)};
        if (/^[a-f0-9]{32}$/i.test(fid) && out.hasAiRecord) {
          try {
            const [err, record] = await Promise.race([
              ai.getAiRecordByFid(fid),
              new Promise((_, reject) => setTimeout(() => reject(new Error('ai-record-timeout')), 8000)),
            ]);
            if (err) {
              out.aiRecordStatus = 'error';
              out.detail = String(err).slice(0, 200);
            } else {
              out.aiRecordStatus = 'ok';
              out.detail = JSON.stringify({
                summary: record?.data?.manuscript_task?.task_status ?? '',
                courseware: record?.data?.course_task?.task_status ?? '',
              });
            }
          } catch (error) {
            out.aiRecordStatus = 'error';
            out.detail = String(error?.message || error).slice(0, 200);
          }
        }
        return out;
      })()
    `);
    return [{
      Status: result?.ok ? 'Ready' : 'Unavailable',
      NoteUrl: result?.noteUrl || '',
      HasRequest: result?.hasRequest ? 'true' : 'false',
      HasAiRecord: result?.hasAiRecord ? 'true' : 'false',
      AiRecordStatus: result?.aiRecordStatus || '',
      Detail: result?.detail || result?.reason || '',
    }];
  },
});
