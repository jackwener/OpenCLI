export type BrowserTabPlacement = 'owned-container' | 'existing-window';

const BROWSER_TAB_PLACEMENTS = ['owned-container', 'existing-window'] as const;

export function normalizeBrowserTabPlacement(name: string, raw: unknown): BrowserTabPlacement | null {
  if (raw === undefined || raw === '') return null;
  if (raw === 'owned-container' || raw === 'existing-window') return raw;
  throw new Error(`${name} must be one of: ${BROWSER_TAB_PLACEMENTS.join(', ')}. Received: "${String(raw)}"`);
}

export function resolveBrowserTabPlacementFromEnv(): BrowserTabPlacement {
  return normalizeBrowserTabPlacement('OPENCLI_TAB_PLACEMENT', process.env.OPENCLI_TAB_PLACEMENT)
    ?? 'owned-container';
}
