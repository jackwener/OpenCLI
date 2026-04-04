import { describe, expect, it } from 'vitest';
import { buildAddManhourGraphqlBody } from './worklog.js';

describe('buildAddManhourGraphqlBody', () => {
  it('inlines the addManhour arguments so the mutation is syntactically valid', () => {
    const payload = JSON.parse(
      buildAddManhourGraphqlBody({
        ownerId: 'user-1',
        taskId: 'task-1',
        startTime: 1711411200,
        rawManhour: 150000,
        note: 'Backfill',
      }),
    ) as { query: string };

    expect(payload.query).toContain('mutation AddManhour');
    expect(payload.query).toContain('owner: "user-1"');
    expect(payload.query).toContain('task: "task-1"');
    expect(payload.query).toContain('start_time: 1711411200');
    expect(payload.query).toContain('hours: 150000');
    expect(payload.query).not.toContain('$owner');
    expect(payload.query).not.toContain('$task');
  });
});
