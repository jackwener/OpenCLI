import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

export const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.m4v', '.webm', '.flv', '.wmv']);

export function nowIso() {
  return new Date().toISOString();
}

export function normalizeDrivePath(input) {
  return String(input || '').replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
}

export function stripVideoExt(name) {
  return String(name || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trimStart();
}

export function isVideoName(name) {
  return VIDEO_EXTENSIONS.has(path.extname(String(name || '')).toLowerCase());
}

export function parentDrivePath(itemPath) {
  const normalized = normalizeDrivePath(itemPath);
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(0, index) : '';
}

export function safeJobName(rootPath) {
  const name = normalizeDrivePath(rootPath) || 'root';
  return `quark-ai-${name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_')}.json`;
}

export function projectPaths(projectDir, rootPath, jobName = '') {
  const root = path.resolve(projectDir || process.cwd());
  const dataDir = path.join(root, 'data');
  const jobsDir = path.join(dataDir, 'jobs');
  const scansDir = path.join(dataDir, 'scans');
  const reportsDir = path.join(dataDir, 'reports');
  const fileName = jobName || safeJobName(rootPath);
  return {
    projectDir: root,
    dataDir,
    jobsDir,
    scansDir,
    reportsDir,
    jobFile: path.join(jobsDir, fileName),
  };
}

export function ensureDataDirs(paths) {
  fs.mkdirSync(paths.jobsDir, { recursive: true });
  fs.mkdirSync(paths.scansDir, { recursive: true });
  fs.mkdirSync(paths.reportsDir, { recursive: true });
}

export function runOpencli(args, options = {}) {
  return execFileSync('opencli', args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    maxBuffer: options.maxBuffer || 128 * 1024 * 1024,
    timeout: options.timeout || 10 * 60 * 1000,
    env: { ...process.env, ...(options.env || {}) },
  });
}

export function runOpencliJson(args, options = {}) {
  const output = runOpencli(args, options).trim();
  if (!output) return null;
  return JSON.parse(output);
}

export function listDrive(pathArg, depth, cwd) {
  return runOpencliJson(['quark', 'ls', pathArg || '', '--depth', String(depth), '-f', 'json'], { cwd });
}

export function findChild(parentPath, childName, cwd) {
  const rows = listDrive(parentPath, 0, cwd) || [];
  return rows.find((item) => item.name === childName) || null;
}

export function resolveDriveFolderFid(folderPath, cwd) {
  const normalized = normalizeDrivePath(folderPath);
  if (!normalized) return '0';
  const parts = normalized.split('/').filter(Boolean);
  let current = '';
  let fid = '0';
  for (const part of parts) {
    const child = findChild(current, part, cwd);
    if (!child?.is_dir || !child?.fid) {
      throw new Error(`Could not resolve Quark folder "${part}" under "${current || '/'}"`);
    }
    fid = child.fid;
    current = current ? `${current}/${part}` : part;
  }
  return fid;
}

export function artifactNames(videoName) {
  const base = stripVideoExt(videoName);
  return {
    summary: `${base}_AI总结.docx`,
    transcript: `${base}_文稿.docx`,
    courseware: `${base}_课件.doc`,
  };
}

function isArtifactResolved(artifact) {
  return ['exists', 'unsupported'].includes(artifact?.status);
}

function makeArtifactStatus(fileName, siblings) {
  const comparableFileName = fileName.trimStart();
  const match = /^(.*)(\.(?:docx|doc))$/i.exec(comparableFileName);
  const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = match
    ? new RegExp(`^${escapeRegex(match[1])}(?:\\(\\d+\\))?${escapeRegex(match[2])}$`, 'i')
    : new RegExp(`^${escapeRegex(comparableFileName)}$`, 'i');
  const variants = siblings.filter((item) => item.name === fileName || pattern.test(String(item.name || '').trimStart()));
  const found = variants.find((item) => item.name === fileName || String(item.name || '').trimStart() === comparableFileName) || variants[0];
  return {
    fileName,
    status: found ? 'exists' : 'missing',
    fid: found?.fid || '',
    size: found?.size || '',
    variants: variants.map((item) => ({ name: item.name, fid: item.fid, size: item.size })),
    updatedAt: nowIso(),
  };
}

