import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { ensureApplet, ggbEval, requireGgbSuccess } from './utils.js';

cli({
  site: 'geogebra',
  name: 'eval',
  access: 'write',
  description: 'Execute one or more GeoGebra command strings (semicolon-separated)',
  domain: 'www.geogebra.org',
  strategy: Strategy.PUBLIC,
  browser: true,
  navigateBefore: false,
  example: 'opencli geogebra eval "A=(0,0);B=(4,0);c=Circle(A,B);d=Circle(B,A);C=Intersect(c,d,1);Polygon(A,B,C)"',
  args: [
    { name: 'command', positional: true, required: true, help: 'GeoGebra command string (use ; to chain multiple commands)' },
  ],
  columns: ['command', 'result'],
  func: async (page, kwargs) => {
    const commands = String(kwargs.command).split(';').map(s => s.trim()).filter(Boolean);
    if (commands.length === 0) {
      throw new ArgumentError('command must contain at least one GeoGebra command');
    }
    await ensureApplet(page);
    const results = [];
    for (const command of commands) {
      const result = requireGgbSuccess(await ggbEval(page, command), `Failed to execute GeoGebra command: ${command}`);
      results.push({
        command,
        result: `ok (${result.label || 'no label'})`,
      });
    }
    return results;
  },
});
