import { cli } from '../../registry.js';
import { NOTEBOOKLM_SITE } from './shared.js';
import { listNotebooklmSupportedLanguages } from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'language/list',
  aliases: ['language-list'],
  description: 'List supported NotebookLM output language codes',
  args: [],
  columns: ['code', 'name', 'source'],
  func: async () => listNotebooklmSupportedLanguages(),
});
