import { execSync } from 'node:child_process';
import { cli, Strategy } from '../../src/registry.js';
import { CommandExecutionError, ConfigError } from '../../src/errors.js';
import type { IPage } from '../../src/types.js';

export const statusCommand = cli({
  site: 'chatgpt',
  name: 'status',
  description: 'Check if ChatGPT Desktop App is running natively on macOS',
  domain: 'localhost',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [],
  columns: ['Status'],
  func: async (page: IPage | null) => {
    if (process.platform !== 'darwin') {
      throw new ConfigError('ChatGPT Desktop integration requires macOS (osascript is not available on this platform)');
    }

    try {
      const output = execSync("osascript -e 'application \"ChatGPT\" is running'", { encoding: 'utf-8' }).trim();
      return [{ Status: output === 'true' ? 'Running' : 'Stopped' }];
    } catch {
      throw new CommandExecutionError('Error querying ChatGPT application state');
    }
  },
});
