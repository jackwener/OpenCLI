import { cli, Strategy } from '@jackwener/opencli/registry';
import os from 'node:os';
import path from 'node:path';
import { ensureApplet, ggbEval, ggbListObjects, ggbWaitForObjectCount } from './utils.js';

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
    await ensureApplet(page);
    const size = Number(kwargs.size) || 2;
    const results = [];

    const r1 = await ggbEval(page, 'A=(0,0)');
    if (!r1.ok) throw new Error(r1.error || 'Failed to create point A');
    results.push({ step: 'base point A=(0,0)', result: `ok (${r1.label || 'A'})` });

    const r2 = await ggbEval(page, `B=(${size},0)`);
    if (!r2.ok) throw new Error(r2.error || 'Failed to create point B');
    results.push({ step: `base point B=(${size},0)`, result: `ok (${r2.label || 'B'})` });

    const r3 = await ggbEval(page, 'c=Circle(A,B)');
    if (!r3.ok) throw new Error(r3.error || 'Failed to create circle c');
    results.push({ step: 'c=Circle(A,B)', result: `ok (${r3.label || 'c'})` });

    const r4 = await ggbEval(page, 'd=Circle(B,A)');
    if (!r4.ok) throw new Error(r4.error || 'Failed to create circle d');
    results.push({ step: 'd=Circle(B,A)', result: `ok (${r4.label || 'd'})` });

    const r5 = await ggbEval(page, 'C=Intersect(c,d,1)');
    if (!r5.ok) throw new Error(r5.error || 'Failed to create point C');
    results.push({ step: 'C=Intersect(c,d,1)', result: `ok (${r5.label || 'C'})` });

    const r6 = await ggbEval(page, 'Polygon(A,B,C)');
    if (!r6.ok) throw new Error(r6.error || 'Failed to create triangle polygon');
    results.push({ step: 'Polygon(A,B,C)', result: `ok (${r6.label || 'triangle created'})` });

    const objectCount = await ggbWaitForObjectCount(page, 5);
    const objects = await ggbListObjects(page);
    const screenshotPath = path.join(os.tmpdir(), 'opencli-geogebra-triangle.png');
    await page.screenshot({ path: screenshotPath });
    results.push({
      step: `canvas has ${objectCount} objects`,
      result: objects.map((obj) => `${obj.name}(${obj.type})`).join(', '),
    });
    results.push({ step: 'screenshot', result: screenshotPath });

    return results;
  },
});
