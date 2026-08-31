// cli( registration marker for OpenCLI filesystem discovery
import * as fs from 'node:fs';
import { makeUiCommand } from './utils.js';

makeUiCommand({
  name: 'ai-record',
  description: 'Fetch the raw Quark AI video record by video fid',
  args: [
    { name: 'fid', positional: true, required: true, help: 'Video fid' },
    { name: 'output', required: false, default: '', help: 'Optional JSON output path' },
  ],
  columns: ['Status', 'Fid', 'SummaryStatus', 'CoursewareStatus', 'Output'],
  func: async (page, kwargs) => {
    const fid = String(kwargs.fid || '').trim();
    const result = await page.evaluate(`
      (async () => {
        let req = null;
        const chunk = window.webpackChunkquark_cloud_drive = window.webpackChunkquark_cloud_drive || [];
        chunk.push([[Date.now() + Math.floor(Math.random() * 100000)], {}, (webpackRequire) => { req = webpackRequire; }]);
        if (!req) return { ok: false, reason: 'webpack-require-not-found' };
        const ai = req(388329);
        const [err, record] = await ai.getAiRecordByFid(${JSON.stringify(fid)});
        if (err) return { ok: false, reason: String(err) };
        return { ok: true, record };
      })()
    `);
    if (!result?.ok) throw new Error(`Could not fetch AI record: ${result?.reason || 'unknown'}`);
    if (kwargs.output) fs.writeFileSync(String(kwargs.output), JSON.stringify(result.record, null, 2), 'utf8');
    return [{
      Status: 'Fetched',
      Fid: fid,
      SummaryStatus: result.record?.data?.manuscript_task?.task_status ?? '',
      CoursewareStatus: result.record?.data?.course_task?.task_status ?? '',
      Output: kwargs.output || '',
    }];
  },
});
