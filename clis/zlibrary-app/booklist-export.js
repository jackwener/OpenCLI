/**
 * Z-Library Desktop booklist-export command.
 *
 * Exports all books from a booklist to a JSON file.
 * Uses the shared readBooklistSnapshot() kernel for acquisition.
 *
 * Usage: opencli zlibrary-app booklist-export <name> --file <path>
 */
import { cli, Strategy } from '@jackwener/opencli/registry'
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors'
import { readBooklistSnapshot } from './_shared/booklist/read-snapshot.js'
import { ApiCallRecorder } from './_shared/fixture/index.js'
import { enrichBookRowFromDetailPage } from './_shared/infra/book-detail.js'
import fs from 'node:fs'

const EXPORT_COLUMNS = ['booklist', 'exported', 'file']

export const booklistExportCommand = cli({
  site: 'zlibrary-app',
  name: 'booklist-export',
  access: 'read',
  description: 'Export all books from a Z-Library booklist to a JSON file',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  example: 'opencli zlibrary-app booklist-export mylist --file out.json',
  args: [
    {
      name: 'name',
      positional: true,
      required: true,
      help: 'Booklist name to export'
    },
    {
      name: 'file',
      type: 'string',
      required: true,
      help: 'Output JSON file path (e.g., mylist.json). Refuses to overwrite an existing file'
    },
    {
      name: 'scope',
      type: 'string',
      default: 'my',
      help: 'Booklist scope: public, favorite, my'
    },
    {
      name: 'detail',
      type: 'boolean',
      help: 'Fetch each book\'s detail page for extra metadata (publisher, series, categories, MD5, etc.) — slower'
    },
    {
      name: 'timeout',
      type: 'int',
      default: 300,
      help: 'Command timeout in seconds'
    },
    {
      name: 'fixture',
      type: 'boolean',
      help: 'Save API call fixture to fixture/ directory for offline diagnosis'
    }
  ],
  columns: EXPORT_COLUMNS,
  func: async (page, kwargs) => {
    const name = String(kwargs.name || '').trim()
    if (!name) {
      throw new ArgumentError(
        'booklist-export name cannot be empty',
        'Example: opencli zlibrary-app booklist-export mylist --file out.json'
      )
    }

    const filePath = String(kwargs.file || '').trim()
    if (!filePath) {
      throw new ArgumentError(
        'booklist-export requires --file <path>',
        'Example: opencli zlibrary-app booklist-export mylist --file out.json'
      )
    }

    // Validate scope
    const scope = String(kwargs.scope || 'my').toLowerCase()
    if (!['public', 'favorite', 'my'].includes(scope)) {
      throw new ArgumentError(
        'Invalid scope: ' + scope,
        'Valid scopes: public, favorite, my'
      )
    }

    // Check if output file already exists (no overwrite, no --force)
    if (fs.existsSync(filePath)) {
      throw new ArgumentError(
        'Output file already exists: ' + filePath,
        'Remove or rename the existing file before exporting.'
      )
    }

    const fixture = kwargs.fixture
      ? new ApiCallRecorder({ enabled: true, fixtureDir: 'fixture/' })
      : null

    // Acquire snapshot via shared kernel (scope-aware, 404-tolerant)
    const snapshot = await readBooklistSnapshot(page, { name, scope, fixture })
    const { entry, books, origin: originStr } = snapshot
    // Convert string origin to URL object for detail enrichment compatibility
    const origin = new URL(originStr)

    if (!books || books.length === 0) {
      throw new EmptyResultError(
        'zlibrary-app booklist-export',
        'Booklist "' + name + '" has no books to export.'
      )
    }

    // -- Per-book enrichment with --detail ------------------------------
    if (kwargs.detail) {
      const enriched = []
      for (const book of books) {
        const { metadata, error } = await enrichBookRowFromDetailPage(page, book, {
          origin,
          commandName: 'zlibrary-app booklist-export --detail',
        })
        if (error) {
          book['detail-error'] = error
        } else if (metadata) {
          for (const [key, value] of Object.entries(metadata)) {
            if (value !== '' && value !== null && value !== undefined) {
              book[key] = value
            }
          }
        }
        enriched.push(book)
      }
      // Use enriched books for export
      books.length = 0
      books.push(...enriched)
    }

    // Prepare export data with all metadata fields
    const exportData = {
      booklist: name,
      booklistId: entry.id,
      exportedAt: new Date().toISOString(),
      totalBooks: books.length,
      books: books.map(function (book) {
        return {
          bookId: book.bookId,
          readlistBookId: book.readlistBookId,
          title: book.title,
          author: book.author,
          language: book.language,
          extension: book.extension,
          size: book.size,
          url: book.url,
          formatQualityRating: book.formatQualityRating,
          qualityRating: book.qualityRating,
          publisher: book.publisher,
          isbn: book.isbn,
          md5: book.md5,
          series: book.series,
          categories: book.categories,
          // Additional fields available with --detail
          pages: book.pages,
          isbn10: book.isbn10,
          isbn13: book.isbn13,
          volume: book.volume,
          description: book.description,
          year: book.year,
          languageCode: book.languageCode,
          metaDescription: book.metaDescription,
          filesize: book.filesize,
          rating: book.rating
        }
      })
    }

    fixture?.save('booklist-export', kwargs)

    // Write JSON file
    fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2), 'utf-8')

    return [{
      booklist: name,
      exported: books.length,
      file: filePath
    }]
  }
})
