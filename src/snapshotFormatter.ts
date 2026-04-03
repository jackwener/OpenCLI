/**
 * Aria snapshot formatter: parses snapshot text into clean format.
 *
 * 4-pass pipeline:
 * 1. Parse & filter: strip annotations, metadata, noise, ads, boilerplate subtrees
 * 2. Deduplicate: generic/text parent match, heading+link, nested identical links
 * 3. Prune: empty containers (iterative bottom-up)
 * 4. Collapse: single-child containers
 */

import type { SnapshotOptions } from './types.js';

const DEFAULT_MAX_TEXT_LENGTH = 200;

// Roles that are pure noise and should always be filtered
const NOISE_ROLES = new Set([
  'none', 'presentation', 'separator', 'paragraph', 'tooltip', 'status',
]);

// Roles whose entire subtree should be removed (footer boilerplate, etc.)
const SUBTREE_NOISE_ROLES = new Set([
  'contentinfo',
]);

// Roles considered interactive (clickable/typeable)
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio',
  'combobox', 'tab', 'menuitem', 'option', 'switch',
  'slider', 'spinbutton', 'searchbox',
]);

// Structural landmark roles kept even in interactive mode
const LANDMARK_ROLES = new Set([
  'main', 'navigation', 'banner', 'heading', 'search',
  'region', 'list', 'listitem', 'article', 'complementary',
  'group', 'toolbar', 'tablist',
]);

// Container roles eligible for pruning and collapse
const CONTAINER_ROLES = new Set([
  'list', 'listitem', 'group', 'toolbar', 'tablist',
  'navigation', 'region', 'complementary',
  'search', 'article', 'paragraph', 'figure',
]);

// Decorator / separator text that adds no semantic value
const DECORATOR_TEXT = new Set(['•', '·', '|', '—', '-', '/', '\\']);

// Ad-related URL patterns
const AD_URL_PATTERNS = [
  'googleadservices.com/pagead/',
  'alb.reddit.com/cr?',
  'doubleclick.net/',
  'cm.bilibili.com/cm/api/fees/',
];

// Boilerplate button labels to filter (back-to-top, etc.)
const BOILERPLATE_LABELS = [
  '回到顶部', 'back to top', 'scroll to top', 'go to top',
];

/**
 * Parse role and text from a trimmed snapshot line.
 * Handles quoted labels and trailing text after colon correctly,
 * including lines wrapped in single quotes.
 */
function parseLine(trimmed: string): { role: string; text: string; hasText: boolean; trailingText: string } {
  // Unwrap outer single quotes if present (snapshot wraps lines with special chars)
  let line = trimmed;
  if (line.startsWith("'") && line.endsWith("':")) {
    line = line.slice(1, -2) + ':';
  } else if (line.startsWith("'") && line.endsWith("'")) {
    line = line.slice(1, -1);
  }

  // Role is the first word
  const roleMatch = line.match(/^([a-zA-Z]+)\b/);
  const role = roleMatch ? roleMatch[1].toLowerCase() : '';

  // Extract quoted text content (the semantic label)
  const textMatch = line.match(/"([^"]*)"/);
  const text = textMatch ? textMatch[1] : '';

  // For trailing text: strip annotations and quoted strings first, then check after last colon
  // This avoids matching colons inside quoted labels like "Account: user@email.com"
  let stripped = line;
  // Remove all quoted strings
  stripped = stripped.replace(/"[^"]*"/g, '""');
  // Remove all bracket annotations
  stripped = stripped.replace(/\[[^\]]*\]/g, '');

  const colonIdx = stripped.lastIndexOf(':');
  let trailingText = '';
  if (colonIdx !== -1) {
    const afterColon = stripped.slice(colonIdx + 1).trim();
    if (afterColon.length > 0) {
      // Get the actual trailing text from original line at same position
      const origColonIdx = line.lastIndexOf(':');
      if (origColonIdx !== -1) {
        trailingText = line.slice(origColonIdx + 1).trim();
      }
    }
  }

  return { role, text, hasText: text.length > 0 || trailingText.length > 0, trailingText };
}

