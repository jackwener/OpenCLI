/**
 * Stable keys for network capture entries.
 *
 * Agents reference entries by key (e.g. `UserTweets`, `GET api.x.com/1.1/home`)
 * instead of array index, so the mapping survives new captures.
 *
 * Rules:
 *   GraphQL (URL contains `/graphql/`): key = operationName derived from URL path
 *                                       (the segment after a 22-char query id, or the last segment)
 *   Everything else: key = `METHOD host+pathname`
 *
 * On collision assignKeys suffixes duplicates as `base#2`, `base#3`, ... —
 * the first occurrence stays bare (there is no `#1`).
 */

export interface KeyableRequest {
    url: string;
    method: string;
}

export function deriveKey(req: KeyableRequest): string {
    const parsed = safeParseUrl(req.url);
    if (!parsed) return `${req.method.toUpperCase()} ${truncate(req.url, 120)}`;

    const path = parsed.pathname;
    if (path.includes('/graphql/')) {
        const op = graphqlOperationName(path);
        if (op) return op;
    }

    return `${req.method.toUpperCase()} ${parsed.host}${path}`;
}

export function assignKeys<T extends KeyableRequest>(requests: T[]): Array<T & { key: string }> {
    const counts = new Map<string, number>();
    const out: Array<T & { key: string }> = [];
    for (const req of requests) {
        const base = deriveKey(req);
        const n = counts.get(base) ?? 0;
        counts.set(base, n + 1);
        const key = n === 0 ? base : `${base}#${n + 1}`;
        out.push({ ...req, key });
    }
    return out;
}

function graphqlOperationName(pathname: string): string | null {
    // Patterns we've seen in the wild:
    //   /i/api/graphql/<queryId>/UserTweets
    //   /graphql/<queryId>/SomeOp
    //   /graphql/SomeOp                       (rare, no id)
    const segments = pathname.split('/').filter(Boolean);
    const idx = segments.indexOf('graphql');
    if (idx < 0) return null;
    const tail = segments.slice(idx + 1);
    if (tail.length === 0) return null;
    if (tail.length === 1) return tail[0];
    // tail[0] is usually a query id; the operation name is the next segment.
    return tail[1] || tail[0];
}

function safeParseUrl(url: string): URL | null {
    try { return new URL(url); }
    catch { return null; }
}

function truncate(s: string, max: number): string {
    return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
