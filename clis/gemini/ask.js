import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
  GEMINI_DOMAIN,
  ensureGeminiPage,
  getCurrentGeminiModel,
  readGeminiSnapshot,
  selectGeminiModel,
  selectGeminiThinking,
  sendGeminiMessage,
  startNewGeminiChat,
  waitForGeminiResponse,
  waitForGeminiSubmission,
} from './utils.js';
import { pickModelPickerScript, readMenuModelsScript } from './models.js';
function normalizeBooleanFlag(value) {
    if (typeof value === 'boolean')
        return value;
    const normalized = String(value ?? '').trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}
const NO_RESPONSE_PREFIX = '[NO RESPONSE]';

/**
 * Validate a --model value for gemini ask.
 * Throws ArgumentError for short aliases or invalid formats.
 */
function unwrapBrowserBridgeEnvelope(value) {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'session' in value) {
        if ('data' in value) return value.data;
        throw new CommandExecutionError('Gemini model discovery returned a malformed Browser Bridge envelope');
    }
    return value;
}

function requireDiscoveredModels(value) {
    const unwrapped = unwrapBrowserBridgeEnvelope(value);
    if (!Array.isArray(unwrapped)) {
        throw new CommandExecutionError('Gemini model discovery returned a malformed result');
    }
    for (const row of unwrapped) {
        if (!row || typeof row.model !== 'string' || !Array.isArray(row.thinkingValues)) {
            throw new CommandExecutionError('Gemini model discovery returned a malformed row');
        }
    }
    return unwrapped;
}

function validateAskModelValue(value) {
    if (!value) {
        throw new ArgumentError(
            '--model requires a canonical model id (e.g. "2.5-flash"). ' +
            'Use "opencli gemini models" to list available values.'
        );
    }
    // Reject short aliases like "pro", "flash", "flash-lite" that lack a version number.
    if (!/\d+\.\d+/.test(value)) {
        throw new ArgumentError(
            '--model "' + value + '" is not accepted. ' +
            'Short aliases like "pro", "flash", or "flash-lite" are not supported. ' +
            'Use a canonical model id (e.g. "2.5-flash"). ' +
            'Use "opencli gemini models" to list available values.'
        );
    }
    // Must match canonical format: X.Y-variant
    if (!/^\d+\.\d+-[a-z][a-z-]*$/.test(value)) {
        throw new ArgumentError(
            '--model "' + value + '" is not a valid canonical model id. ' +
            'Expected format: version-variant (e.g. "2.5-flash", "3.1-pro"). ' +
            'Use "opencli gemini models" to list available values.'
        );
    }
}

export const __test__ = {
    validateAskModelValue,
};