/**
 * Strip ALL bracket annotations from a content line, preserving quoted strings.
 * Handles both double-quoted and outer single-quoted lines.
 */
function stripAnnotations(content: string): string {
  // Unwrap outer single quotes first
  let line = content;
  if (line.startsWith("'") && (line.endsWith("':") || line.endsWith("'"))) {
    if (line.endsWith("':")) {
      line = line.slice(1, -2) + ':';
    } else {
      line = line.slice(1, -1);
    }
  }

  // Split by double quotes to protect quoted content
  const parts = line.split('"');
  for (let i = 0; i < parts.length; i += 2) {
    // Only strip annotations from non-quoted parts (even indices)
    parts[i] = parts[i].replace(/\s*\[[^\]]*\]/g, '');
  }
  let result = parts.join('"').replace(/\s{2,}/g, ' ').trim();

  return result;
}

/**
 * Check if a line is a metadata-only line (like /url: ...).
 */
function isMetadataLine(trimmed: string): boolean {
  return /^\/[a-zA-Z]+:/.test(trimmed);
}

/**
 * Check if text content is purely decorative (separators, dots, etc.)
 */
function isDecoratorText(text: string): boolean {
  return DECORATOR_TEXT.has(text.trim());
}

/**
 * Check if a node is ad-related based on its text content.
 */
function isAdNode(text: string, trailingText: string): boolean {
  const t = (text + ' ' + trailingText).toLowerCase();
  if (t.includes('sponsored') || t.includes('advertisement')) return true;
  if (t.includes('广告')) return true;
  // Check for ad tracking URLs in the label
  for (const pattern of AD_URL_PATTERNS) {
    if (text.includes(pattern) || trailingText.includes(pattern)) return true;
  }
  return false;
}

/**
 * Check if a node is boilerplate UI (back-to-top, etc.)
 */
function isBoilerplateNode(text: string): boolean {
  const t = text.toLowerCase();
  return BOILERPLATE_LABELS.some(label => t.includes(label));
}

/**
 * Check if a role is noise that should be filtered.
 */
function isNoiseNode(role: string, hasText: boolean, text: string, trailingText: string): boolean {
  if (NOISE_ROLES.has(role)) return true;
  // generic without text is a wrapper
  if (role === 'generic' && !hasText) return true;
  // img without alt text is noise
  if (role === 'img' && !hasText) return true;
  // Decorator-only text nodes
  if ((role === 'generic' || role === 'text') && hasText) {
    const content = trailingText || text;
    if (isDecoratorText(content)) return true;
  }
  return false;
}

interface Entry {
  depth: number;
  content: string;
  role: string;
  text: string;
  trailingText: string;
  isInteractive: boolean;
  isLandmark: boolean;
}

