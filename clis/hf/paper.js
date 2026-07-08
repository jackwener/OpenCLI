// hf paper — fetch a single Hugging Face paper page (mirrors arXiv id),
// returning the full title / summary / upvote count / authors and the
// AI-generated keyword list HF curates.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const ARXIV_ID_PATTERN = /^\d{4}\.\d{4,5}(?:v\d+)?$/;

cli({
    site: 'hf',
    name: 'paper',
    access: 'read',
    description: 'Hugging Face paper detail by arXiv id (full title / summary / authors / AI keywords)',
    domain: 'huggingface.co',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'arXiv id (e.g. "1706.03762") — same value HF uses to mirror the paper' },
    ],
    columns: ['id', 'title', 'authors', 'publishedAt', 'upvotes', 'aiKeywords', 'summary', 'aiSummary', 'url'],
    func: async (args) => {
        const raw = String(args.id ?? '').trim();
        if (!raw) {
            throw new ArgumentError('hf paper id cannot be empty', 'Example: opencli hf paper 1706.03762');
        }
        if (!ARXIV_ID_PATTERN.test(raw)) {
            throw new ArgumentError(
                `hf paper id "${args.id}" is not a valid arXiv id`,
                'Expected the modern arXiv form `YYMM.NNNNN` (optionally with a version suffix like `v3`).',
            );
        }
        const endpoint = process.env.HF_ENDPOINT?.replace(/\/+$/, '') || 'https://huggingface.co';
        const url = `${endpoint}/api/papers/${encodeURIComponent(raw)}`;
        let resp;
        try {
            resp = await fetch(url, { headers: { accept: 'application/json' } });
        }
        catch (err) {
            throw new CommandExecutionError(`hf paper request failed: ${err?.message ?? err}`);
        }
        if (resp.status === 404) {
            throw new EmptyResultError('hf paper', `Hugging Face has no paper page for "${raw}".`);
        }
        if (resp.status === 429) {
            throw new CommandExecutionError(
                'hf paper returned HTTP 429 (rate limited)',
                'Hugging Face throttles unauthenticated traffic; wait a few seconds and retry.',
            );
        }
        if (!resp.ok) {
            throw new CommandExecutionError(`hf paper returned HTTP ${resp.status}`);
        }
        let body;
        try {
            body = await resp.json();
        }
        catch (err) {
            throw new CommandExecutionError(`hf paper returned malformed JSON: ${err?.message ?? err}`);
        }
        if (!body || typeof body !== 'object' || !body.id) {
            throw new EmptyResultError('hf paper', `Hugging Face returned no paper data for "${raw}".`);
        }
        const authors = Array.isArray(body.authors)
            ? body.authors.map((a) => (typeof a === 'object' && a ? (a.name || a.fullname || '') : String(a))).filter(Boolean)
            : [];
        const aiKeywords = Array.isArray(body.ai_keywords) ? body.ai_keywords.join(', ') : '';
        return [{
            id: String(body.id),
            title: String(body.title ?? ''),
            authors: authors.join(', '),
            publishedAt: String(body.publishedAt ?? '').slice(0, 10),
            upvotes: body.upvotes != null ? Number(body.upvotes) : null,
            aiKeywords,
            summary: String(body.summary ?? ''),
            aiSummary: String(body.ai_summary ?? ''),
            url: `${endpoint}/papers/${body.id}`,
        }];
    },
});
