/**
 * Regression coverage for plugin commands registered through real discovery
 * and Commander parsing.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseJsonOutput, runCli } from './helpers.js';

const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-plugin-args-e2e-'));
const PLUGIN_NAME = 'options-only';
const PLUGIN_DIR = path.join(TEST_HOME, '.opencli', 'plugins', PLUGIN_NAME);

function runPluginCli(args: string[]) {
  return runCli(args, {
    env: {
      HOME: TEST_HOME,
      USERPROFILE: TEST_HOME,
    },
  });
}

describe('plugin command args E2E', () => {
  beforeAll(() => {
    fs.mkdirSync(PLUGIN_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(PLUGIN_DIR, 'capture.js'),
      `
import { cli } from '@jackwener/opencli/registry';

cli({
  site: '${PLUGIN_NAME}',
  name: 'capture',
  access: 'read',
  browser: false,
  description: 'Capture parsed kwargs',
  args: [
    { name: 'message', required: true, valueRequired: true, help: 'Message text' },
    { name: 'enabled', type: 'boolean', default: false, help: 'Enable mode' },
    { name: 'limit', type: 'number', default: 5, help: 'Limit' },
  ],
  func: async (kwargs) => kwargs,
});
`,
      'utf-8',
    );
  });

  afterAll(() => {
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it('preserves string and valueless boolean options for options-only plugin commands', async () => {
    const result = await runPluginCli([
      PLUGIN_NAME,
      'capture',
      '--message',
      'hello',
      '--enabled',
      '-f',
      'json',
    ]);

    expect(result.code).toBe(0);
    expect(parseJsonOutput(result.stdout)).toMatchObject({
      message: 'hello',
      enabled: true,
      limit: 5,
    });
  });

  it('preserves explicit numeric options and default boolean values for options-only plugin commands', async () => {
    const result = await runPluginCli([
      PLUGIN_NAME,
      'capture',
      '--message',
      'counted',
      '--limit',
      '12',
      '-f',
      'json',
    ]);

    expect(result.code).toBe(0);
    expect(parseJsonOutput(result.stdout)).toMatchObject({
      message: 'counted',
      enabled: false,
      limit: 12,
    });
  });
});
