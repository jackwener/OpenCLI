import { cli, Strategy } from '../../src/registry.js';
import type { IPage } from '../../src/types.js';
import {
  DOUBAO_DOMAIN,
  openMeetingPanel,
  getMeetingTranscript,
  parseDoubaoConversationId,
  triggerTranscriptDownload,
} from './utils.js';

export const meetingTranscriptCommand = cli({
  site: 'doubao',
  name: 'meeting-transcript',
  description: 'Get or download the meeting transcript from a Doubao conversation',
  domain: DOUBAO_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'id', required: true, positional: true, help: 'Conversation ID (numeric or full URL)' },
    { name: 'download', required: false, help: 'Trigger browser file download instead of reading text', default: 'false' },
  ],
  columns: ['Section', 'Content'],
  func: async (page: IPage, kwargs: Record<string, unknown>) => {
    const conversationId = parseDoubaoConversationId(kwargs.id as string);
    const shouldDownload = kwargs.download === 'true' || kwargs.download === true;

    const opened = await openMeetingPanel(page, conversationId);
    if (!opened) {
      return [{ Section: 'Error', Content: 'No meeting card found in this conversation.' }];
    }

    if (shouldDownload) {
      const ok = await triggerTranscriptDownload(page);
      if (!ok) {
        return [{ Section: 'Error', Content: 'Failed to trigger transcript download.' }];
      }
      return [{ Section: 'Download', Content: 'Transcript download triggered in browser. Check your Downloads folder.' }];
    }

    const transcript = await getMeetingTranscript(page);
    if (!transcript) {
      return [{ Section: 'Info', Content: 'No transcript content found. The meeting may not have a text record.' }];
    }

    return [{ Section: 'Transcript', Content: transcript }];
  },
});
