/**
 * AX-backed browser snapshot prototype.
 *
 * This is intentionally additive to the current DOM snapshot. It learns from
 * agent-browser's accessibility-tree refs without changing default `state`
 * output until the AX path proves itself on fixtures and real SaaS workflows.
 */

export interface BrowserRef {
  ref: string;
  backendNodeId?: number;
  role: string;
  name: string;
  nth?: number;
  frame?: { frameId?: string; sessionId?: string; url?: string; targetUrl?: string };
}

export interface AxSnapshotTree {
  tree: unknown;
  frame?: BrowserRef['frame'];
}

export interface AxSnapshotBuildResult {
  text: string;
  refs: Map<string, BrowserRef>;
}

interface AxValue {
  value?: unknown;
}

interface AxProperty {
  name?: string;
  value?: AxValue;
}

interface AxNode {
  nodeId?: string;
  ignored?: boolean;
  role?: AxValue;
  name?: AxValue;
  value?: AxValue;
  properties?: AxProperty[];
  childIds?: string[];
  backendDOMNodeId?: number;
}

const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'checkbox',
  'radio',
  'combobox',
  'listbox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'treeitem',
]);

const CONTENT_ROLES = new Set([
  'article',
  'cell',
  'columnheader',
  'gridcell',
  'heading',
  'listitem',
  'main',
  'navigation',
  'region',
  'rowheader',
]);

const STRUCTURAL_ROLES = new Set([
  'generic',
  'group',
  'list',
  'none',
  'presentation',
  'RootWebArea',
  'WebArea',
]);

export function buildAxSnapshot(
  axTree: unknown,
  opts: { maxDepth?: number; interactiveOnly?: boolean } = {},
): AxSnapshotBuildResult {
  return buildAxSnapshotFromTrees([{ tree: axTree }], opts);
}

export function buildAxSnapshotFromTrees(
  trees: AxSnapshotTree[],
  opts: { maxDepth?: number; interactiveOnly?: boolean } = {},
): AxSnapshotBuildResult {
  const lines: string[] = ['source: ax', '---'];
  const refs = new Map<string, BrowserRef>();
  let nextRef = 1;

  for (const [index, entry] of trees.entries()) {
    if (index > 0) {
      const label = entry.frame?.url ? JSON.stringify(entry.frame.url) : JSON.stringify(entry.frame?.frameId ?? `frame:${index}`);
      lines.push(`frame ${label}:`);
    }
    nextRef = renderAxTree(entry.tree, lines, refs, nextRef, {
      ...opts,
      frame: entry.frame,
      baseDepth: index > 0 ? 1 : 0,
    });
  }

  lines.push('---');
  lines.push(`interactive: ${refs.size}`);
  return { text: lines.join('\n'), refs };
}

