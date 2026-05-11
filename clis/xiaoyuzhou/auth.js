import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CliError, CommandExecutionError, ConfigError, EXIT_CODES, getErrorMessage } from '@jackwener/opencli/errors';

export const XIAOYUZHOU_API_BASE_URL = 'https://api.xiaoyuzhoufm.com';
export const XIAOYUZHOU_TOKEN_TTL_MS = 20 * 60 * 1000;
export const XIAOYUZHOU_REFRESH_SKEW_MS = 60 * 1000;
export const XIAOYUZHOU_DEFAULT_DEVICE_ID = '81ADBFD6-6921-482B-9AB9-A29E7CC7BB55';
export const XIAOYUZHOU_DEFAULT_DEVICE_PROPERTIES = '';
export const XIAOYUZHOU_DEFAULT_USER_AGENT = 'Xiaoyuzhou/2.98.0 (build:2908; iOS 26.2.1)';

function getNowMs() {
    return Date.now();
}

export function getXiaoyuzhouCredentialFile() {
    return path.join(os.homedir(), '.opencli', 'xiaoyuzhou.json');
}

function createXiaoyuzhouAuthError(message) {
    return new CliError('AUTH_REQUIRED', message, `Update ${getXiaoyuzhouCredentialFile()} with fresh Xiaoyuzhou credentials before retrying.`, EXIT_CODES.NOPERM);
}

function coerceNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeXiaoyuzhouCredentials(raw = {}) {
    const lastUpdatedTs = coerceNumber(raw.last_updated_ts ?? raw.lastUpdatedTs);
    let expiresAt = coerceNumber(raw.expires_at ?? raw.expiresAt);
    if (expiresAt > 0 && expiresAt < 10_000_000_000) {
        expiresAt *= 1000;
    }
    if (!expiresAt && lastUpdatedTs > 0) {
        expiresAt = lastUpdatedTs * 1000 + XIAOYUZHOU_TOKEN_TTL_MS;
    }
    return {
        access_token: String(raw.access_token ?? raw.accessToken ?? '').trim(),
        refresh_token: String(raw.refresh_token ?? raw.refreshToken ?? '').trim(),
        expires_at: expiresAt,
        device_id: String(raw.device_id ?? raw.deviceId ?? XIAOYUZHOU_DEFAULT_DEVICE_ID).trim() || XIAOYUZHOU_DEFAULT_DEVICE_ID,
        device_properties: String(raw.device_properties ?? raw.deviceProperties ?? XIAOYUZHOU_DEFAULT_DEVICE_PROPERTIES),
    };
}
export function loadXiaoyuzhouCredentials() {
    const filePath = getXiaoyuzhouCredentialFile();
    if (fs.existsSync(filePath)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            const credentials = normalizeXiaoyuzhouCredentials(parsed);
            if (!credentials.access_token || !credentials.refresh_token) {
                throw new ConfigError(`Xiaoyuzhou credential file is missing access_token or refresh_token: ${filePath}`, 'Recreate the file with valid credentials.');
            }
            return credentials;
        }
        catch (error) {
            if (error instanceof ConfigError) {
                throw error;
            }
            throw new ConfigError(`Failed to parse Xiaoyuzhou credential file: ${filePath}`, `Ensure ${filePath} contains valid JSON. (${getErrorMessage(error)})`);
        }
    }
    throw new ConfigError(`Missing Xiaoyuzhou credentials. Expected ${filePath}`, `Create ${filePath} with access_token and refresh_token.`);
}

