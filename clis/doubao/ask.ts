import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';
import { DOUBAO_DOMAIN, getDoubaoTranscriptLines, getDoubaoVisibleTurns, sendDoubaoMessage, waitForDoubaoResponse } from './utils.js';

export const askCommand = cli({
  site: 'doubao',
  name: 'ask',
  description: 'Send a prompt and wait for the Doubao response',
  domain: DOUBAO_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  timeoutSeconds: 180,
  args: [
    { name: 'text', required: true, positional: true, help: 'Prompt to send' },
    { name: 'timeout', required: false, help: 'Max seconds to wait (default: 60)', default: '60' },
  ],
  columns: ['Role', 'Text'],
  func: async (page: IPage, kwargs: any) => {
    const text = kwargs.text as string;
    const timeout = parseInt(kwargs.timeout as string, 10) || 60;
    const beforeTurns = await getDoubaoVisibleTurns(page);
    const beforeLines = await getDoubaoTranscriptLines(page);

    await sendDoubaoMessage(page, text);
    const response = await waitForDoubaoResponse(page, beforeLines, beforeTurns, text, timeout);

    if (!response) {
      return [
        { Role: 'User', Text: text },
        { Role: 'System', Text: `No response within ${timeout}s. Doubao may still be generating.` },
      ];
    }

    return [
      { Role: 'User', Text: text },
      { Role: 'Assistant', Text: response },
    ];
  },
});
