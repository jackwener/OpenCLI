/**
 * Browser tab management helpers: extract, diff, and cleanup tab state.
 */

export function extractTabEntries(raw: unknown): Array<{ index: number; identity: string }> {
  if (Array.isArray(raw)) {
    return raw.map((tab: Record<string, unknown>, index: number) => ({
      index,
      identity: [
        tab?.id ?? '',
        tab?.url ?? '',
        tab?.title ?? '',
        tab?.name ?? '',
      ].join('|'),
    }));
  }

  if (typeof raw === 'string') {
    return raw
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        // Match tab list format: "- 0: (current) [title](url)"  or  "- 1: [title](url)"
        const tabMatch = line.match(/^-\s+(\d+):\s*(.*)$/);
        if (tabMatch) {
          return {
            index: parseInt(tabMatch[1], 10),
            identity: tabMatch[2].trim() || `tab-${tabMatch[1]}`,
          };
        }
        // Legacy format: "Tab 0 ..."
        const legacyMatch = line.match(/Tab\s+(\d+)\s*(.*)$/);
        if (legacyMatch) {
          return {
            index: parseInt(legacyMatch[1], 10),
            identity: legacyMatch[2].trim() || `tab-${legacyMatch[1]}`,
          };
        }
        return null;
      })
      .filter((entry): entry is { index: number; identity: string } => entry !== null);
  }

  return [];
}

export function extractTabIdentities(raw: unknown): string[] {
  return extractTabEntries(raw).map(tab => tab.identity);
}

export function diffTabIndexes(initialIdentities: string[], currentTabs: Array<{ index: number; identity: string }>): number[] {
  if (initialIdentities.length === 0 || currentTabs.length === 0) return [];
  const remaining = new Map<string, number>();
  for (const identity of initialIdentities) {
    remaining.set(identity, (remaining.get(identity) ?? 0) + 1);
  }

  const tabsToClose: number[] = [];
  for (const tab of currentTabs) {
    const count = remaining.get(tab.identity) ?? 0;
    if (count > 0) {
      remaining.set(tab.identity, count - 1);
      continue;
    }
    tabsToClose.push(tab.index);
  }

  return tabsToClose.sort((a, b) => b - a);
}

export function appendLimited(current: string, chunk: string, limit: number): string {
  const next = current + chunk;
  if (next.length <= limit) return next;
  return next.slice(-limit);
}
