import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  SAKY_DEFAULT_BASE_URL,
  SAKY_DOC_SAMPLE_PT,
  SAKY_DOC_TITLE,
  SAKY_SITE,
  sakyDocsRows,
} from './common.js';

cli({
  site: SAKY_SITE,
  name: 'docs',
  description: 'Show SAKY product label API summary and command mapping',
  strategy: Strategy.PUBLIC,
  browser: false,
  defaultFormat: 'table',
  args: [],
  columns: ['command', 'endpoint', 'description', 'sample_pt', 'key_fields'],
  footerExtra: () => `${SAKY_DOC_TITLE} · base=${SAKY_DEFAULT_BASE_URL} · auth=APPCODE · sample_pt=${SAKY_DOC_SAMPLE_PT}`,
  func: async () => sakyDocsRows(),
});
