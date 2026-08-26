/**
 * Z-Library Desktop booklist-list command.
 *
 * Lists all booklists for the current user via CDP API injection
 * (GET /papi/booklist/current-user/).
 */
import { cli, Strategy } from '@jackwener/opencli/registry'
import { requireNonEmptyRows } from '../_shared/search-adapter.js'
import { getBooklists, getScopeTabUrl } from './_shared/booklist/api.js'
import { ApiCallRecorder } from './_shared/fixture/index.js'
import { ArgumentError } from '@jackwener/opencli/errors'

export const booklistListCommand = cli({
  site: 'zlibrary-app',
  name: 'booklist-list',
  access: 'read',
  description: 'List Z-Library booklists',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    {
      name: 'scope',
      type: 'string',
      default: 'my',
      help: 'Booklist scope: public, favorite, my'
    },
    {
      name: 'fixture',
      type: 'boolean',
      help: 'Save API call fixture to fixture/ directory for offline diagnosis'
    }
  ],
  columns: ['name', 'id', 'books', 'description', 'createdAt'],
  func: async (page, kwargs) => {
    const scope = String(kwargs.scope || 'my').toLowerCase()
    if (!['public', 'favorite', 'my'].includes(scope)) {
      throw new ArgumentError(
        'Invalid scope: ' + scope,
        'Valid scopes: public, favorite, my'
      )
    }

    const fixture = kwargs.fixture
      ? new ApiCallRecorder({ enabled: true, fixtureDir: 'fixture/' })
      : null

    const lists = await getBooklists(page, scope, { recorder: fixture })

    const rows = lists.map(function (bl) {
      return {
        name: bl.title || '',
        id: bl.id || null,
        books: bl.bookCount || 0,
        description: bl.description || '',
        createdAt: bl.createdAt || ''
      }
})


    fixture?.save('booklist-list', kwargs)

    return requireNonEmptyRows(
      rows,
      'zlibrary-app booklist-list',
      'No booklists found. Create one with `opencli zlibrary-app booklist-create <name>`.'
    )
  }
})
