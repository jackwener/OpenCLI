import { makeScreenshotCommand } from '../_shared/desktop-commands.js';
import { chatwiseRequiredEnv } from './shared.js';

export const screenshotCommand = makeScreenshotCommand('chatwise', 'ChatWise', { requiredEnv: chatwiseRequiredEnv });