export function buildJob({ rootPath, depth, projectDir, jobName = '' }) {
  const cwd = path.resolve(projectDir || process.cwd());
  const normalizedRoot = normalizeDrivePath(rootPath);
  const paths = projectPaths(cwd, normalizedRoot, jobName);
  let previousJob = null;
  if (fs.existsSync(paths.jobFile)) {
    try { previousJob = readJob(paths.jobFile); } catch {}
  }
  const previousByFid = new Map((previousJob?.videos || []).map((video) => [video.videoFid, video]));
  const rootFid = resolveDriveFolderFid(normalizedRoot, cwd);
  const items = listDrive(normalizedRoot, depth, cwd) || [];

  const folderMap = new Map([[normalizedRoot, rootFid]]);
  for (const item of items) {
    if (item.is_dir && item.path && item.fid) folderMap.set(normalizeDrivePath(item.path), item.fid);
  }

  const byFolder = new Map();
  for (const item of items) {
    const folder = parentDrivePath(item.path || item.name);
    if (!byFolder.has(folder)) byFolder.set(folder, []);
    byFolder.get(folder).push(item);
  }

  const videos = [];
  for (const item of items) {
    if (item.is_dir || !isVideoName(item.name)) continue;
    const folderPath = parentDrivePath(item.path || item.name);
    const pdirFid = folderMap.get(folderPath) || (folderPath === normalizedRoot ? rootFid : '');
    const siblings = byFolder.get(folderPath) || [];
    const names = artifactNames(item.name);
    const artifacts = {
      summary: makeArtifactStatus(names.summary, siblings),
      transcript: makeArtifactStatus(names.transcript, siblings),
      courseware: makeArtifactStatus(names.courseware, siblings),
    };
    const previous = previousByFid.get(item.fid);
    for (const key of ['summary', 'transcript', 'courseware']) {
      const prev = previous?.artifacts?.[key];
      if (artifacts[key].status === 'missing' && ['submitted', 'failed', 'unsupported'].includes(prev?.status)) {
        artifacts[key].status = prev.status;
        artifacts[key].detail = prev.detail || '';
        artifacts[key].submittedAt = prev.submittedAt || prev.updatedAt || '';
      }
    }
    const complete = isArtifactResolved(artifacts.summary)
      && isArtifactResolved(artifacts.transcript)
      && isArtifactResolved(artifacts.courseware);
    const submitted = Object.values(artifacts).some((artifact) => artifact.status === 'submitted');
    videos.push({
      folderPath,
      pdirFid,
      videoName: item.name,
      videoFid: item.fid,
      videoPath: item.path,
      videoSize: item.size || '',
      artifacts,
      status: complete ? 'done' : (submitted ? 'submitted' : 'pending'),
      attempts: previous?.attempts || 0,
      lastError: previous?.lastError || '',
      updatedAt: nowIso(),
    });
  }

  ensureDataDirs(paths);
  const job = {
    schemaVersion: 1,
    kind: 'quark-ai-export-job',
    rootPath: normalizedRoot,
    rootFid,
    depth: Number(depth),
    projectDir: cwd,
    jobFile: paths.jobFile,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    counts: summarizeVideos(videos),
    videos,
  };
  writeJob(job, paths.jobFile);

  const scanFile = path.join(paths.scansDir, `${path.basename(paths.jobFile, '.json')}.scan.json`);
  fs.writeFileSync(scanFile, JSON.stringify({ savedAt: nowIso(), rootPath: normalizedRoot, depth: Number(depth), items }, null, 2), 'utf8');
  return { job, jobFile: paths.jobFile, scanFile };
}

