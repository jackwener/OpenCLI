export const NOTEBOOKLM_SITE = 'notebooklm';
export const NOTEBOOKLM_DOMAIN = 'notebooklm.google.com';
export const NOTEBOOKLM_REDIRECT_DOMAIN = 'notebook.google.com';
export const NOTEBOOKLM_HOME_URL = 'https://notebooklm.google.com/';

export function isNotebooklmHost(hostname) {
    return hostname === NOTEBOOKLM_DOMAIN || hostname === NOTEBOOKLM_REDIRECT_DOMAIN;
}
