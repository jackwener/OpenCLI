/**
 * Booklist command registration tests for Z-Library Desktop app.
 *
 * Individual command behavior tests have been extracted to per-command files:
 *   booklist-create.test.js, booklist-add.test.js, booklist-list.test.js,
 *   booklist-show.test.js, booklist-delete.test.js, booklist-manage.test.js,
 *   booklist-download.test.js
 */
import { describe, expect, it } from 'vitest'
import { getRegistry } from '@jackwener/opencli/registry'

import './booklist-create.js'
import './booklist-add.js'
import './booklist-list.js'
import './booklist-show.js'
import './booklist-delete.js'
import './booklist-manage.js'
import './booklist-download.js'

describe('zlibrary-app booklist command registration', () => {
  for (const cmd of ['booklist-create', 'booklist-add', 'booklist-list', 'booklist-show', 'booklist-delete', 'booklist-manage', 'booklist-download']) {
    it(`registers ${cmd}`, () => {
      expect(getRegistry().get(`zlibrary-app/${cmd}`)).toBeDefined()
    })
  }
})
