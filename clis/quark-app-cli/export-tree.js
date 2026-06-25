// cli( registration marker for OpenCLI filesystem discovery
import { cli, Strategy } from '@jackwener/opencli/registry';
import { SITE } from './utils.js';
import { argvOption, argvPositional } from './argv-utils.js';
import {
  buildJob,
  projectPaths,
  readJob,
  refreshVideoArtifacts,
  runOpencliJson,
  safeJobName,
  writeCsvReport,
  writeJob,
} from './pipeline-utils.js';

function asBool(value) {
  return String(value ?? '').toLowerCase() === 'true';
}

function option(kwargs, key, flag, fallback) {
  const value = kwargs[key];
  if (value !== undefined && value !== null && value !== '') return value;
  return argvOption(flag, fallback);
}

function arg(kwargs, ...names) {
  for (const name of names) {
    if (kwargs[name] !== undefined && kwargs[name] !== null && kwargs[name] !== '') return kwargs[name];
  }
  return '';
}

function shouldRunArtifact(artifact, enabled, mode) {
  if (!enabled) return false;
  if (mode === 'force') return true;
  return artifact?.status === 'missing';
}

function extractTaskId(value) {
  return String(value || '').match(/[a-f0-9]{32}/i)?.[0] || '';
}

function applyExportRows(video, rows) {
  for (const row of rows || []) {
    const artifact = row.Artifact;
    const status = String(row.Status || '').toLowerCase();
    const detail = row.Detail || '';
    if (artifact === 'AI总结' && status === 'failed') {
      video.artifacts.summary.status = 'failed';
      video.artifacts.summary.detail = detail;
    }
    if (artifact === 'AI总结' && status === 'unsupported') {
      video.artifacts.summary.status = 'unsupported';
      video.artifacts.summary.detail = detail || '当前视频不支持生成总结';
    }
    if (artifact === 'AI总结' && status === 'pending') {
      video.artifacts.summary.status = 'missing';
      video.artifacts.summary.detail = detail || 'summary task is not ready yet';
    }
    if (artifact === 'AI总结' && status === 'submitted') {
      video.artifacts.summary.status = 'submitted';
      video.artifacts.summary.detail = detail;
      video.artifacts.summary.submittedAt = new Date().toISOString();
    }
    if (artifact === '文稿' && status === 'failed') {
      video.artifacts.transcript.status = 'failed';
      video.artifacts.transcript.detail = detail;
    }
    if (artifact === '文稿' && status === 'unsupported') {
      video.artifacts.transcript.status = 'unsupported';
      video.artifacts.transcript.detail = detail || '当前视频不支持生成文稿';
    }
    if (artifact === '文稿' && status === 'pending') {
      video.artifacts.transcript.status = 'missing';
      video.artifacts.transcript.detail = detail || 'transcript task is not ready yet';
    }
    if (artifact === '文稿' && status === 'submitted') {
      video.artifacts.transcript.status = 'submitted';
      video.artifacts.transcript.detail = detail;
      video.artifacts.transcript.submittedAt = new Date().toISOString();
    }
    if (artifact === 'AI课件' && status === 'unsupported') {
      video.artifacts.courseware.status = 'unsupported';
      video.artifacts.courseware.detail = detail;
    }
    if (artifact === 'AI课件' && status === 'failed') {
      video.artifacts.courseware.status = 'failed';
      video.artifacts.courseware.detail = detail;
    }
    if (artifact === 'AI课件' && status === 'pending') {
      video.artifacts.courseware.status = 'missing';
      video.artifacts.courseware.detail = detail || 'courseware task is not ready yet';
    }
    if (artifact === 'AI课件' && status === 'submitted') {
      video.artifacts.courseware.status = 'submitted';
      video.artifacts.courseware.detail = detail;
      video.artifacts.courseware.submittedAt = new Date().toISOString();
    }
  }
}