function renderAxTree(
  axTree: unknown,
  lines: string[],
  refs: Map<string, BrowserRef>,
  nextRef: number,
  opts: { maxDepth?: number; interactiveOnly?: boolean; frame?: BrowserRef['frame']; baseDepth: number },
): number {
  const rawNodes = Array.isArray((axTree as { nodes?: unknown[] } | null)?.nodes)
    ? ((axTree as { nodes: unknown[] }).nodes as AxNode[])
    : [];
  const nodes = rawNodes.filter((node) => node && !node.ignored);
  const byId = new Map<string, AxNode>();
  const parentIds = new Set<string>();
  for (const node of nodes) {
    if (typeof node.nodeId === 'string') byId.set(node.nodeId, node);
    for (const childId of node.childIds ?? []) parentIds.add(childId);
  }

  const roots = nodes.filter((node) => {
    if (!node.nodeId) return false;
    const role = axString(node.role);
    return !parentIds.has(node.nodeId) || role === 'RootWebArea' || role === 'WebArea';
  });
  const root = roots[0] ?? nodes[0];
  const maxDepth = Math.max(1, Math.min(Number(opts.maxDepth) || 50, 200));
  const roleNameCounts = countRoleNames(nodes);
  const roleNameSeen = new Map<string, number>();

  function render(node: AxNode | undefined, depth: number): boolean {
    if (!node || depth > maxDepth) return false;
    const role = axString(node.role) || 'generic';
    const name = cleanText(axString(node.name));
    const value = cleanText(axString(node.value) || propertyValue(node, 'value'));
    const disabled = propertyValue(node, 'disabled');
    const checked = propertyValue(node, 'checked');
    const expanded = propertyValue(node, 'expanded');
    const selected = propertyValue(node, 'selected');

    const refEligible = shouldRef(role, name, node.backendDOMNodeId);
    const shouldShowSelf = refEligible
      || !!name
      || !!value
      || CONTENT_ROLES.has(role)
      || (!opts.interactiveOnly && !STRUCTURAL_ROLES.has(role));

    const childStart = lines.length;
    let hasVisibleChild = false;
    for (const childId of node.childIds ?? []) {
      if (render(byId.get(childId), depth + 1)) hasVisibleChild = true;
    }

    if (!shouldShowSelf && !hasVisibleChild) {
      lines.length = childStart;
      return false;
    }

    if (shouldShowSelf) {
      const indent = '  '.repeat(depth);
      const parts: string[] = [];
      let prefix = '';
      if (refEligible) {
        const ref = String(nextRef++);
        prefix = `[${ref}]`;
        const key = roleNameKey(role, name);
        const seen = roleNameSeen.get(key) ?? 0;
        roleNameSeen.set(key, seen + 1);
        refs.set(ref, {
          ref,
          backendNodeId: node.backendDOMNodeId,
          role,
          name,
          ...(roleNameCounts.get(key)! > 1 ? { nth: seen } : {}),
          ...(opts.frame ? { frame: opts.frame } : {}),
        });
      }
      if (name) parts.push(JSON.stringify(name));
      if (value && value !== name) parts.push(`value=${JSON.stringify(value)}`);
      if (checked) parts.push(`checked=${checked}`);
      if (expanded) parts.push(`expanded=${expanded}`);
      if (selected) parts.push(`selected=${selected}`);
      if (disabled === 'true') parts.push('disabled');
      lines.splice(childStart, 0, `${indent}${prefix}${role}${parts.length ? ` ${parts.join(' ')}` : ''}`);
    }

    return true;
  }

  render(root, opts.baseDepth);
  return nextRef;
}

export function findAxRefReplacement(axTree: unknown, ref: BrowserRef): BrowserRef | null {
  const nodes = Array.isArray((axTree as { nodes?: unknown[] } | null)?.nodes)
    ? ((axTree as { nodes: unknown[] }).nodes as AxNode[])
    : [];
  const targetNth = ref.nth ?? 0;
  let seen = 0;
  for (const node of nodes) {
    if (!node || node.ignored) continue;
    const role = axString(node.role);
    const name = cleanText(axString(node.name));
    if (role !== ref.role || name !== ref.name) continue;
    if (seen === targetNth) {
      if (typeof node.backendDOMNodeId !== 'number') return null;
      return { ...ref, backendNodeId: node.backendDOMNodeId };
    }
    seen++;
  }
  return null;
}

function shouldRef(role: string, name: string, backendNodeId: unknown): backendNodeId is number {
  if (typeof backendNodeId !== 'number') return false;
  if (INTERACTIVE_ROLES.has(role)) return true;
  return CONTENT_ROLES.has(role) && !!name;
}

function countRoleNames(nodes: AxNode[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    if (!node || node.ignored) continue;
    const role = axString(node.role);
    const name = cleanText(axString(node.name));
    if (!shouldRef(role, name, node.backendDOMNodeId)) continue;
    const key = roleNameKey(role, name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function roleNameKey(role: string, name: string): string {
  return `${role}\u0000${name}`;
}

function axString(value: AxValue | undefined): string {
  const raw = value?.value;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return '';
}

function propertyValue(node: AxNode, name: string): string {
  const prop = node.properties?.find((candidate) => candidate.name === name);
  return axString(prop?.value);
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 160);
}
