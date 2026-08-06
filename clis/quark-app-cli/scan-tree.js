// cli( registration marker for OpenCLI filesystem discovery
import { cli, Strategy } from '@jackwener/opencli/registry';
import { SITE } from './utils.js';
import { buildJob, projectPaths } from './pipeline-utils.js';
import { argvOption, argvPositional } from './argv-utils.js';

function arg(kwargs, ...names) {
  for (const name of names) {
    if (kwargs[name] !== undefined && kwargs[name] !== null && kwargs[name] !== '') return kwargs[name];
  }
  return '';
}

cli({
  site: SITE,
  name: 'scan-tree',
  description: 'Scan a Quark Drive folder tree and write a project-local AI export job list',
  access: 'read',
  strategy: Strategy.LOCAL,
  browser: false,
  args: [
    { name: 'root', positional: true, required: true, help: 'Quark Drive root folder path to scan' },
    { name: 'depth', type: 'int', required: false, default: 5, help: 'Max folder depth to scan' },
    { name: 'project-dir', required: false, default: process.cwd(), help: 'Project directory. Job files are written under ./data/jobs here.' },
    { name: 'job', required: false, default: '', help: 'Optional job file name under ./data/jobs' },
  ],
  columns: ['Status', 'RootPath', 'Videos', 'Done', 'Pending', 'MissingSummary', 'MissingTranscript', 'MissingCourseware', 'JobFile'],
  func: async (_page, kwargs) => {
    const root = arg(kwargs, 'root', 'rootPath', 'rootpath') || argvPositional('scan-tree', 0);
    const projectDir = arg(kwargs, 'project-dir', 'projectDir', 'projectdir') || argvOption('--project-dir', process.cwd());
    const rawDepth = argvOption('--depth', kwargs.depth === undefined || kwargs.depth === null ? 5 : kwargs.depth);
    const depth = Number(rawDepth);
    const jobName = kwargs.job || argvOption('--job', '');
    const paths = projectPaths(projectDir, root, jobName);
    const { job, jobFile } = buildJob({
      rootPath: root,
      depth,
      projectDir: paths.projectDir,
      jobName,
    });
    return [{
      Status: 'Scanned',
      RootPath: job.rootPath,
      Videos: job.counts.videos,
      Done: job.counts.done,
      Pending: job.counts.pending,
      MissingSummary: job.counts.missingSummary,
      MissingTranscript: job.counts.missingTranscript,
      MissingCourseware: job.counts.missingCourseware,
      JobFile: jobFile,
    }];
  },
});