export function saveXiaoyuzhouCredentials(credentials) {
    const filePath = getXiaoyuzhouCredentialFile();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify({
        access_token: credentials.access_token,
        refresh_token: credentials.refresh_token,
        expires_at: credentials.expires_at,
        device_id: credentials.device_id,
        device_properties: credentials.device_properties,
    }, null, 2)}\n`, 'utf-8');
}

export function shouldRefreshXiaoyuzhouCredentials(credentials, now = getNowMs()) {
    return Number.isFinite(credentials.expires_at)
        && credentials.expires_at > 0
        && now >= credentials.expires_at - XIAOYUZHOU_REFRESH_SKEW_MS;
}

export function buildXiaoyuzhouHeaders(credentials, options = {}) {
    const {
        contentType = 'application/json',
        includeLocalTime = false,
        includeRefreshToken = false,
    } = options;
    const headers = {
        'Content-Type': contentType,
        Host: 'api.xiaoyuzhoufm.com',
        'User-Agent': XIAOYUZHOU_DEFAULT_USER_AGENT,
        Market: 'AppStore',
        'App-BuildNo': '2908',
        OS: 'ios',
        Manufacturer: 'Apple',
        BundleID: 'app.podcast.cosmos',
        Connection: 'keep-alive',
        'abtest-info': '{"old_user_discovery_feed":"enable"}',
        'Accept-Language': 'en-HK;q=1.0, zh-Hans-HK;q=0.9',
        Model: 'iPhone18,1',
        'app-permissions': '100000',
        Accept: '*/*',
        'App-Version': '2.98.0',
        WifiConnected: 'true',
        'OS-Version': '26.2.1',
        'x-custom-xiaoyuzhou-app-dev': '',
        'x-jike-device-id': credentials.device_id || XIAOYUZHOU_DEFAULT_DEVICE_ID,
        'x-jike-device-properties': credentials.device_properties ?? XIAOYUZHOU_DEFAULT_DEVICE_PROPERTIES,
    };
    if (credentials.access_token) {
        headers['x-jike-access-token'] = credentials.access_token;
    }
    if (includeRefreshToken && credentials.refresh_token) {
        headers['x-jike-refresh-token'] = credentials.refresh_token;
    }
    if (includeLocalTime) {
        headers['Local-Time'] = new Date().toISOString();
        headers.Timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    }
    return headers;
}

export async function refreshXiaoyuzhouCredentials(credentials, fetchImpl = fetch) {
    if (!credentials.refresh_token) {
        throw createXiaoyuzhouAuthError('Xiaoyuzhou refresh token is missing');
    }
    let response;
    try {
        response = await fetchImpl(`${XIAOYUZHOU_API_BASE_URL}/app_auth_tokens.refresh`, {
            method: 'POST',
            headers: buildXiaoyuzhouHeaders(credentials, {
                contentType: 'application/x-www-form-urlencoded; charset=utf-8',
                includeLocalTime: true,
                includeRefreshToken: true,
            }),
            signal: AbortSignal.timeout(20_000),
        });
    }
    catch (error) {
        throw new CommandExecutionError(`Failed to refresh Xiaoyuzhou credentials: ${getErrorMessage(error)}`);
    }
    const bodyText = await response.text();
    if (!response.ok) {
        throw createXiaoyuzhouAuthError(`Xiaoyuzhou token refresh failed with HTTP ${response.status}${bodyText ? `: ${bodyText}` : ''}`);
    }
    let parsed;
    try {
        parsed = JSON.parse(bodyText);
    }
    catch (error) {
        throw new CommandExecutionError(`Xiaoyuzhou refresh returned invalid JSON: ${getErrorMessage(error)}`);
    }
    if (!parsed?.success) {
        throw createXiaoyuzhouAuthError('Xiaoyuzhou refresh API returned success=false');
    }
    const nextCredentials = normalizeXiaoyuzhouCredentials({
        ...credentials,
        access_token: parsed['x-jike-access-token'] || '',
        refresh_token: parsed['x-jike-refresh-token'] || '',
        expires_at: getNowMs() + XIAOYUZHOU_TOKEN_TTL_MS,
    });
    if (!nextCredentials.access_token || !nextCredentials.refresh_token) {
        throw createXiaoyuzhouAuthError('Xiaoyuzhou refresh API returned empty access_token or refresh_token');
    }
    saveXiaoyuzhouCredentials(nextCredentials);
    return nextCredentials;
}

function buildApiUrl(endpoint, query) {
    const url = new URL(endpoint, XIAOYUZHOU_API_BASE_URL);
    if (query) {
        for (const [key, value] of Object.entries(query)) {
            if (value !== undefined && value !== null && value !== '') {
                url.searchParams.set(key, String(value));
            }
        }
    }
    return url.toString();
}

async function performXiaoyuzhouJsonRequest(endpoint, options, credentials, fetchImpl) {
    const {
        method = 'GET',
        query,
        body,
    } = options;
    let response;
    try {
        response = await fetchImpl(buildApiUrl(endpoint, query), {
            method,
            headers: buildXiaoyuzhouHeaders(credentials, {
                contentType: 'application/json',
                includeLocalTime: true,
            }),
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(20_000),
        });
    }
    catch (error) {
        throw new CommandExecutionError(`Failed to reach Xiaoyuzhou API: ${getErrorMessage(error)}`);
    }
    return response;
}

export async function requestXiaoyuzhouJson(endpoint, options = {}, fetchImpl = fetch) {
    let credentials = options.credentials ?? loadXiaoyuzhouCredentials();
    if (shouldRefreshXiaoyuzhouCredentials(credentials)) {
        credentials = await refreshXiaoyuzhouCredentials(credentials, fetchImpl);
    }
    let response = await performXiaoyuzhouJsonRequest(endpoint, options, credentials, fetchImpl);
    if (response.status === 401) {
        credentials = await refreshXiaoyuzhouCredentials(credentials, fetchImpl);
        response = await performXiaoyuzhouJsonRequest(endpoint, options, credentials, fetchImpl);
    }
    const bodyText = await response.text();
    if (!response.ok) {
        throw new CommandExecutionError(`Xiaoyuzhou API request failed with HTTP ${response.status}${bodyText ? `: ${bodyText}` : ''}`);
    }
    let parsed;
    try {
        parsed = JSON.parse(bodyText);
    }
    catch (error) {
        throw new CommandExecutionError(`Xiaoyuzhou API returned invalid JSON: ${getErrorMessage(error)}`);
    }
    if (parsed?.success === false) {
        throw new CommandExecutionError(parsed?.message || parsed?.msg || 'Xiaoyuzhou API returned success=false');
    }
    return {
        credentials,
        raw: parsed,
        data: parsed?.data,
    };
}

export async function fetchXiaoyuzhouTranscriptBody(url, fetchImpl = fetch) {
    let response;
    try {
        response = await fetchImpl(url, {
            method: 'GET',
            headers: {
                'User-Agent': XIAOYUZHOU_DEFAULT_USER_AGENT,
                Accept: '*/*',
                Market: 'AppStore',
            },
            signal: AbortSignal.timeout(20_000),
        });
    }
    catch (error) {
        throw new CommandExecutionError(`Failed to fetch Xiaoyuzhou transcript content: ${getErrorMessage(error)}`);
    }
    const bodyText = await response.text();
    if (!response.ok) {
        throw new CommandExecutionError(`Xiaoyuzhou transcript download failed with HTTP ${response.status}${bodyText ? `: ${bodyText}` : ''}`);
    }
    return bodyText;
}

export function extractTranscriptText(transcriptBody) {
    let parsed;
    try {
        parsed = JSON.parse(transcriptBody);
    }
    catch {
        return { text: '', segmentCount: 0 };
    }
    let items = [];
    if (Array.isArray(parsed)) {
        items = parsed;
    }
    else if (parsed && typeof parsed === 'object') {
        for (const key of ['segments', 'data', 'transcript', 'items']) {
            if (Array.isArray(parsed[key])) {
                items = parsed[key];
                break;
            }
        }
        if (items.length === 0) {
            const directText = typeof parsed.text === 'string' ? parsed.text.trim() : '';
            if (directText) {
                return { text: directText, segmentCount: 1 };
            }
        }
    }
    const textItems = [];
    for (const item of items) {
        if (!item || typeof item !== 'object' || typeof item.text !== 'string') {
            continue;
        }
        const cleaned = item.text.trim();
        if (cleaned) {
            textItems.push(cleaned);
        }
    }
    return {
        text: textItems.join('\n'),
        segmentCount: textItems.length,
    };
}
