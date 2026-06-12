import { ArgumentError } from '@jackwener/opencli/errors';

export const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// ThreadTarget shape: { parentTarget: string, parentMsgId: string }
export function classifyThreadTarget(raw) {
  const s = String(raw ?? '').trim();
  const m = s.match(/^(#?[^:]+):([A-Za-z0-9-]{6,})$/);
  if (!m) return null;
  return { parentTarget: m[1], parentMsgId: m[2] };
}

// Target kinds:
//   { kind: 'channel-uuid', channelId }
//   { kind: 'channel-name', name }
//   { kind: 'dm-uuid', userId }
//   { kind: 'dm-name', name }
//   { kind: 'thread', parentTarget, parentMsgId }
export function classifyTarget(raw) {
  const v = String(raw ?? '').trim();
  if (!v) throw new ArgumentError('target required: "#channel", "#channel:threadShortId", "dm:@name", "dm:<userId>", or channelId UUID.');
  if (v.startsWith('dm:')) {
    const rest = v.slice(3);
    if (!rest) throw new ArgumentError('dm target must be "dm:<userId>" or "dm:@name".');
    if (UUID_RE.test(rest)) return { kind: 'dm-uuid', userId: rest };
    if (rest.startsWith('@')) return { kind: 'dm-name', name: rest.slice(1) };
    throw new ArgumentError('dm target must be "dm:<userId-uuid>" or "dm:@name".');
  }
  const tt = classifyThreadTarget(v);
  if (tt) return { kind: 'thread', ...tt };
  if (UUID_RE.test(v)) return { kind: 'channel-uuid', channelId: v };
  return { kind: 'channel-name', name: v.replace(/^#/, '').toLowerCase() };
}

const SHORT_ID_HINT =
  'short ids (the 8-hex `msg=...` form in channel headers) are NOT accepted — use the FULL UUID ' +
  'from `bookmark-list` / `message-read` output.';

export function assertMessageIdShape(messageId) {
  const v = String(messageId ?? '').trim();
  if (!v) throw new ArgumentError('messageId required');
  if (!UUID_RE.test(v)) {
    throw new ArgumentError(`messageId "${v}" is not a full UUID. ${SHORT_ID_HINT}`);
  }
  return v;
}

export function parsePositiveInteger(value, name, { defaultValue, max } = {}) {
  const raw = value === undefined || value === null || value === '' ? defaultValue : value;
  const n = parseStrictInteger(raw);
  if (!Number.isInteger(n) || n <= 0 || (max !== undefined && n > max)) {
    const suffix = max !== undefined ? ` between 1 and ${max}` : ' as a positive integer';
    throw new ArgumentError(`${name} must be${suffix} (got "${raw}")`);
  }
  return n;
}

export function parseNonNegativeInteger(value, name, { defaultValue } = {}) {
  const raw = value === undefined || value === null || value === '' ? defaultValue : value;
  const n = parseStrictInteger(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new ArgumentError(`${name} must be a non-negative integer (got "${raw}")`);
  }
  return n;
}

function parseStrictInteger(raw) {
  if (typeof raw === 'number')
    return raw;
  const text = String(raw);
  if (!/^\d+$/.test(text))
    return NaN;
  return Number(text);
}
