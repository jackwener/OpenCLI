/**
 * Compound-component expansion for high-agent-failure form controls.
 *
 * Agents burn turns on three recurring input categories because the raw
 * attribute dump from `browser state` under-specifies them:
 *
 *   - date / time / datetime-local / month / week — agents type
 *     free-form strings and the browser silently ignores mismatched formats.
 *   - select — the snapshot caps visible options at ~6; agents don't know
 *     the full option set, can't match by label, and waste turns clicking
 *     to open the dropdown just to read options.
 *   - file — the snapshot shows current filenames but not `accept` or
 *     `multiple`; agents re-upload or pick unsupported MIME types.
 *
 * `compoundInfoOf(el)` returns a structured JSON summary agents can rely
 * on. Included in `browser find --css` envelope so the agent gets the
 * rich view without extra round-trips.
 *
 * Emitted as a JS source string (`COMPOUND_INFO_JS`) so it can be inlined
 * into the generated evaluate scripts under find / snapshot / eval.
 */

export type DateLikeControl = 'date' | 'time' | 'datetime-local' | 'month' | 'week';

export interface DateCompound {
  control: DateLikeControl;
  format: string;
  current: string;
  min?: string;
  max?: string;
}

export interface SelectOption {
  label: string;
  value: string;
  selected: boolean;
  disabled?: boolean;
}

export interface SelectCompound {
  control: 'select';
  multiple: boolean;
  current: string | string[];
  options: SelectOption[];
  options_total: number;
}

export interface FileCompound {
  control: 'file';
  multiple: boolean;
  current: string[];
  accept?: string;
}

export type CompoundInfo = DateCompound | SelectCompound | FileCompound;

/** Max options included in a SelectCompound.options[]. Above this, `options_total` still reflects the true count. */
export const COMPOUND_SELECT_OPTIONS_CAP = 50;

/** Max characters per option label / file name. */
export const COMPOUND_LABEL_CAP = 80;

/**
 * JavaScript source declaring `compoundInfoOf(el)`. Inlined into the JS
 * emitted by `buildFindJs` (and any other evaluate script that needs the
 * rich compound view). Returns a `CompoundInfo` object or `null`.
 */
export const COMPOUND_INFO_JS = `
function compoundInfoOf(el) {
  if (!el || !el.tagName) return null;
  const tag = el.tagName;
  const LABEL_CAP = ${COMPOUND_LABEL_CAP};
  const OPTS_CAP = ${COMPOUND_SELECT_OPTIONS_CAP};
  if (tag === 'INPUT') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    const FORMATS = {
      'date': 'YYYY-MM-DD',
      'time': 'HH:MM',
      'datetime-local': 'YYYY-MM-DDTHH:MM',
      'month': 'YYYY-MM',
      'week': 'YYYY-W##',
    };
    if (FORMATS[type]) {
      const info = {
        control: type,
        format: FORMATS[type],
        current: (el.value == null ? '' : String(el.value)),
      };
      const min = el.getAttribute('min');
      if (min) info.min = min;
      const max = el.getAttribute('max');
      if (max) info.max = max;
      return info;
    }
    if (type === 'file') {
      const info = {
        control: 'file',
        multiple: !!el.multiple,
        current: [],
      };
      const accept = el.getAttribute('accept');
      if (accept) info.accept = accept;
      try {
        if (el.files && el.files.length) {
          for (let i = 0; i < el.files.length; i++) {
            const name = (el.files[i].name || '').slice(0, LABEL_CAP);
            info.current.push(name);
          }
        }
      } catch (_) {}
      return info;
    }
    return null;
  }
  if (tag === 'SELECT') {
    const multiple = !!el.multiple;
    const options = [];
    const selectedLabels = [];
    let total = 0;
    try {
      const opts = el.options || [];
      total = opts.length;
      // Walk ALL options so \`current\` reflects selections that sit beyond the
      // serialization cap. Only the first OPTS_CAP entries get pushed into
      // options[]; anything past the cap still contributes to selectedLabels
      // so agents see the true current state of big dropdowns.
      for (let i = 0; i < opts.length; i++) {
        const o = opts[i];
        const labelRaw = (o.label != null && o.label !== '') ? o.label : (o.text || '');
        const label = String(labelRaw).trim().slice(0, LABEL_CAP);
        if (i < OPTS_CAP) {
          const entry = { label: label, value: o.value, selected: !!o.selected };
          if (o.disabled) entry.disabled = true;
          options.push(entry);
        }
        if (o.selected) selectedLabels.push(label);
      }
    } catch (_) {}
    return {
      control: 'select',
      multiple: multiple,
      current: multiple ? selectedLabels : (selectedLabels[0] || ''),
      options: options,
      options_total: total,
    };
  }
  return null;
}
`;
