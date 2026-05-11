import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const EMPTY_RESULT_PATTERNS = [
    /没有找到/,
    /暂无/,
    /无相关/,
    /未找到/,
    /搜索结果为\s*0/,
    /很抱歉/,
];

export function parseGovPolicyLimit(raw, command) {
    const value = raw ?? 10;
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1) {
        throw new ArgumentError(`gov-policy ${command} --limit must be a positive integer`);
    }
    if (limit > 20) {
        throw new ArgumentError(`gov-policy ${command} --limit must be <= 20`);
    }
    return limit;
}

export function classifyExtractorFailure(command, result) {
    const sample = String(result?.sample || '').replace(/\s+/g, ' ').trim();
    const url = String(result?.url || '').trim();
    if (command === 'search' && EMPTY_RESULT_PATTERNS.some((pattern) => pattern.test(sample))) {
        throw new EmptyResultError('gov-policy search', sample ? sample.slice(0, 160) : undefined);
    }
    const context = [url && `url=${url}`, sample && `sample=${sample.slice(0, 160)}`]
        .filter(Boolean)
        .join('; ');
    throw new CommandExecutionError(
        `gov-policy ${command} page did not expose readable result rows`,
        context || 'The page structure may have changed or the page did not finish rendering.',
    );
}

export function requireRows(command, rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new CommandExecutionError(
            `gov-policy ${command} extractor returned no result rows`,
            'The page structure may have changed or all result cards were missing required title fields.',
        );
    }
    return rows;
}

export function wrapBrowserError(command, error) {
    if (error instanceof ArgumentError || error instanceof EmptyResultError || error instanceof CommandExecutionError) {
        throw error;
    }
    throw new CommandExecutionError(`gov-policy ${command} browser extraction failed: ${error?.message ?? error}`);
}
