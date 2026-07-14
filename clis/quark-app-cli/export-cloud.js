// cli( registration marker for OpenCLI filesystem discovery
import { makeUiCommand, openQuarkVideo } from './utils.js';

function stripExt(name) {
  return String(name || 'quark-video')
    .replace(/\.[^.]+$/, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trimStart()
    .slice(0, 120) || 'quark-video';
}

function asBool(value) {
  return String(value ?? '').toLowerCase() === 'true';
}

makeUiCommand({
  name: 'export-cloud',
  aliases: ['cloud-export'],
  description: 'Export Quark video AI summary, transcript, and courseware through Quark APIs without opening the video player',
  access: 'write',
  timeoutSeconds: 360,
  args: [
    { name: 'fid', positional: true, required: true, help: 'Video fid' },
    { name: 'pdirFid', required: true, help: 'Destination Quark Drive folder fid' },
    { name: 'title', required: false, default: '', help: 'Video title/base name. Defaults to file info from Quark.' },
    { name: 'summary', required: false, default: 'true', choices: ['true', 'false'], help: 'Export AI summary docx' },
    { name: 'transcript', required: false, default: 'true', choices: ['true', 'false'], help: 'Export transcript docx' },
    { name: 'courseware', required: false, default: 'true', choices: ['true', 'false'], help: 'Export AI courseware doc' },
    { name: 'force', required: false, default: 'false', choices: ['true', 'false'], help: 'Export even when target file already exists' },
    { name: 'waitSeconds', type: 'int', required: false, default: 5, help: 'Max seconds to wait inside one CDP evaluation. Keep under 30 for batch runs.' },
    { name: 'openTabs', required: false, default: 'false', choices: ['true', 'false'], help: 'Open Quark video tabs before exporting. Default false keeps this command API-only.' },
    { name: 'checkExisting', required: false, default: 'true', choices: ['true', 'false'], help: 'Check destination folder for existing files before exporting. Use false when driven by a scanned job list.' },
    { name: 'transcriptTaskId', required: false, default: '', help: 'Existing subtitle task_id to poll/export before submitting a new transcript task.' },
  ],
  columns: ['Artifact', 'Status', 'FileName', 'Fid', 'Detail'],
  func: async (page, kwargs) => {
    const fid = String(kwargs.fid || '').trim();
    const pdirFid = String(kwargs.pdirFid || '').trim();
    if (!/^[a-f0-9]{32}$/i.test(fid)) throw new Error(`Invalid video fid: ${fid}`);
    if (!/^[a-f0-9]{32}$/i.test(pdirFid)) throw new Error(`Invalid pdirFid: ${pdirFid}`);

    const openTabs = asBool(kwargs.openTabs ?? 'false');
    const opened = openTabs ? await openQuarkVideo(page, fid, 'summary') : { Name: kwargs.title || fid };
    const title = stripExt(kwargs.title || opened.Name || fid);
    const wanted = {
      summary: asBool(kwargs.summary),
      transcript: asBool(kwargs.transcript),
      courseware: asBool(kwargs.courseware),
    };
    const waitSeconds = Math.max(0, Math.min(Number(kwargs.waitSeconds ?? 5) || 0, 25));

    if (openTabs && wanted.transcript) await openQuarkVideo(page, fid, 'transcript');
    if (openTabs && wanted.courseware) await openQuarkVideo(page, fid, 'courseware');

    return page.evaluate(`
      (async () => {
        const videoFid = ${JSON.stringify(fid)};
        const pdirFid = ${JSON.stringify(pdirFid)};
        const base = ${JSON.stringify(title)};
        const wanted = ${JSON.stringify(wanted)};
        const force = ${JSON.stringify(asBool(kwargs.force))};
        const checkExisting = ${JSON.stringify(asBool(kwargs.checkExisting ?? 'true'))};
        const transcriptTaskId = ${JSON.stringify(String(kwargs.transcriptTaskId || '').trim())};
        const maxWaitMs = ${JSON.stringify(waitSeconds * 1000)};
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const rows = [];

        let req = null;
        const chunk = window.webpackChunkquark_cloud_drive = window.webpackChunkquark_cloud_drive || [];
        chunk.push([[Date.now() + Math.floor(Math.random() * 100000)], {}, (webpackRequire) => { req = webpackRequire; }]);
        if (!req) throw new Error('webpack-require-not-found');
        const note = req(20058);
        const env = req(506288).default;
        const ai = req(388329);
        const request = (options) => note.noteRequestCatch(options);
        function unwrapQuarkResponse(value, label = 'request') {
          if (Array.isArray(value)) {
            const [err, data] = value;
            if (err) throw new Error(label + '-error: ' + String(typeof err === 'object' ? JSON.stringify(err).slice(0, 300) : err));
            return data;
          }
          return value;
        }
        const requestWithTimeout = async (options, timeoutMs = 8000) => unwrapQuarkResponse(await Promise.race([
          request(options),
          new Promise((_, reject) => setTimeout(() => reject(new Error('request-timeout: ' + String(options?.url || ''))), timeoutMs)),
        ]), String(options?.url || 'request'));
        async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 8000) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const finalUrl = new URL(url);
            for (const [key, value] of Object.entries(options.params || {})) finalUrl.searchParams.set(key, value);
            if (!finalUrl.searchParams.get('req_id')) finalUrl.searchParams.set('req_id', String(Date.now()) + String(Math.floor(Math.random() * 1000000)));
            if (!finalUrl.searchParams.get('pr')) finalUrl.searchParams.set('pr', 'ucpro');
            if (!finalUrl.searchParams.get('fr')) finalUrl.searchParams.set('fr', 'pc');
            const init = {
              method: options.method || 'GET',
              credentials: 'include',
              signal: controller.signal,
              headers: { ...(options.headers || {}) },
            };
            if (options.data !== undefined) {
              init.headers['content-type'] = 'application/json';
              init.body = JSON.stringify(options.data);
            }
            const res = await fetch(finalUrl.href, init);
            const json = await res.json();
            if (!res.ok) throw new Error('fetch-status-' + res.status + ': ' + JSON.stringify(json).slice(0, 200));
            return json;
          } finally {
            clearTimeout(timer);
          }
        }

        async function getAiRecord() {
          const [err, record] = await Promise.race([
            ai.getAiRecordByFid(videoFid),
            new Promise((_, reject) => setTimeout(() => reject(new Error('ai-record-timeout')), 8000)),
          ]);
          if (err) throw new Error('ai-record-error: ' + String(err));
          return record;
        }

        let folderListUnavailable = false;
        let folderListUnavailableReason = '';
        async function listFolder() {
          if (folderListUnavailable) {
            if (checkExisting) throw new Error('folder-list-unavailable: ' + folderListUnavailableReason);
            return [];
          }
          const pageSize = 200;
          const all = [];
          const baseParams = {
            pr: 'ucpro',
            fr: 'pc',
            uc_param_str: '',
            pdir_fid: pdirFid,
            _size: String(pageSize),
            _fetch_total: '1',
            _fetch_sub_dirs: '0',
            _sort: 'file_type:asc,updated_at:desc',
            fetch_all_file: '1',
            fetch_risk_file_name: '1',
          };
          for (let pageNo = 1; pageNo <= 20; pageNo += 1) {
            const params = { ...baseParams, _page: String(pageNo) };
            let json = null;
            try {
              const viaQuark = await requestWithTimeout({
                url: 'https://drive-pc.quark.cn/1/clouddrive/file/sort',
                method: 'GET',
                params,
              });
              if (viaQuark?.status === 200 || viaQuark?.code === 0) json = viaQuark;
            } catch (error) {
              folderListUnavailableReason = String(error?.message || error).slice(0, 300);
            }
            if (!json) {
              try {
                const url = new URL('https://drive-pc.quark.cn/1/clouddrive/file/sort');
                for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
                const res = await fetch(url.href, { credentials: 'include' });
                json = await res.json();
                if (!res.ok || json?.status !== 200) {
                  folderListUnavailableReason = JSON.stringify(json).slice(0, 300);
                  folderListUnavailable = true;
                  if (checkExisting) throw new Error('folder-list-unavailable: ' + folderListUnavailableReason);
                  return all;
                }
              } catch (error) {
                folderListUnavailableReason = String(error?.message || error).slice(0, 300);
                folderListUnavailable = true;
                if (checkExisting) throw new Error('folder-list-unavailable: ' + folderListUnavailableReason);
                return all;
              }
            }
            const list = json?.data?.list || [];
            all.push(...list);
            const total = Number(json?.data?._total || json?.data?.total || 0);
            if (list.length < pageSize) break;
            if (total && all.length >= total) break;
          }
          return all;
        }

        function escapeRegex(value) {
          const specials = '^$.*+?()[]{}|\\\\';
          return String(value)
            .split('')
            .map((char) => specials.includes(char) ? '\\\\' + char : char)
            .join('');
        }

        async function findFile(fileName) {
          const comparableFileName = String(fileName || '').trimStart();
          const match = /^(.*)(\\.(?:docx|doc))$/i.exec(comparableFileName);
          const pattern = match
            ? new RegExp('^' + escapeRegex(match[1]) + '(?:\\\\(\\\\d+\\\\))?' + escapeRegex(match[2]) + '$', 'i')
            : new RegExp('^' + escapeRegex(comparableFileName) + '$', 'i');
          const variants = (await listFolder()).filter((item) => {
            const name = String(item.file_name || item.name || '').trimStart();
            return name === comparableFileName || pattern.test(name);
          });
          return variants.find((item) => String(item.file_name || item.name || '').trimStart() === comparableFileName) || variants[0] || null;
        }

        async function ensureAiTasks() {
          let record = await getAiRecord();
          const needSummary = wanted.summary && record?.data?.manuscript_task?.task_status !== 2;
          const needCourse = wanted.courseware && ![2, 4].includes(record?.data?.course_task?.task_status);
          if (needSummary || needCourse) {
            try {
              await requestWithTimeout({
                url: env.noteUrl + '/ai/video/multi/submit',
                method: 'POST',
                data: { video_fid: videoFid },
              });
            } catch (error) {
              const message = String(error?.message || error);
              if (!message.includes('100207') && !message.includes('请勿重复提交视频')) throw error;
            }
          }
          const started = Date.now();
          while (Date.now() - started < maxWaitMs) {
            record = await getAiRecord();
            const summaryOk = !wanted.summary || record?.data?.manuscript_task?.task_status === 2;
            const courseStatus = record?.data?.course_task?.task_status;
            const courseOk = !wanted.courseware || courseStatus === 2 || courseStatus === 4;
            if (summaryOk && courseOk) return record;
            await sleep(5000);
          }
          return record;
        }

        async function exportSummary(record) {
          const fileName = base + '_AI总结.docx';
          const existing = checkExisting && !force ? await findFile(fileName) : null;
          if (existing) return { Artifact: 'AI总结', Status: 'Exists', FileName: fileName, Fid: existing.fid, Detail: String(existing.size || '') };
          if (record?.data?.manuscript_task?.task_status === 4) {
            return { Artifact: 'AI总结', Status: 'Unsupported', FileName: fileName, Fid: '', Detail: '当前视频不支持生成总结' };
          }
          const content = record?.data?.manuscript_task?.manuscript_desc || '';
          if (!content) return { Artifact: 'AI总结', Status: 'Pending', FileName: fileName, Fid: '', Detail: 'summary task is not ready yet' };
          await requestWithTimeout({
            url: env.noteUrl + '/ai/manuscript/export',
            method: 'POST',
            data: { video_fid: videoFid, type: 1, content, pdir_fid: pdirFid, file_name: fileName },
          });
          return { Artifact: 'AI总结', Status: 'Submitted', FileName: fileName, Fid: '', Detail: 'verify with quark ls' };
        }

        async function exportTranscript() {
          const fileName = base + '_文稿.docx';
          const existing = checkExisting && !force ? await findFile(fileName) : null;
          if (existing) return { Artifact: '文稿', Status: 'Exists', FileName: fileName, Fid: existing.fid, Detail: String(existing.size || '') };
          let submit = null;
          let taskId = /^[a-f0-9]{32}$/i.test(transcriptTaskId) ? transcriptTaskId : '';
          if (!taskId) {
            submit = await fetchJsonWithTimeout(env.noteUrl + '/video/subtitle/submit', {
              url: env.noteUrl + '/video/subtitle/submit',
              method: 'POST',
              data: { fid: videoFid, source_lang: 'cn' },
            });
            taskId = submit?.data?.task_id || submit?.task_id || '';
          }
          if (!taskId) return { Artifact: '文稿', Status: 'Failed', FileName: fileName, Fid: '', Detail: JSON.stringify(submit).slice(0, 300) };
          let result = null;
          const started = Date.now();
          while (true) {
            result = await fetchJsonWithTimeout(env.noteUrl + '/video/subtitle/result', {
              url: env.noteUrl + '/video/subtitle/result',
              method: 'GET',
              params: { task_id: taskId },
            });
            if (result?.data?.status === 2 || result?.status === 2) break;
            if (Date.now() - started >= maxWaitMs) {
              return { Artifact: '文稿', Status: 'Pending', FileName: fileName, Fid: '', Detail: taskId };
            }
            await sleep(Number(result?.data?.tq_gap || submit?.data?.tq_gap || 5000));
          }
          await fetchJsonWithTimeout(env.noteUrl + '/video/subtitle/export', {
            url: env.noteUrl + '/video/subtitle/export',
            method: 'POST',
            data: { fid: videoFid, task_id: taskId, type: 1, content: JSON.stringify(result.data || result), pdir_fid: pdirFid, file_name: fileName },
          });
          return { Artifact: '文稿', Status: 'Submitted', FileName: fileName, Fid: '', Detail: 'verify with quark ls' };
        }

        async function exportCourseware(record) {
          const fileName = base + '_课件.doc';
          const existing = checkExisting && !force ? await findFile(fileName) : null;
          if (existing) return { Artifact: 'AI课件', Status: 'Exists', FileName: fileName, Fid: existing.fid, Detail: String(existing.size || '') };
          const course = record?.data?.course_task || {};
          if (course.task_status === 4) return { Artifact: 'AI课件', Status: 'Unsupported', FileName: fileName, Fid: '', Detail: 'Quark says courseware is unavailable/expired for this video' };
          if (course.task_status !== 2) return { Artifact: 'AI课件', Status: 'Pending', FileName: fileName, Fid: '', Detail: 'courseware task is not ready yet' };
          const taskId = course.submit_tm || course.task_id || course?.task?.task_id || '';
          if (!taskId) return { Artifact: 'AI课件', Status: 'Failed', FileName: fileName, Fid: '', Detail: 'missing courseware task_id' };
          const submit = await requestWithTimeout({
            url: env.noteUrl + '/ai/courseware/export',
            method: 'POST',
            data: { video_fid: videoFid, task_id: taskId, type: 1, content: JSON.stringify(course.task || {}), pdir_fid: pdirFid, file_name: fileName },
          });
          const exportTaskId = submit?.data?.task_id || submit?.task_id || '';
          return { Artifact: 'AI课件', Status: 'Submitted', FileName: fileName, Fid: '', Detail: exportTaskId || JSON.stringify(submit).slice(0, 300) };
        }

        let record = null;
        if (wanted.summary || wanted.courseware) record = await ensureAiTasks();
        if (wanted.summary) rows.push(await exportSummary(record));
        if (wanted.transcript) rows.push(await exportTranscript());
        if (wanted.courseware) {
          record = await getAiRecord();
          rows.push(await exportCourseware(record));
        }
        return rows;
      })()
    `);
  },
});
