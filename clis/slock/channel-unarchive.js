// channel-unarchive.js
import { makeChannelActionCommand } from './channel-action.js';

makeChannelActionCommand({
  name: 'channel-unarchive',
  verb: 'unarchive',
  resultLabel: 'unarchived',
  description: 'Unarchive a channel — admin only (POST /channels/:id/unarchive)',
});
