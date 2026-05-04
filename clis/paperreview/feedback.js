import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { PAPERREVIEW_DOMAIN, ensureSuccess, parseYesNo, requestJson, summarizeFeedback, validateHelpfulness, } from './utils.js';
cli({
    site: 'paperreview',
    name: 'feedback',
    access: 'write',
    description: 'Submit feedback for a paperreview.ai review token',
    domain: PAPERREVIEW_DOMAIN,
    strategy: Strategy.PUBLIC,
    browser: false,
    timeoutSeconds: 30,
    args: [
        { name: 'token', positional: true, required: true, help: 'Review token returned by paperreview.ai' },
        { name: 'helpfulness', required: true, type: 'int', help: 'Helpfulness score from 1 to 5' },
        { name: 'critical-error', required: true, choices: ['yes', 'no'], help: 'Whether the review contains a critical error' },
        { name: 'actionable-suggestions', required: true, choices: ['yes', 'no'], help: 'Whether the review contains actionable suggestions' },
        { name: 'additional-comments', help: 'Optional free-text feedback' },
    ],
    columns: ['status', 'token', 'helpfulness', 'critical_error', 'actionable_suggestions', 'message'],
    func: async (kwargs) => {
        const token = String(kwargs.token ?? '').trim();
        if (!token) {
            throw new CliError('ARGUMENT', 'A review token is required.');
        }
        const helpfulness = validateHelpfulness(kwargs.helpfulness);
        const criticalError = parseYesNo(kwargs['critical-error'], 'critical-error');
        const actionableSuggestions = parseYesNo(kwargs['actionable-suggestions'], 'actionable-suggestions');
        const comments = String(kwargs['additional-comments'] ?? '').trim();
        const payload = {
            helpfulness,
            has_critical_error: criticalError,
            has_actionable_suggestions: actionableSuggestions,
        };
        if (comments) {
            payload.additional_comments = comments;
        }
        const { response, payload: responsePayload } = await requestJson(`/api/feedback/${encodeURIComponent(token)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        ensureSuccess(response, responsePayload, 'Failed to submit feedback.', 'Check the token and try again');
        return summarizeFeedback({
            token,
            helpfulness,
            criticalError,
            actionableSuggestions,
            comments,
            payload: responsePayload,
        });
    },
});
