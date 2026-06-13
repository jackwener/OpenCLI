export const SLOCK_SITE = 'slock';
export const SLOCK_DOMAIN = 'app.slock.ai';
export const SLOCK_HOME_URL = 'https://app.slock.ai/';
// API base: absolute prod URL. Slock is split-origin — the SPA lives at
// app.slock.ai (where the access token sits in localStorage), the REST API
// is on api.slock.ai. Adapter fetches must use the absolute URL so the
// request reaches the API host (not the SPA, which would 404 / return HTML).
// Single source of truth for every command; do not hardcode '/api/...' in
// command files. (Staging/dev override → R7 backlog.)
export const SLOCK_API_BASE = 'https://api.slock.ai/api';

export const LS_ACCESS_TOKEN = 'slock_access_token';
export const LS_REFRESH_TOKEN = 'slock_refresh_token';
export const LS_ACTIVE_SLUG = 'slock_last_server_slug';
