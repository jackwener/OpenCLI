export const NOTEBOOKLM_SITE = 'notebooklm';
export const NOTEBOOKLM_DOMAIN = 'notebook.google.com';
export const NOTEBOOKLM_LEGACY_DOMAIN = 'notebooklm.google.com';
export const NOTEBOOKLM_HOME_URL = `https://${NOTEBOOKLM_DOMAIN}/`;

export function isNotebooklmHost(hostname) {
    return hostname === NOTEBOOKLM_DOMAIN || hostname === NOTEBOOKLM_LEGACY_DOMAIN;
}

export function parseTrustedNotebooklmUrl(value) {
    try {
        const url = new URL(String(value ?? ''));
        if (url.protocol !== 'https:' || !isNotebooklmHost(url.hostname) || url.username || url.password || url.port) {
            return null;
        }
        return url;
    }
    catch {
        return null;
    }
}