export function formatSnapshot(raw: string, opts: SnapshotOptions = {}): string {
  if (!raw || typeof raw !== 'string') return '';

  const maxTextLen = opts.maxTextLength ?? DEFAULT_MAX_TEXT_LENGTH;
  const lines = raw.split('\n');

  // === Pass 1: Parse, filter, and collect entries (merged with ad/boilerplate subtree skip) ===
  const parsed: Entry[] = [];
  let refCounter = 0;
  let skipUntilDepth = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const indent = line.length - line.trimStart().length;
    const depth = Math.floor(indent / 2);

    // Subtree skip zone (noise roles, ads, boilerplate)
    if (skipUntilDepth >= 0) {
      if (depth > skipUntilDepth) continue;
      skipUntilDepth = -1;
    }

    let content = line.trimStart();
    if (content.startsWith('- ')) content = content.slice(2);
    if (isMetadataLine(content)) continue;
    if (opts.maxDepth !== undefined && depth > opts.maxDepth) continue;

    const { role, text, hasText, trailingText } = parseLine(content);

    if (isNoiseNode(role, hasText, text, trailingText)) continue;

    // Subtree noise roles (contentinfo footer, etc.)
    if (SUBTREE_NOISE_ROLES.has(role)) { skipUntilDepth = depth; continue; }

    // Ads and boilerplate — skip entire subtree (merged from old Pass 2)
    if (isAdNode(text, trailingText) || isBoilerplateNode(text)) { skipUntilDepth = depth; continue; }

    content = stripAnnotations(content);

    const isInteractive = INTERACTIVE_ROLES.has(role);
    const isLandmark = LANDMARK_ROLES.has(role);
    if (opts.interactive && !isInteractive && !isLandmark && !hasText) continue;

    if (opts.compact) {
      content = content.replace(/\s*\[.*?\]\s*/g, ' ').replace(/\s+/g, ' ').trim();
    }
    if (maxTextLen > 0 && content.length > maxTextLen) {
      content = content.slice(0, maxTextLen) + '…';
    }
    if (isInteractive) {
      refCounter++;
      content = `[@${refCounter}] ${content}`;
    }

    parsed.push({ depth, content, role, text, trailingText, isInteractive, isLandmark });
  }

  // === Pass 2: Deduplicate (merged: generic/text parent match + heading+link + nested links) ===
  const deduped: Entry[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i];

    // Dedup: generic/text child matching parent label
    if (entry.role === 'generic' || entry.role === 'text') {
      let parent: Entry | undefined;
      for (let j = deduped.length - 1; j >= 0; j--) {
        if (deduped[j].depth < entry.depth) { parent = deduped[j]; break; }
        if (deduped[j].depth === entry.depth) break;
      }
      if (parent) {
        const childText = entry.trailingText || entry.text;
        if (childText && parent.text && childText === parent.text) continue;
      }
    }

    // Dedup: heading + child link with identical label
    if (entry.role === 'heading' && entry.text) {
      const next = parsed[i + 1];
      if (next && next.role === 'link' && next.text === entry.text && next.depth === entry.depth + 1) {
        deduped.push(entry);
        i++; // skip the link, preserve its children
        continue;
      }
    }

    // Dedup: nested identical links (skip parent, keep child)
    if (entry.role === 'link' && entry.text) {
      const next = parsed[i + 1];
      if (next && next.role === 'link' && next.text === entry.text && next.depth === entry.depth + 1) {
        continue;
      }
    }

    deduped.push(entry);
  }

  // === Pass 3: Iteratively prune empty containers (bottom-up) ===
  let current = deduped;
  let changed = true;
  while (changed) {
    changed = false;
    const next: Entry[] = [];
    for (let i = 0; i < current.length; i++) {
      const entry = current[i];
      if (CONTAINER_ROLES.has(entry.role) && !entry.text && !entry.trailingText) {
        let hasChildren = false;
        for (let j = i + 1; j < current.length; j++) {
          if (current[j].depth <= entry.depth) break;
          if (current[j].depth > entry.depth) { hasChildren = true; break; }
        }
        if (!hasChildren) { changed = true; continue; }
      }
      next.push(entry);
    }
    current = next;
  }

  // === Pass 4: Collapse single-child containers ===
  const collapsed: Entry[] = [];
  for (let i = 0; i < current.length; i++) {
    const entry = current[i];

    if (CONTAINER_ROLES.has(entry.role) && !entry.text && !entry.trailingText) {
      let childCount = 0;
      let childIdx = -1;
      for (let j = i + 1; j < current.length; j++) {
        if (current[j].depth <= entry.depth) break;
        if (current[j].depth === entry.depth + 1) {
          childCount++;
          if (childCount === 1) childIdx = j;
        }
      }

      if (childCount === 1 && childIdx !== -1) {
        const child = current[childIdx];
        let hasGrandchildren = false;
        for (let j = childIdx + 1; j < current.length; j++) {
          if (current[j].depth <= child.depth) break;
          if (current[j].depth > child.depth) { hasGrandchildren = true; break; }
        }

        if (!hasGrandchildren) {
          collapsed.push({
            ...entry,
            content: entry.content.replace(/:$/, '') + ' > ' + child.content,
            role: child.role,
            text: child.text,
            trailingText: child.trailingText,
            isInteractive: child.isInteractive,
          });
          i++;
          continue;
        }
      }
    }

    collapsed.push(entry);
  }

  return collapsed.map(e => '  '.repeat(e.depth) + e.content).join('\n');
}
