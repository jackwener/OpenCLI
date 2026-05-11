import { describe, expect, it } from 'vitest';
import { ObservationManager } from './manager.js';

describe('ObservationManager', () => {
  it('indexes sessions by id and scope', () => {
    const manager = new ObservationManager();
    const work = manager.start({ id: 'work-1', scope: { contextId: 'work', session: 'site:x', target: 'tab-1' } });
    manager.start({ id: 'personal-1', scope: { contextId: 'personal', session: 'site:x', target: 'tab-2' } });

    expect(manager.get('work-1')).toBe(work);
    expect(manager.findByScope({ contextId: 'work', session: 'site:x' }).map((session) => session.id)).toEqual(['work-1']);
    expect(manager.stop('work-1')).toBe(work);
    expect(manager.get('work-1')).toBeUndefined();
  });
});
