import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildSakyFooter, querySakyDataset, SAKY_DATASETS, SAKY_DOMAIN, SAKY_SITE } from './common.js';

cli({
  site: SAKY_SITE,
  name: 'tool',
  description: 'Query tool product label data from SAKY warehouse API',
  domain: SAKY_DOMAIN,
  strategy: Strategy.PUBLIC,
  browser: false,
  timeoutSeconds: 30,
  args: [
    { name: 'page-num', type: 'int', default: 1, help: 'Page number' },
    { name: 'page-size', type: 'int', default: 10, help: 'Rows per page' },
    { name: 'pt', help: 'Partition date in YYYYMMDD; defaults to yesterday in Asia/Shanghai' },
    { name: 'return-total-num', type: 'bool', default: true, help: 'Return total count metadata' },
    { name: 'app-code', help: 'APPCODE for the API gateway; or set SAKY_APPCODE' },
    { name: 'base-url', help: 'Override API base URL; defaults to SAKY_BASE_URL or built-in base URL' },
  ],
  columns: SAKY_DATASETS.tool.columns,
  footerExtra: buildSakyFooter,
  func: async (_page, kwargs) => querySakyDataset('tool', kwargs),
});
