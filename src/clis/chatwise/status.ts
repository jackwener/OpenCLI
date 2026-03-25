import { makeStatusCommand } from '../_shared/desktop-commands.js';
import { chatwiseRequiredEnv } from './shared.js';

export const statusCommand = makeStatusCommand('chatwise', 'ChatWise Desktop', { requiredEnv: chatwiseRequiredEnv });