cli({
  site: SITE,
  name: 'export-tree',
  description: 'Run the project-local Quark AI export pipeline for a folder tree',
  access: 'write',
  strategy: Strategy.LOCAL,
  browser: false,
  timeoutSeconds: 24 * 60 * 60,
  args: [
    { name: 'root', positional: true, required: true, help: 'Quark Drive root folder path to scan/export' },
    { name: 'depth', type: 'int', required: false, default: 5, help: 'Max folder depth to scan when refreshing the job' },
    { name: 'project-dir', required: false, default: process.cwd(), help: 'Project directory. Job files are read/written under ./data/jobs here.' },
    { name: 'job', required: false, default: '', help: 'Optional job file name under ./data/jobs' },
    { name: 'refresh', required: false, default: 'false', choices: ['true', 'false'], help: 'Refresh scan before exporting' },
    { name: 'mode', required: false, default: 'missing', choices: ['missing', 'force'], help: 'missing only exports absent artifacts; force asks Quark to export selected artifacts again' },
    { name: 'summary', required: false, default: 'true', choices: ['true', 'false'], help: 'Include AI summary' },
    { name: 'transcript', required: false, default: 'true', choices: ['true', 'false'], help: 'Include transcript' },
    { name: 'courseware', required: false, default: 'true', choices: ['true', 'false'], help: 'Include courseware' },
    { name: 'limit', type: 'int', required: false, default: 0, help: 'Max videos to process in this run. 0 means no limit.' },
    { name: 'waitSeconds', type: 'int', required: false, default: 12, help: 'Seconds to wait for per-video async AI results before exporting.' },
    { name: 'openTabs', required: false, default: 'false', choices: ['true', 'false'], help: 'Open video AI tabs before exporting. Default false uses API-only export without opening the player.' },
    { name: 'checkExisting', required: false, default: 'false', choices: ['true', 'false'], help: 'Check destination folder inside each export-cloud call. Batch normally relies on the pre-scan.' },
  ],
  columns: ['Status', 'RootPath', 'Processed', 'Done', 'Pending', 'Failed', 'UnsupportedCourseware', 'JobFile', 'ReportFile'],
  func: async (_page, kwargs) => {
    const rootPath = String(arg(kwargs, 'root', 'rootPath', 'rootpath') || argvPositional('export-tree', 0)).trim();
    const projectDir = arg(kwargs, 'project-dir', 'projectDir', 'projectdir') || argvOption('--project-dir', process.cwd());
    const rawDepth = argvOption('--depth', kwargs.depth === undefined || kwargs.depth === null ? 5 : kwargs.depth);
    const depth = Number(rawDepth);
    const jobName = kwargs.job || argvOption('--job', '');
    const paths = projectPaths(projectDir, rootPath, jobName || safeJobName(rootPath));
    let job;
    const refresh = option(kwargs, 'refresh', '--refresh', 'false');
    if (asBool(refresh) || !paths.jobFile || !readable(paths.jobFile)) {
      job = buildJob({
        rootPath,
        depth,
        projectDir: paths.projectDir,
        jobName,
      }).job;
    } else {
      job = readJob(paths.jobFile);
    }
    job.jobFile = paths.jobFile;

    const enabled = {
      summary: asBool(option(kwargs, 'summary', '--summary', 'true')),
      transcript: asBool(option(kwargs, 'transcript', '--transcript', 'true')),
      courseware: asBool(option(kwargs, 'courseware', '--courseware', 'true')),
    };
    const mode = String(option(kwargs, 'mode', '--mode', 'missing'));
    const limit = Number(option(kwargs, 'limit', '--limit', 0));
    const waitSeconds = Math.max(0, Math.min(Number(option(kwargs, 'waitSeconds', '--waitSeconds', 12)) || 0, 25));
    const openTabs = asBool(option(kwargs, 'openTabs', '--openTabs', 'false'));
    const checkExisting = asBool(option(kwargs, 'checkExisting', '--checkExisting', 'false'));
    let processed = 0;

    for (const video of job.videos || []) {
      const runSummary = shouldRunArtifact(video.artifacts.summary, enabled.summary, mode);
      const runTranscript = shouldRunArtifact(video.artifacts.transcript, enabled.transcript, mode);
      const runCourseware = shouldRunArtifact(video.artifacts.courseware, enabled.courseware, mode);
      if (!runSummary && !runTranscript && !runCourseware) {
        continue;
      }
      if (limit > 0 && processed >= limit) break;

      video.status = 'running';
      video.attempts = Number(video.attempts || 0) + 1;
      video.lastError = '';
      writeJob(job, paths.jobFile);

      try {
        const rows = runOpencliJson([
          'quark-app-cli',
          'export-cloud',
          video.videoFid,
          '--pdirFid',
          video.pdirFid,
          '--title',
          video.videoName,
          '--summary',
          String(runSummary),
          '--transcript',
          String(runTranscript),
          '--courseware',
          String(runCourseware),
          '--force',
          String(mode === 'force'),
          '--waitSeconds',
          String(waitSeconds),
          '--openTabs',
          String(openTabs),
          '--checkExisting',
          String(checkExisting),
          '--transcriptTaskId',
          runTranscript ? extractTaskId(video.artifacts.transcript.detail) : '',
          '-f',
          'json',
        ], { cwd: paths.projectDir, timeout: 12 * 60 * 1000 });
        applyExportRows(video, rows);
        refreshVideoArtifacts(video, paths.projectDir);
        processed += 1;
      } catch (error) {
        video.status = 'failed';
        video.lastError = String(error?.message || error).slice(0, 1000);
        processed += 1;
      }
      writeJob(job, paths.jobFile);
    }

    writeJob(job, paths.jobFile);
    const reportFile = writeCsvReport(job, paths.reportsDir);

    return [{
      Status: 'Finished',
      RootPath: job.rootPath,
      Processed: processed,
      Done: job.counts.done,
      Pending: job.counts.pending,
      Failed: job.counts.failed,
      UnsupportedCourseware: job.counts.unsupportedCourseware,
      JobFile: paths.jobFile,
      ReportFile: reportFile,
    }];
  },
});

function readable(file) {
  try {
    return !!file && !file.includes('undefined') && !!readJob(file);
  } catch {
    return false;
  }
}
