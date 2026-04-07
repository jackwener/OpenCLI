import { cli, Strategy } from '../../registry.js';
import { url } from './config.js';

cli({
  site: 'comfyui',
  name: 'queue',
  description: 'Show currently running and pending ComfyUI queue tasks',
  strategy: Strategy.PUBLIC,
  columns: ['status', 'queue_number', 'prompt_id', 'nodes'],
  func: async () => {
    const res = await fetch(url('/api/queue'));
    const data = await res.json();
    const results = [];

    const running = data.queue_running || [];
    for (const q of running) {
      results.push({
        status: 'running',
        queue_number: q[0],
        prompt_id: q[1],
        nodes: typeof q[2] === 'object' ? Object.keys(q[2]).length : '-',
      });
    }

    const pending = data.queue_pending || [];
    for (const q of pending) {
      results.push({
        status: 'pending',
        queue_number: q[0],
        prompt_id: q[1],
        nodes: typeof q[2] === 'object' ? Object.keys(q[2]).length : '-',
      });
    }

    if (results.length === 0) {
      return [{ status: 'empty', queue_number: 0, prompt_id: '-', nodes: 'Queue is empty' }];
    }

    return results.map((item, index) => ({ rank: index + 1, ...item }));
  },
});
