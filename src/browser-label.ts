/**
 * Detect which browser the user intends to target via OPENCLI_BROWSER env var.
 * Used for hint text, error messages, and doctor diagnostics.
 */

export type BrowserLabel = 'Firefox' | 'Chrome/Chromium';

export function getBrowserLabel(): BrowserLabel {
  const env = (process.env.OPENCLI_BROWSER ?? '').toLowerCase();
  if (env === 'firefox' || env === 'ff') return 'Firefox';
  return 'Chrome/Chromium';
}

/** Short label without slash: "Firefox" or "Chrome" */
export function getBrowserShortLabel(): string {
  return getBrowserLabel() === 'Firefox' ? 'Firefox' : 'Chrome';
}
