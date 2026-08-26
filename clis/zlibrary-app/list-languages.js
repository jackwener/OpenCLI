/**
 * Z-Library Desktop list-languages command.
 *
 * Lists all supported language codes and their display names.
 * Pure data command — no browser needed.
 */
import { cli, Strategy } from '@jackwener/opencli/registry'
import { LANGUAGES } from '../zlibrary/dom.js'

export const listLanguagesCommand = cli({
  site: 'zlibrary-app',
  name: 'list-languages',
  access: 'read',
  description: 'List all supported language codes and their display names',
  strategy: Strategy.PUBLIC,
  browser: false,
  columns: ['code', 'name'],
  func: async () => {
    return LANGUAGES.map(function (l) {
      return { code: l.code, name: l.name }
    })
  }
})
