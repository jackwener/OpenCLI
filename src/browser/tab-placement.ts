export type BrowserTabPlacement = 'owned-container' | 'existing-window';

const VALUES: BrowserTabPlacement[] = ['owned-container', 'existing-window'];

export function normalizeBrowserTabPlacement(name: string, raw: unknown): BrowserTabPlacement | null {
  if (raw === undefined || raw === '') return null;
  if (raw === 'owned-container' || raw === 'existing-window') return raw;
  throw new Error(`${name} must be one of: ${VALUES.join(', ')}. Received: "${String(raw)}"`);
}

export function resolveBrowserTabPlacementFromEnv(): BrowserTabPlacement | undefined {
  return normalizeBrowserTabPlacement('OPENCLI_TAB_PLACEMENT', process.env.OPENCLI_TAB_PLACEMENT) ?? 'existing-window';
}
