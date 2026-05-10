import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { PAPERREVIEW_DOMAIN, buildReviewUrl, ensureSuccess, requestJson, summarizeReview, } from './utils.js';
cli({
    site: 'paperreview',
    name: 'review',
    access: 'read',
    description: 'Fetch a paperreview.ai review by token',
    domain: PAPERREVIEW_DOMAIN,
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'token', positional: true, required: true, help: 'Review token returned by paperreview.ai' },
        { name: 'timeout', type: 'int', required: false, default: 30, help: 'Max seconds for the overall command (default: 30)' },
    ],
    columns: ['status', 'title', 'venue', 'numerical_score', 'has_feedback', 'review_url'],
    func: async (kwargs) => {
        const token = String(kwargs.token ?? '').trim();
        if (!token) {
            throw new CliError('ARGUMENT', 'A review token is required.');
        }
        const { response, payload } = await requestJson(`/api/review/${encodeURIComponent(token)}`);
        if (response.status === 202) {
            return {
                status: 'processing',
                token,
                review_url: buildReviewUrl(token),
                title: '',
                venue: '',
                numerical_score: '',
                has_feedback: '',
                message: typeof payload === 'object' && payload ? payload.detail ?? 'Review is still processing.' : 'Review is still processing.',
            };
        }
        ensureSuccess(response, payload, 'Failed to fetch the review.', 'Check the token and try again');
        return summarizeReview(token, payload);
    },
});
