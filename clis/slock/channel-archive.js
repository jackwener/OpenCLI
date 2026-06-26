// channel-archive.js
import { makeChannelActionCommand } from './channel-action.js';

makeChannelActionCommand({
  name: 'channel-archive',
  verb: 'archive',
  resultLabel: 'archived',
  description: 'Archive a channel — admin only (POST /channels/:id/archive)',
});