export const askCommand = cli({
    site: 'gemini',
    name: 'ask',
    access: 'write',
    description: 'Send a prompt to Gemini and return only the assistant response',
    domain: GEMINI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    defaultFormat: 'plain',
    args: [
        { name: 'prompt', required: true, positional: true, help: 'Prompt to send' },
        { name: 'model', type: 'string', required: false, help: 'Gemini model to use (e.g. "2.5-flash"). Use "opencli gemini models" to list available values.' },
        { name: 'timeout', type: 'int', required: false, help: 'Max seconds to wait (default: 60)', default: 60 },
        { name: 'new', required: false, help: 'Start a new chat first (true/false, default: false)', default: 'false' },
        { name: 'thinking', required: false, help: 'Thinking level: standard or extended (omitted = leave unchanged)', default: null },
    ],
    columns: ['response'],
    func: async (page, kwargs) => {
        const prompt = kwargs.prompt;
        const timeout = kwargs.timeout;
        if (!Number.isInteger(timeout) || timeout < 1) {
            throw new ArgumentError('--timeout must be a positive integer (seconds)');
        }

        // ── New chat (must happen before model/thinking selection) ──────
        const startFresh = normalizeBooleanFlag(kwargs.new);
        if (startFresh)
            await startNewGeminiChat(page);

        // ── Early validation: model format & thinking value ────────────
        const hasModel = kwargs.model !== undefined && kwargs.model !== null;
        const hasThinking = kwargs.thinking != null;

        let modelValue = null;
        if (hasModel) {
            modelValue = String(kwargs.model).trim();
            validateAskModelValue(modelValue);
        }

        if (hasThinking) {
            const thinkingRaw = String(kwargs.thinking ?? '').trim();
            const thinkingValue = thinkingRaw.toLowerCase();
            if (thinkingValue !== 'standard' && thinkingValue !== 'extended') {
                throw new ArgumentError(
                    `--thinking must be 'standard' or 'extended', got '${thinkingRaw}'`,
                    'Run `opencli gemini models` to see available thinking levels.',
                );
            }
        }

        // ── Model and thinking discovery (shared by both model and
        //    thinking selection) ──────────────────────────────────────
        let discoveredModels = null;
        if (hasModel || hasThinking) {
            await ensureGeminiPage(page);

            // Open the picker menu (click the model-picker button).
            const pickerRaw = await page.evaluate(`
              (() => {
                ${pickModelPickerScript()}
                const picker = findModelPicker();
                if (!picker) return { ok: false, reason: 'Gemini model picker button was not found' };
                try { picker.click(); } catch (_) { return { ok: false, reason: 'Failed to click Gemini model picker button' }; }
                return { ok: true };
              })()
            `);
            const pickerResult = unwrapBrowserBridgeEnvelope(pickerRaw);
            if (!pickerResult || typeof pickerResult !== 'object' || !pickerResult.ok) {
                throw new CommandExecutionError(
                    pickerResult?.reason || 'Failed to open Gemini model picker for model discovery'
                );
            }

            // Wait for React to render the menu.
            await page.wait(1.0);

            // Read model entries from the open menu.
            const raw = await page.evaluate(readMenuModelsScript());
            discoveredModels = requireDiscoveredModels(raw);

            // Close the menu. Thinking support is intentionally not copied from
            // the currently-visible UI into every model row: Gemini exposes
            // thinking controls for the current selection, not a reliable
            // per-model capability matrix.
            await page.evaluate(`(() => { try { document.body.click(); } catch (_) {} })()`);
        }

        // ── Model selection ──────────────────────────────────────────────
        if (hasModel) {
            const availableModels = discoveredModels || [];
            if (!Array.isArray(availableModels) || availableModels.length === 0) {
                throw new CommandExecutionError(
                    'Gemini model discovery returned no selectable models. Gemini Web may have changed its model selector UI.'
                );
            }
            const availableIds = availableModels.map((m) => m?.model).filter(Boolean);
            if (!availableIds.includes(modelValue)) {
                throw new ArgumentError(
                    'Unknown model "' + modelValue + '". ' +
                    'Available models: ' + availableIds.join(', ') + '. ' +
                    'Use "opencli gemini models" to see available values.'
                );
            }
            await selectGeminiModel(page, modelValue);
        }

        // ── Thinking validation and selection ──────────────────────────
        if (hasThinking) {
            // Reuse the pre-discovered models from the shared discovery call.
            const discovered = discoveredModels || [];

            // When --model was supplied, scope thinking to the selected model;
            // otherwise scope to the current model from the web UI.
            let targetModelId;
            if (hasModel) {
                targetModelId = modelValue;
            } else {
                targetModelId = await getCurrentGeminiModel(page);
            }

            // Build a map of model → thinkingValues for lookup.
            const modelThinkingMap = new Map();
            const allThinking = new Set();
            for (const entry of discovered) {
                if (entry && typeof entry.model === 'string' && Array.isArray(entry.thinkingValues)) {
                    const tvs = entry.thinkingValues.filter((tv) => typeof tv === 'string');
                    if (tvs.length > 0) {
                        modelThinkingMap.set(entry.model, tvs);
                        for (const tv of tvs) allThinking.add(tv);
                    }
                }
            }

            // Resolve thinkingValue from early validation.
            const thinkingValue = String(kwargs.thinking ?? '').trim().toLowerCase();

            // Validate: if we can identify the target model, scope to its
            // thinking values; otherwise fall back to the union across all models.
            const targetModelThinking =
                targetModelId && modelThinkingMap.has(targetModelId)
                    ? modelThinkingMap.get(targetModelId)
                    : null;

            if (targetModelThinking) {
                // Scoped to the target model.
                if (!targetModelThinking.includes(thinkingValue)) {
                    const availableForModel = targetModelThinking.sort().join(', ');
                    throw new ArgumentError(
                        `--thinking '${thinkingValue}' is not available for the ${hasModel ? 'selected' : 'current'} model ('${targetModelId}')`,
                        `Model '${targetModelId}' supports: ${availableForModel}. Run \`opencli gemini models\` for all models.`,
                    );
                }
            } else if (allThinking.size > 0 && !allThinking.has(thinkingValue)) {
                // Union fallback when the target model cannot be identified.
                const availableList = [...allThinking].sort().join(', ');
                throw new ArgumentError(
                    `--thinking '${thinkingValue}' is not currently available`,
                    `Available thinking values: ${availableList}. Run \`opencli gemini models\` for details.`,
                );
            }

            // Select the requested thinking level before snapshot.
            const selected = await selectGeminiThinking(page, thinkingValue);
            if (!selected) {
                // Build an informative hint from what we know.
                const hintParts = [];
                if (targetModelThinking && targetModelThinking.length > 0) {
                    hintParts.push(`Model '${targetModelId}' supports: ${targetModelThinking.sort().join(', ')}.`);
                } else if (allThinking.size > 0) {
                    hintParts.push(`Available thinking values: ${[...allThinking].sort().join(', ')}.`);
                }
                hintParts.push('Run `opencli gemini models` for details.');
                throw new ArgumentError(
                    `Could not select thinking level '${thinkingValue}' in the Gemini web UI`,
                    hintParts.join(' '),
                );
            }
        }

        const before = await readGeminiSnapshot(page);
        await sendGeminiMessage(page, prompt);
        const submissionStartedAt = Date.now();
        const submitted = await waitForGeminiSubmission(page, before, timeout);
        if (!submitted) {
            return [{ response: `💬 ${NO_RESPONSE_PREFIX} No Gemini response within ${timeout}s.` }];
        }
        const remainingTimeoutSeconds = Math.max(0, timeout - Math.ceil((Date.now() - submissionStartedAt) / 1000));
        const response = await waitForGeminiResponse(page, submitted, prompt, remainingTimeoutSeconds);
        if (!response) {
            return [{ response: `💬 ${NO_RESPONSE_PREFIX} No Gemini response within ${timeout}s.` }];
        }
        return [{ response: `💬 ${response}` }];
    },
});
