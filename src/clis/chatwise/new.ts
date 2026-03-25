import { makeNewCommand } from '../_shared/desktop-commands.js';
import { chatwiseRequiredEnv } from './shared.js';

export const newCommand = makeNewCommand('chatwise', 'ChatWise conversation', { requiredEnv: chatwiseRequiredEnv });
