/**
 * Z-Library Desktop booklist-import command.
 *
 * Imports books from a JSON file into an EXISTING booklist.
 * User must create the booklist first with `booklist-create`.
 *
 * Usage: opencli zlibrary-app booklist-import <name> --file <path>
 */
import { cli, Strategy } from '@jackwener/opencli/registry'
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors'
import { resolveBooklistByNameOrThrow, getBookIdList } from './_shared/booklist/api.js'
import { ApiCallRecorder } from './_shared/fixture/index.js'
import { addBooksToBooklist, toExistingBookIdSet } from './_shared/infra/booklist-mutation.js'
import fs from 'node:fs'

const IMPORT_COLUMNS = ['booklist', 'added', 'skipped', 'total', 'file']

export const booklistImportCommand = cli({
  site: 'zlibrary-app',
  name: 'booklist-import',
  access: 'write',
  description: 'Import books from a JSON file into an existing Z-Library booklist',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  example: 'opencli zlibrary-app booklist-import mylist --file out.json',
  args: [
    {
      name: 'name',
      positional: true,
      required: true,
      help: 'Existing booklist name to import into (create with booklist-create first)'
    },
    {
      name: 'file',
      type: 'string',
      required: true,
      help: 'Input JSON file path, as written by booklist-export'
    },
    {
      name: 'fixture',
      type: 'boolean',
      help: 'Save API call fixture to fixture/ directory for offline diagnosis'
    }
  ],
  columns: IMPORT_COLUMNS,
  func: async (page, kwargs) => {
    const name = String(kwargs.name || '').trim()
    if (!name) {
      throw new ArgumentError(
        'booklist-import name cannot be empty',
        'Example: opencli zlibrary-app booklist-import mylist --file out.json'
      )
    }

    const filePath = String(kwargs.file || '').trim()
    if (!filePath) {
      throw new ArgumentError(
        'booklist-import requires --file <path>',
        'Example: opencli zlibrary-app booklist-import mylist --file out.json'
      )
    }

    // Check if input file exists
    if (!fs.existsSync(filePath)) {
      throw new ArgumentError(
        'Input file not found: ' + filePath,
        'Export a booklist first with booklist-export <name> --file <path>'
      )
    }

    // Read and parse JSON file
    let importData
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      importData = JSON.parse(content)
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new ArgumentError(
          'Invalid JSON in file: ' + filePath,
          'File must be valid JSON as written by booklist-export. Error: ' + err.message
        )
      }
      throw new CommandExecutionError(
        'Failed to read file: ' + filePath,
        err.message
      )
    }

    // Validate import data structure
    if (!importData || !Array.isArray(importData.books)) {
      throw new ArgumentError(
        'Invalid export file format: expected a top-level "books" array',
        'Expected JSON as written by booklist-export. Got keys: ' + JSON.stringify(Object.keys(importData || {})).slice(0, 200)
      )
    }

    // Extract book IDs from the import data
    const booksToAdd = importData.books
      .filter(function (book) { return book && book.bookId != null })
      .map(function (book) {
        return { id: String(book.bookId) }
      })

    if (booksToAdd.length === 0) {
      throw new EmptyResultError(
        'zlibrary-app booklist-import',
        'No valid book IDs found in ' + filePath
      )
    }

    const fixture = kwargs.fixture
      ? new ApiCallRecorder({ enabled: true, fixtureDir: 'fixture/' })
      : null

    // Resolve booklist name to ID (throws CommandExecutionError if not found)
    const match = await resolveBooklistByNameOrThrow(page, name, undefined, { recorder: fixture })
    const booklistId = match.id

    // Get existing book IDs in the target booklist for dedup
    const existingMappings = await getBookIdList(page, booklistId, { recorder: fixture })
    const existingBookIds = toExistingBookIdSet(existingMappings)

    // Add books using shared mutation module with dedup
    const mutationResult = await addBooksToBooklist(page, booklistId, booksToAdd, {
      existingBookIds,
      dedupe: true,
      collectRows: false,
      recorder: fixture,
    })

    const { added, skipped, total } = mutationResult

    fixture?.save('booklist-import', kwargs)

    return [{
      booklist: name,
      added,
      skipped,
      total,
      file: filePath
    }]
  }
})
