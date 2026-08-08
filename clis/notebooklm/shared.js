export const NOTEBOOKLM_SITE = 'notebooklm';
export const NOTEBOOKLM_DOMAIN = 'notebooklm.google.com';
export const NOTEBOOKLM_REDIRECTED_DOMAIN = 'notebook.google.com';
export const NOTEBOOKLM_HOSTS = Object.freeze([
    NOTEBOOKLM_DOMAIN,
    NOTEBOOKLM_REDIRECTED_DOMAIN,
]);
export const NOTEBOOKLM_HOME_URL = 'https://notebooklm.google.com/';

export function isNotebooklmHost(hostname) {
    return NOTEBOOKLM_HOSTS.includes(String(hostname ?? '').toLowerCase());
}
