import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { prepareCommandArgs } from './execution.js';
import '../clis/ctrip/search.js';
import '../clis/ctrip/hotel-suggest.js';
import '../clis/ctrip/hotel-search.js';
import '../clis/ctrip/flight.js';
import '../clis/ctrip/flight-round.js';
import '../clis/ctrip/train.js';
import '../clis/ctrip/bus.js';
import '../clis/ctrip/ferry.js';
import '../clis/ctrip/cruise.js';
import '../clis/ctrip/tour.js';
import '../clis/ctrip/package.js';
import '../clis/ctrip/attraction.js';

describe('Ctrip limit CLI argument preparation', () => {
  it('preserves raw CLI limit strings so adapter-level strict parsing can reject coercive forms', () => {
    const requiredArgsByName: Record<string, Record<string, string>> = {
      search: { query: '上海' },
      'hotel-suggest': { query: '汉庭' },
      'hotel-search': { city: '2', checkin: '2026-08-01', checkout: '2026-08-02' },
      flight: { from: 'PEK', to: 'SHA', date: '2026-08-01' },
      'flight-round': { from: 'SHA', to: 'BJS', depart: '2026-08-01', return: '2026-08-08' },
      train: { from: '北京', to: '上海', date: '2026-08-01' },
      bus: { from: '北京', to: '天津', date: '2026-08-01' },
      ferry: { from: '大连', to: '烟台', date: '2026-08-01' },
      cruise: { port: '上海' },
      tour: { destination: '北京' },
      package: { destination: '三亚' },
      attraction: { city: '1' },
    };

    for (const [name, requiredArgs] of Object.entries(requiredArgsByName)) {
      const cmd = getRegistry().get(`ctrip/${name}`);
      expect(cmd, `ctrip/${name} should be registered`).toBeDefined();
      const limitArg = cmd!.args.find((arg) => arg.name === 'limit');
      expect(limitArg?.type).not.toBe('int');
      expect(prepareCommandArgs(cmd!, { ...requiredArgs, limit: '01' }).limit).toBe('01');
    }
  });
});
