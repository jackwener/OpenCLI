// cli( registration marker for OpenCLI filesystem discovery
import { makeUiCommand } from './utils.js';

makeUiCommand({
  name: 'api-list-folder',
  description: 'List a Quark folder by fid through the desktop API context',
  access: 'read',
  timeoutSeconds: 60,
  args: [
    { name: 'pdirFid', positional: true, required: true, help: 'Folder fid' },
    { name: 'limit', type: 'int', required: false, default: 20, help: 'Max rows to return' },
  ],
  columns: ['Name', 'Fid', 'Size', 'RawKeys'],
  func: async (page, kwargs) => {
    const pdirFid = String(kwargs.pdirFid || '').trim();
    const limit = Math.max(1, Math.min(Number(kwargs.limit || 20), 200));
    const result = await page.evaluate(`
      (async () => {
        const pdirFid = ${JSON.stringify(pdirFid)};
        let req = null;
        const chunk = window.webpackChunkquark_cloud_drive = window.webpackChunkquark_cloud_drive || [];
        chunk.push([[Date.now() + Math.floor(Math.random() * 100000)], {}, (webpackRequire) => { req = webpackRequire; }]);
        if (!req) return { ok: false, reason: 'webpack-require-not-found' };
        const note = req(20058);
        const raw = await note.noteRequestCatch({
          url: 'https://drive-pc.quark.cn/1/clouddrive/file/sort',
          method: 'GET',
          params: {
            pr: 'ucpro',
            fr: 'pc',
            uc_param_str: '',
            pdir_fid: pdirFid,
            _page: '1',
            _size: '200',
            _fetch_total: '1',
            _fetch_sub_dirs: '0',
            _sort: 'file_type:asc,updated_at:desc',
            fetch_all_file: '1',
            fetch_risk_file_name: '1',
          },
        });
        const value = Array.isArray(raw) ? raw[1] : raw;
        const err = Array.isArray(raw) ? raw[0] : null;
        const lists = [
          value?.data?.list,
          value?.data,
          value?.list,
          value?.metadata?.list,
        ].filter(Array.isArray);
        const list = lists[0] || [];
        return {
          ok: !err,
          reason: err ? JSON.stringify(err).slice(0, 300) : '',
          rawShape: {
            isArray: Array.isArray(raw),
            rawKeys: raw && typeof raw === 'object' ? Object.keys(raw) : [],
            valueKeys: value && typeof value === 'object' ? Object.keys(value) : [],
            dataKeys: value?.data && typeof value.data === 'object' ? Object.keys(value.data) : [],
            metadataKeys: value?.metadata && typeof value.metadata === 'object' ? Object.keys(value.metadata) : [],
          },
          rows: list.slice(0, ${JSON.stringify(limit)}).map((item) => ({
            name: item.file_name || item.name || '',
            fid: item.fid || '',
            size: item.size || '',
            keys: Object.keys(item || {}).slice(0, 20),
          })),
        };
      })()
    `);
    if (!result?.ok) throw new Error(result?.reason || 'api-list-folder failed');
    return (result.rows || []).map((row) => ({
      Name: row.name,
      Fid: row.fid,
      Size: row.size,
      RawKeys: row.keys?.join(',') || JSON.stringify(result.rawShape),
    }));
  },
});
