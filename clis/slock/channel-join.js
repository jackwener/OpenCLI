// channel-join.js
import { makeChannelActionCommand } from './channel-action.js';

makeChannelActionCommand({
  name: 'channel-join',
  verb: 'join',
  resultLabel: 'joined',
  description: 'Join a public channel (POST /channels/:id/join)',
});
