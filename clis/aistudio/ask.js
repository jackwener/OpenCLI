import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import {
  AISTUDIO_DOMAIN,
  DEFAULT_AISTUDIO_TEXT_MODEL,
  applyAIStudioSettings,
  createAIStudioDeadline,
  parseAIStudioJsonObject,
  parseAIStudioStringList,
  requirePositiveInteger,
  sendAIStudioMessage,
  startNewAIStudioChat,
  uploadAIStudioImages,
  waitForAIStudioResponse,
} from './utils.js';

export const askCommand = cli({
  site: 'aistudio',
  name: 'ask',
  access: 'write',
  description: 'Send a prompt to Google AI Studio and return only the model response',
  domain: AISTUDIO_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  // Ephemeral site session: every call gets a fresh AI Studio page context.
  // Persistent sessions accumulate broken page state after failed generations
  // (stalled uploads / missing model selector), which makes every later call
  // fail until the page recovers; ephemeral sessions avoid that entirely.
  siteSession: 'ephemeral',
  navigateBefore: false,
  defaultFormat: 'plain',
  args: [
    { name: 'prompt', positional: true, required: true, help: 'Prompt to send to Google AI Studio' },
    { name: 'image', type: 'string', help: 'Local image path to attach for visual prompting' },
    { name: 'model', type: 'string', default: '', help: `Canonical model id or unique model name from \`opencli aistudio models\` (default: ${DEFAULT_AISTUDIO_TEXT_MODEL}, override with OPENCLI_AISTUDIO_MODEL)` },
    { name: 'thinking', type: 'string', help: 'Thinking Level shown by the selected model, e.g. Minimal or High' },
    { name: 'temperature', type: 'number', help: 'Sampling temperature within the selected model UI range' },
    { name: 'top-p', type: 'number', help: 'Top P within the selected model UI range' },
    { name: 'max-output-tokens', type: 'int', help: 'Maximum output tokens within the selected model UI range' },
    { name: 'system-instruction', type: 'string', help: 'System instruction; pass an empty string to clear it' },
    { name: 'structured-output', type: 'bool', help: 'Enable or disable structured outputs (omit = leave unchanged)' },
    { name: 'code-execution', type: 'bool', help: 'Enable or disable code execution (omit = leave unchanged)' },
    { name: 'function-calling', type: 'bool', help: 'Enable or disable function calling (omit = leave unchanged)' },
    { name: 'google-search', type: 'bool', help: 'Enable or disable Grounding with Google Search (omit = leave unchanged)' },
    { name: 'google-maps', type: 'bool', help: 'Enable or disable Grounding with Google Maps (omit = leave unchanged)' },
    { name: 'url-context', type: 'bool', help: 'Enable or disable URL context (omit = leave unchanged)' },
    { name: 'media-resolution', type: 'string', help: 'Media resolution shown by the selected model, e.g. Default or High' },
    { name: 'stop-sequences', type: 'string', help: 'Stop sequences as a comma-separated list or JSON string array' },
    { name: 'safety-settings', type: 'string', help: 'Safety thresholds as a JSON object, e.g. {"Harassment":"Block some"}' },
    // Always a fresh chat: the ephemeral site session gives every call a clean
    // page context, so a prompt can never leak into a previous conversation.
    { name: 'copy-as-markdown', type: 'bool', default: false, help: 'After generation, recover the original Markdown source via the response menu Copy as Markdown action (headings, lists, tables, formula delimiters preserved)' },
    { name: 'timeout', type: 'int', default: 120, help: 'Maximum generation time in seconds (default: 120)' },
  ],
  columns: ['response'],
  func: async (page, kwargs) => {
    const timeout = requirePositiveInteger(kwargs.timeout, '--timeout');
    const deadline = createAIStudioDeadline(timeout);
    if (kwargs['max-output-tokens'] !== undefined) {
      requirePositiveInteger(kwargs['max-output-tokens'], '--max-output-tokens');
    }
    await startNewAIStudioChat(page, { deadline });

    // A fixed default text model beats "whatever model is currently active":
    // leaving the active model alone (e.g. an image model from a prior `image`
    // run) silently breaks the text prompt. Google ships new models often, so a
    // hardcoded current default is more stable than auto-picking the latest.
    // OPENCLI_AISTUDIO_MODEL overrides it without editing the adapter.
    const model = String(kwargs.model || '').trim() || DEFAULT_AISTUDIO_TEXT_MODEL;

    const settings = await applyAIStudioSettings(page, {
      model,
      thinking: kwargs.thinking,
      temperature: kwargs.temperature,
      topP: kwargs['top-p'],
      maxOutputTokens: kwargs['max-output-tokens'],
      systemInstruction: kwargs['system-instruction'],
      structuredOutput: kwargs['structured-output'],
      codeExecution: kwargs['code-execution'],
      functionCalling: kwargs['function-calling'],
      googleSearch: kwargs['google-search'],
      googleMaps: kwargs['google-maps'],
      urlContext: kwargs['url-context'],
      mediaResolution: kwargs['media-resolution'],
      stopSequences: parseAIStudioStringList(kwargs['stop-sequences'], '--stop-sequences'),
      safetySettings: parseAIStudioJsonObject(kwargs['safety-settings'], '--safety-settings'),
      deadline,
    });
    const unsupportedCategory = settings.selectedModel?.category;
    if (unsupportedCategory && ['image', 'video', 'audio', 'live'].includes(unsupportedCategory)) {
      throw new ArgumentError(
        `Model ${settings.model} is a ${unsupportedCategory} model.`,
        unsupportedCategory === 'image'
          ? 'Use `opencli aistudio image <prompt> --model <model-id>` for image generation.'
          : 'Video, audio, and live generation are not supported by the aistudio adapter yet; use a text model for `ask`.',
      );
    }

    if (kwargs.image) await uploadAIStudioImages(page, [kwargs.image], { deadline });

    const submission = await sendAIStudioMessage(page, kwargs.prompt, { deadline });
    const result = await waitForAIStudioResponse(page, submission, timeout, {
      deadline,
      copyAsMarkdown: !!kwargs['copy-as-markdown'],
    });
    if (!result.text) {
      throw new EmptyResultError('aistudio ask', 'AI Studio completed without a text response');
    }
    return [{ response: result.text }];
  },
});
