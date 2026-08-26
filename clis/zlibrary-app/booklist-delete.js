/**
 * Z-Library Desktop booklist-delete command.
 *
 * Deletes a booklist via CDP API injection (GET /papi/booklist/{id}/delete).
 * Requires --force to confirm.
 */
import { cli, Strategy } from '@jackwener/opencli/registry'
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors'
import { resolveBooklistByNameOrThrow, deleteBooklist } from './_shared/booklist/api.js'
import { ApiCallRecorder } from './_shared/fixture/index.js'

export const booklistDeleteCommand = cli({
  site: 'zlibrary-app',
  name: 'booklist-delete',
  access: 'write',
  description: 'Delete a Z-Library booklist (requires --force)',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    {
      name: 'name',
      positional: true,
      required: true,
      help: 'Booklist name to delete'
    },
    {
      name: 'force',
      type: 'boolean',
      help: 'Skip confirmation and delete immediately'
    },
    {
      name: 'scope',
      type: 'string',
      default: 'my',
      choices: ['public', 'favorite', 'my'],
      help: 'Booklist scope (only my is valid for write operations)'
    },
    {
      name: 'fixture',
      type: 'boolean',
      help: 'Save API call fixture to fixture/ directory for offline diagnosis'
    }
  ],
  columns: ['name', 'id', 'deleted', 'reason'],
  func: async (page, kwargs) => {
    const name = String(kwargs.name || '').trim()
    if (!name) {
      throw new ArgumentError(
        'booklist-delete name cannot be empty',
        'Example: opencli zlibrary-app booklist-delete mylist --force'
      )
    }

    // Require --force for confirmation
    if (!kwargs.force) {
      return [{
        name,
        id: null,
        deleted: false,
        reason: 'Use --force to confirm deletion'
      }]
    }

    const fixture = kwargs.fixture
      ? new ApiCallRecorder({ enabled: true, fixtureDir: 'fixture/' })
      : null

    // Resolve booklist name to ID (throws CommandExecutionError if not found)
    const match = await resolveBooklistByNameOrThrow(page, name, undefined, { recorder: fixture })

    // Delete
    const result = await deleteBooklist(page, match.id, { recorder: fixture })

    // Distinguish real API/transport errors from idempotent no-op responses.
    // - result.error set: transport/API failure (HTTP error, network error) → throw
    // - result.success === false (no error field): app-level rejection, often
    //   "already deleted" which is an idempotent no-op
    // - !result: unexpected null/undefined → throw
    if (!result || result.error) {
      throw new CommandExecutionError(
        'Failed to delete booklist "' + name + '"' +
          (result && result.error ? ': ' + result.error : ''),
        'The booklist may have been already deleted or the API may be unavailable.'
      )
    }

    fixture?.save('booklist-delete', kwargs)

    // Idempotent no-op: API returned { success: false } without error field
    // (e.g. "already deleted"). Return graceful result instead of throwing.
    if (result.success === false) {
      return [{
        name,
        id: match.id,
        deleted: false,
        reason: 'already_deleted'
      }]
    }

    return [{
      name,
      id: match.id,
      deleted: true,
      reason: ''
    }]
  }
})
