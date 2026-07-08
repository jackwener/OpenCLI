/**
 * OpenReview paper + threaded reviews/decisions/comments.
 *
 * Walks the forum tree once and emits one row per note in chronological order:
 *   PAPER → REVIEW (one per reviewer) → REBUTTAL/COMMENT → DECISION → WITHDRAWAL.
 *
 * Each row carries `rating` / `confidence` so reviewers stand out at a glance.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { coerceInt, openreviewFetch, readContent, requireForumId } from './utils.js';

const SECTION_FIELDS = [
    ['summary', 'Summary'],
    ['strengths', 'Strengths'],
    ['weaknesses', 'Weaknesses'],
    ['questions', 'Questions'],
    ['comment', 'Comment'],
    ['rebuttal', 'Rebuttal'],
    ['decision', 'Decision'],
    ['recommendation', 'Recommendation'],
    ['title', 'Title'],
    ['abstract', 'Abstract'],
    ['withdrawal_confirmation', 'Withdrawal confirmation'],
];

/** Pull the trailing segment of an invitation id (e.g. ".../-/Official_Review" → "Official_Review"). */
function invitationTail(invitations) {
    if (!Array.isArray(invitations)) return '';
    for (const inv of invitations) {
        const m = String(inv).match(/\/-\/([^/]+)$/);
        if (m) return m[1];
    }
    return '';
}

/** Map a note's invitation tail to a row type label. */
function classifyNote(note, isRoot) {
    if (isRoot) return 'PAPER';
    const tail = invitationTail(note?.invitations).toLowerCase();
    if (tail.includes('decision')) return 'DECISION';
    if (tail.includes('withdrawal')) return 'WITHDRAWAL';
    if (tail.includes('rebuttal')) return 'REBUTTAL';
    if (tail.includes('meta')) return 'META_REVIEW';
    if (tail.includes('review')) return 'REVIEW';
    if (tail.includes('comment')) return 'COMMENT';
    return tail ? tail.toUpperCase() : 'NOTE';
}

/**
 * Pick the most informative signature segment, e.g.:
 *   "ICLR.cc/2025/Conference/Submission14296/Reviewer_uVwr" → "Reviewer_uVwr"
 *   "ICLR.cc/2025/Conference/Program_Chairs"               → "Program_Chairs"
 *   "~Pedro_Jose_Moreno_Mengibar1"                          → "Pedro Jose Moreno Mengibar"
 */
function authorFromSignatures(signatures) {
    if (!Array.isArray(signatures) || !signatures.length) return '';
    const sig = String(signatures[0]);
    if (sig.startsWith('~')) {
        return sig.replace(/^~/, '').replace(/\d+$/, '').replace(/_/g, ' ').trim();
    }
    const parts = sig.split('/');
    return parts[parts.length - 1] || sig;
}

function joinSections(content) {
    const parts = [];
    for (const [key, label] of SECTION_FIELDS) {
        const value = readContent(content, key);
        if (value === undefined || value === null) continue;
        const text = Array.isArray(value) ? value.join(', ') : String(value);
        const trimmed = text.replace(/\r\n/g, '\n').trim();
        if (!trimmed) continue;
        parts.push(`${label}: ${trimmed}`);
    }
    return parts.join('\n\n');
}

function truncate(text, maxLength) {
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 3)}...`;
}

cli({
    site: 'openreview',
    name: 'reviews',
    access: 'read',
    description: 'Show full review thread (paper + reviews + decisions) for an OpenReview forum',
    domain: 'openreview.net',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'forum', positional: true, required: true, help: 'OpenReview forum id (same as paper id)' },
        { name: 'max-length', type: 'int', default: 4000, help: 'Per-row text truncation (min 200)' },
    ],
    columns: ['type', 'author', 'rating', 'confidence', 'text'],
    func: async (args) => {
        const forum = requireForumId(args.forum, 'forum');
        const rawMax = args['max-length'] ?? args.maxLength ?? 4000;
        const maxLength = coerceInt(rawMax);
        if (!Number.isInteger(maxLength) || maxLength < 200) {
            throw new ArgumentError('openreview reviews max-length must be an integer >= 200');
        }
        const rootJson = await openreviewFetch(`/notes?id=${encodeURIComponent(forum)}`, `openreview paper ${forum}`);
        const rootNotes = Array.isArray(rootJson?.notes) ? rootJson.notes : [];
        const root = rootNotes[0];
        if (!root) {
            throw new EmptyResultError('openreview', `No forum found with id "${forum}". Confirm the forum id from openreview.net.`);
        }
        const repliesJson = await openreviewFetch(`/notes?forum=${encodeURIComponent(forum)}&details=replies&limit=1000`, `openreview reviews ${forum}`);
        const replies = Array.isArray(repliesJson?.notes) ? repliesJson.notes.filter(note => note?.id !== forum) : [];
        // Sort by cdate (creation time) so ordering is deterministic regardless of API order.
        const sorted = [...replies].sort((a, b) => (a?.cdate ?? 0) - (b?.cdate ?? 0));
        const ordered = [root, ...sorted];
        return ordered.map((note) => {
            const isRoot = note?.id === forum;
            const type = classifyNote(note, isRoot);
            const author = authorFromSignatures(note?.signatures);
            const rating = readContent(note?.content, 'rating');
            const confidence = readContent(note?.content, 'confidence');
            const text = truncate(joinSections(note?.content), maxLength);
            return {
                type,
                author,
                rating: rating === undefined || rating === null ? '' : String(rating),
                confidence: confidence === undefined || confidence === null ? '' : String(confidence),
                text,
            };
        });
    },
});
