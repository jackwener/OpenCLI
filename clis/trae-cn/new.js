import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, selectorError } from '@jackwener/opencli/errors';
import { clickNewTaskScript, currentTaskStateScript, ensurePrompt, normalizeTimeout, sendTraePrompt } from './utils.js';

export const newCommand = cli({
  site: 'trae-cn',
  name: 'new',
  access: 'write',
  description: 'Start a new Trae CN task in the current workspace, optionally sending the first prompt',
  example: 'OPENCLI_CDP_ENDPOINT=http://127.0.0.1:39240 OPENCLI_CDP_TARGET=talk opencli trae-cn new "请执行你的任务" -f json',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'prompt', required: false, positional: true, help: 'Optional first prompt to send after creating the task' },
    { name: 'timeout', type: 'int', required: false, help: 'Max seconds to wait for a fresh task composer (default: 10)', default: 10 },
  ],
  columns: ['Status', 'Action', 'Workspace', 'Model', 'Agent', 'FreshTaskConfirmed', 'TurnsBeforeSubmit', 'Turns', 'ComposerReady', 'SubmitMode'],
  func: async (page, kwargs) => {
    const timeout = normalizeTimeout(kwargs.timeout, 10);
    const clicked = await page.evaluate(clickNewTaskScript());
    if (!clicked?.ok) {
      throw selectorError('Trae CN new task button');
    }

    const started = Date.now();
    let state = null;
    while (Date.now() - started < timeout * 1000) {
      await page.wait(0.5);
      state = await page.evaluate(currentTaskStateScript());
      if (state?.composerReady && state.turns === 0) break;
    }

    if (!state?.composerReady || state.turns !== 0) {
      throw new CommandExecutionError(
        `Clicked Trae CN new task via ${clicked.method}; fresh empty composer was not confirmed`,
        `Observed composerReady=${state?.composerReady ? 'yes' : 'no'}, turns=${state?.turns ?? 'unavailable'}. Verify the current window is a Trae CN chat workspace and retry.`,
      );
    }

    const turnsBeforeSubmit = state.turns;
    let submitMode = '';
    if (kwargs.prompt !== undefined && kwargs.prompt !== null && String(kwargs.prompt).trim()) {
      const result = await sendTraePrompt(page, ensurePrompt(kwargs.prompt));
      submitMode = result.mode;
      await page.wait(0.5);
      state = await page.evaluate(currentTaskStateScript());
    }

    return [{
      Status: 'Success',
      Action: kwargs.prompt ? `New task created via ${clicked.method}; prompt submitted` : `New task created via ${clicked.method}`,
      Workspace: state?.workspace || '',
      Model: state?.model || '',
      Agent: state?.agent || '',
      FreshTaskConfirmed: 'yes',
      TurnsBeforeSubmit: turnsBeforeSubmit,
      Turns: state?.turns ?? 0,
      ComposerReady: state?.composerReady ? 'yes' : 'no',
      SubmitMode: submitMode,
    }];
  },
});
