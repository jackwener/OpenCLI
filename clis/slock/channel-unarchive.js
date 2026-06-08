// channel-unarchive.js
import { makeChannelActionCommand } from './channel-action.js';

makeChannelActionCommand({
  name: 'channel-unarchive',
  verb: 'unarchive',
  resultLabel: 'unarchived',
  description: 'Unarchive a channel — admin only (POST /channels/:id/unarchive). ' +
    '#name lookups exclude archived channels; pass the channelId UUID for archived ones.',
  archivedHint: true,
});
