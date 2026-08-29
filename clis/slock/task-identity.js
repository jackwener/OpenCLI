import { CommandExecutionError } from '@jackwener/opencli/errors';

export function assertTaskIdentity(t, expectedId, commandName) {
  const taskId = t?.id;
  if (!taskId) {
    throw new CommandExecutionError(`Slock ${commandName} succeeded without returning task id ${expectedId}; refusing to report a task row.`);
  }
  if (taskId !== expectedId) {
    throw new CommandExecutionError(`Slock ${commandName} returned task id ${taskId}, expected ${expectedId}.`);
  }
  return taskId;
}
