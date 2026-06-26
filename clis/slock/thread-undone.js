// thread-undone.js
import { makeThreadStateCommand } from './thread-state.js';

makeThreadStateCommand({
  name: 'thread-undone',
  verb: 'undone',
  resultLabel: 'undone',
  description: 'Restore a done thread to the active list (POST /channels/threads/undone)',
});
