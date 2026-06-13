// channel-leave.js
import { makeChannelActionCommand } from './channel-action.js';

makeChannelActionCommand({
  name: 'channel-leave',
  verb: 'leave',
  resultLabel: 'left',
  description: 'Leave a channel (POST /channels/:id/leave)',
});
