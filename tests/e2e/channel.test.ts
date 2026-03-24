import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { runCli } from './helpers.js'

describe('channel e2e', () => {
  const LOCK_PATH = path.join(os.homedir(), '.opencli', 'channel.lock')

  afterEach(() => {
    // Cleanup lock if test left it
    try { fs.unlinkSync(LOCK_PATH) } catch { /* ignore */ }
  })

  it('channel status shows not running when no server', async () => {
    // Ensure no lock file
    try { fs.unlinkSync(LOCK_PATH) } catch { /* ignore */ }

    const { stdout, code } = await runCli(['channel', 'status'])
    expect(code).toBe(0)
    expect(stdout).toContain('not running')
  }, 15_000)
})
