// thread-done.js
import { makeThreadStateCommand } from './thread-state.js';

makeThreadStateCommand({
  name: 'thread-done',
  verb: 'done',
  resultLabel: 'done',
  description: 'Mark a thread as done / hide it from the active list (POST /channels/threads/done)',
});
