// thread-unfollow.js
import { makeThreadStateCommand } from './thread-state.js';

makeThreadStateCommand({
  name: 'thread-unfollow',
  verb: 'unfollow',
  resultLabel: 'unfollowed',
  description: 'Stop following a thread (POST /channels/threads/unfollow)',
});