export function summarizeVideos(videos) {
  const counts = {
    videos: videos.length,
    done: 0,
    pending: 0,
    failed: 0,
    unsupportedSummary: 0,
    unsupportedTranscript: 0,
    unsupportedCourseware: 0,
    missingSummary: 0,
    missingTranscript: 0,
    missingCourseware: 0,
  };
  for (const video of videos) {
    counts[video.status] = (counts[video.status] || 0) + 1;
    if (video.artifacts?.summary?.status === 'missing') counts.missingSummary += 1;
    if (video.artifacts?.transcript?.status === 'missing') counts.missingTranscript += 1;
    if (video.artifacts?.courseware?.status === 'missing') counts.missingCourseware += 1;
    if (video.artifacts?.summary?.status === 'unsupported') counts.unsupportedSummary += 1;
    if (video.artifacts?.transcript?.status === 'unsupported') counts.unsupportedTranscript += 1;
    if (video.artifacts?.courseware?.status === 'unsupported') counts.unsupportedCourseware += 1;
  }
  return counts;
}

export function readJob(jobFile) {
  return JSON.parse(fs.readFileSync(jobFile, 'utf8'));
}

export function writeJob(job, jobFile = job.jobFile) {
  job.updatedAt = nowIso();
  job.counts = summarizeVideos(job.videos || []);
  fs.mkdirSync(path.dirname(jobFile), { recursive: true });
  fs.writeFileSync(jobFile, JSON.stringify(job, null, 2), 'utf8');
}

export function refreshVideoArtifacts(video, cwd) {
  const rows = listDrive(video.folderPath, 0, cwd) || [];
  const names = artifactNames(video.videoName);
  const previous = {
    summary: video.artifacts.summary,
    transcript: video.artifacts.transcript,
    courseware: video.artifacts.courseware,
  };
  video.artifacts.summary = makeArtifactStatus(names.summary, rows);
  video.artifacts.transcript = makeArtifactStatus(names.transcript, rows);
  video.artifacts.courseware = makeArtifactStatus(names.courseware, rows);

  for (const key of ['summary', 'transcript', 'courseware']) {
    const current = video.artifacts[key];
    const prior = previous[key];
    if (current.status !== 'missing') continue;
    if (prior?.status === 'missing' && prior.detail) {
      current.detail = prior.detail;
      current.updatedAt = prior.updatedAt || '';
    }
    if (!['submitted', 'failed', 'unsupported'].includes(prior?.status)) continue;
    current.status = prior.status;
    current.detail = prior.detail || '';
    if (prior.status === 'submitted') {
      current.submittedAt = prior.submittedAt || prior.updatedAt || '';
    }
  }
  const allDone = isArtifactResolved(video.artifacts.summary)
    && isArtifactResolved(video.artifacts.transcript)
    && isArtifactResolved(video.artifacts.courseware);
  const submitted = Object.values(video.artifacts).some((artifact) => artifact.status === 'submitted');
  video.status = allDone ? 'done' : (submitted ? 'submitted' : (video.lastError ? 'failed' : 'pending'));
  video.updatedAt = nowIso();
  return video;
}

export function writeCsvReport(job, reportsDir) {
  fs.mkdirSync(reportsDir, { recursive: true });
  const file = path.join(reportsDir, `${path.basename(job.jobFile, '.json')}.csv`);
  const header = ['folderPath', 'videoName', 'videoFid', 'summary', 'transcript', 'courseware', 'status', 'lastError', 'updatedAt'];
  const lines = [header.join(',')];
  for (const video of job.videos || []) {
    const values = [
      video.folderPath,
      video.videoName,
      video.videoFid,
      video.artifacts?.summary?.status || '',
      video.artifacts?.transcript?.status || '',
      video.artifacts?.courseware?.status || '',
      video.status || '',
      video.lastError || '',
      video.updatedAt || '',
    ].map((value) => `"${String(value).replace(/"/g, '""')}"`);
    lines.push(values.join(','));
  }
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
  return file;
}
