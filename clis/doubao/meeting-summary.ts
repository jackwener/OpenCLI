import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';
import {
  DOUBAO_DOMAIN,
  openMeetingPanel,
  getMeetingSummary,
  getMeetingChapters,
  parseDoubaoConversationId,
} from './utils.js';

export const meetingSummaryCommand = cli({
  site: 'doubao',
  name: 'meeting-summary',
  description: 'Get meeting summary and chapters from a Doubao conversation',
  domain: DOUBAO_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'id', required: true, positional: true, help: 'Conversation ID (numeric or full URL)' },
    { name: 'chapters', required: false, help: 'Also include AI chapters', default: 'false' },
  ],
  columns: ['Section', 'Content'],
  func: async (page: IPage, kwargs: Record<string, unknown>) => {
    const conversationId = parseDoubaoConversationId(kwargs.id as string);
    const includeChapters = kwargs.chapters === 'true' || kwargs.chapters === true;

    const opened = await openMeetingPanel(page, conversationId);
    if (!opened) {
      return [{ Section: 'Error', Content: 'No meeting card found in this conversation.' }];
    }

    const summary = await getMeetingSummary(page);
    const result: Array<{ Section: string; Content: string }> = [];

    if (summary) {
      result.push({ Section: 'Summary', Content: summary });
    }

    if (includeChapters) {
      const chapters = await getMeetingChapters(page);
      if (chapters) {
        result.push({ Section: 'Chapters', Content: chapters });
      }
    }

    if (result.length === 0) {
      return [{ Section: 'Info', Content: 'Meeting panel opened but no content found yet. Try again.' }];
    }

    return result;
  },
});
