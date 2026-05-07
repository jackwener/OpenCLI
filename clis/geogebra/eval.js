import { cli, Strategy } from '@jackwener/opencli/registry';
import { ensureApplet, ggbEval } from './utils.js';

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
    await ensureApplet(page);
    const commands = String(kwargs.command).split(';').map(s => s.trim()).filter(Boolean);
    const results = [];
    for (const command of commands) {
      const result = await ggbEval(page, command);
      results.push({
        command,
        result: result.ok
          ? `ok (${result.label || 'no label'})`
          : `failed${result.error ? ` (${result.error})` : ''}`,
      });
    }
    return results;
  },
});
