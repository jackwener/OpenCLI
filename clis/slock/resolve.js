export const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// ThreadTarget shape: { parentTarget: string, parentMsgId: string }
export function classifyThreadTarget(raw) {
  const s = String(raw ?? '').trim();
  const m = s.match(/^(#?[^:]+):([A-Za-z0-9-]{6,})$/);
  if (!m) return null;
  return { parentTarget: m[1], parentMsgId: m[2] };
}
