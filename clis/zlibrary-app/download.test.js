import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getRegistry } from '@jackwener/opencli/registry'
import { ArgumentError } from '@jackwener/opencli/errors'
import fs from 'node:fs'
import path from 'node:path'

import './download.js'

describe('zlibrary-app download', () => {
  let testRoot

  beforeAll(() => {
    testRoot = path.resolve('./test-output')
    fs.mkdirSync(testRoot, { recursive: true })
  })

  afterAll(() => {
    try { fs.rmSync(testRoot, { recursive: true, force: true }) } catch (_) {}
  })

  it('throws ArgumentError when book-url is empty', async () => {
    const command = getRegistry().get('zlibrary-app/download')
    const page = {
      goto: vi.fn(),
      evaluate: vi.fn().mockResolvedValue('https://example.com'),
      cdp: vi.fn().mockResolvedValue({ cookies: [] }),
    }
    await expect(command.func(page, { 'book-url': '' })).rejects.toBeInstanceOf(ArgumentError)
  })

  it('accepts absolute --output paths outside working directory', async () => {
    const command = getRegistry().get('zlibrary-app/download')
    const outputDir = path.join(testRoot, 'absolute-output')
    fs.mkdirSync(outputDir, { recursive: true })

    fs.writeFileSync(
      path.join(outputDir, 'DjEXwd1ZRo_Test__MD5_00000000000000000000000000000000__.epub'),
      'existing',
      'utf-8'
    )

    const page = {
      goto: vi.fn(),
      evaluate: vi.fn().mockResolvedValue('https://example.com'),
      cdp: vi.fn().mockResolvedValue({ cookies: [] }),
    }

    const result = command.func(page, {
      'book-url': '/book/DjEXwd1ZRo/test.html',
      output: outputDir,
    })

    await expect(result).resolves.toMatchObject([
      { Status: 'Already exists', Filename: '(matched by BookID prefix)' }
    ])
  })

  it('skips download when a file with matching BookID prefix already exists', async () => {
    const outputDir = path.join(testRoot, 'bookid-dedup')
    fs.mkdirSync(outputDir, { recursive: true })

    // Create a file matching the BookID prefix pattern: {sanitisedId}_...
    fs.writeFileSync(
      path.join(outputDir, 'DjEXwd1ZRo_Test__MD5_00000000000000000000000000000000__.epub'),
      'existing',
      'utf-8'
    )

    const command = getRegistry().get('zlibrary-app/download')
    const page = {
      goto: vi.fn(),
      evaluate: vi.fn().mockResolvedValue('https://example.com'),
      cdp: vi.fn().mockResolvedValue({ cookies: [] }),
    }

    const result = command.func(page, {
      'book-url': '/book/DjEXwd1ZRo/test.html',
      output: outputDir,
    })

    await expect(result).resolves.toMatchObject([
      { Status: 'Already exists', Filename: '(matched by BookID prefix)' }
    ])

    expect(page.goto).not.toHaveBeenCalled()
    expect(page.evaluate).not.toHaveBeenCalled()
  })

  it('rejects numeric regular IDs in --book-url path', async () => {
    const command = getRegistry().get('zlibrary-app/download')
    const page = {
      goto: vi.fn(),
      evaluate: vi.fn().mockResolvedValue('https://example.com'),
      cdp: vi.fn().mockResolvedValue({ cookies: [] }),
    }
    await expect(command.func(page, { 'book-url': '/book/5433175/test.html' })).rejects.toBeInstanceOf(ArgumentError)
  })
})
