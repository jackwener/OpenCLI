import { ArgumentError, EmptyResultError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import { NOTEBOOKLM_SUPPORTED_LANGUAGES } from './languages.js';
import { setNotebooklmOutputLanguageViaRpc } from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'language/set',
  aliases: ['language-set'],
  description: 'Set the global NotebookLM output language',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'code',
      positional: true,
      required: true,
      help: 'Language code from notebooklm language-list',
    },
  ],
  columns: ['language', 'name', 'source'],
  func: async (page: IPage, kwargs) => {
    const code = typeof kwargs.code === 'string' ? kwargs.code.trim() : String(kwargs.code ?? '').trim();
    if (!code) {
      throw new ArgumentError('The language code cannot be empty.');
    }
    if (!(code in NOTEBOOKLM_SUPPORTED_LANGUAGES)) {
      throw new ArgumentError(`Unknown language code: ${code}`);
    }

    const row = await setNotebooklmOutputLanguageViaRpc(page, code);
    if (row) return [row];
    throw new EmptyResultError(
      'opencli notebooklm language-set',
      `NotebookLM did not confirm the language update for "${code}".`,
    );
  },
});
