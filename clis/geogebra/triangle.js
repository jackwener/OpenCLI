import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import os from 'node:os';
import path from 'node:path';
import { ensureApplet, ggbEval, ggbListObjects, ggbWaitForObjectCount, normalizeNumber, requireGgbSuccess } from './utils.js';

cli({
  site: 'geogebra',
  name: 'triangle',
  access: 'write',
  description: 'Draw an equilateral triangle from a horizontal base segment',
  domain: 'www.geogebra.org',
  strategy: Strategy.PUBLIC,
  browser: true,
  navigateBefore: false,
  example: 'opencli geogebra triangle --size 4',
  args: [
    { name: 'size', required: false, default: '2', help: 'Side length of the triangle (default: 2)' },
  ],
  columns: ['step', 'result'],
  func: async (page, kwargs) => {
    const size = normalizeNumber(kwargs.size, 'size', { defaultValue: 2, positive: true });
    await ensureApplet(page);
    const results = [];

    const r1 = requireGgbSuccess(await ggbEval(page, 'A=(0,0)'), 'Failed to create point A');
    results.push({ step: 'base point A=(0,0)', result: `ok (${r1.label || 'A'})` });

    const r2 = requireGgbSuccess(await ggbEval(page, `B=(${size},0)`), 'Failed to create point B');
    results.push({ step: `base point B=(${size},0)`, result: `ok (${r2.label || 'B'})` });

    const r3 = requireGgbSuccess(await ggbEval(page, 'c=Circle(A,B)'), 'Failed to create circle c');
    results.push({ step: 'c=Circle(A,B)', result: `ok (${r3.label || 'c'})` });

    const r4 = requireGgbSuccess(await ggbEval(page, 'd=Circle(B,A)'), 'Failed to create circle d');
    results.push({ step: 'd=Circle(B,A)', result: `ok (${r4.label || 'd'})` });

    const r5 = requireGgbSuccess(await ggbEval(page, 'C=Intersect(c,d,1)'), 'Failed to create point C');
    results.push({ step: 'C=Intersect(c,d,1)', result: `ok (${r5.label || 'C'})` });

    const r6 = requireGgbSuccess(await ggbEval(page, 'Polygon(A,B,C)'), 'Failed to create triangle polygon');
    results.push({ step: 'Polygon(A,B,C)', result: `ok (${r6.label || 'triangle created'})` });

    const objectCount = await ggbWaitForObjectCount(page, 5);
    const objects = await ggbListObjects(page);
    const screenshotPath = path.join(os.tmpdir(), 'opencli-geogebra-triangle.png');
    try {
      await page.screenshot({ path: screenshotPath });
    } catch (err) {
      throw new CommandExecutionError(`Failed to capture GeoGebra screenshot: ${err?.message || err}`);
    }
    results.push({
      step: `canvas has ${objectCount} objects`,
      result: objects.map((obj) => `${obj.name}(${obj.type})`).join(', '),
    });
    results.push({ step: 'screenshot', result: screenshotPath });

    return results;
  },
});
