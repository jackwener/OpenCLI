/**
 * One pooled probe run in its own process, as a real CLI invocation would be:
 * the run identity is per process, so concurrent runs must not share one.
 * Usage: node --import tsx/esm slot-probe-run.ts <site> <url> <contextId>
 * Prints the page's location.search as JSON.
 */
import { executeCommand } from '../../../src/execution.js';
import { cli, Strategy } from '../../../src/registry.js';
import type { IPage } from '../../../src/types.js';

const [site, url, contextId] = process.argv.slice(2);
const cmd = cli({
  site,
  name: 'probe',
  access: 'read',
  description: 'slot pool isolation probe',
  browser: true,
  strategy: Strategy.PUBLIC,
  navigateBefore: false,
  func: async (page: IPage) => {
    await page.goto(url);
    return [{ search: await page.evaluate('location.search') }];
  },
});
const rows = await executeCommand(cmd, {}, false, { profile: contextId }) as Array<{ search: string }>;
process.stdout.write(JSON.stringify(rows[0]));
process.exit(0);
