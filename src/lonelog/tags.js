/**
 * Lonelog tag parsing and serialisation.
 *
 * Tolerant in, canonical out (CLAUDE.md §5.3): accepts irregular whitespace,
 * `x`/`×` multipliers and `->`/`→` transitions; `serializeTag` emits one form.
 *
 * This module imports nothing. See CLAUDE.md §3.1.
 */

/** Tag types defined by core + the four vendored add-ons (CLAUDE.md §4.1). */
export const KNOWN_TAG_TYPES = new Map([
  ['pc', 'PC'], ['n', 'N'], ['l', 'L'], ['e', 'E'],
  ['thread', 'Thread'], ['clock', 'Clock'], ['track', 'Track'], ['timer', 'Timer'],
  ['f', 'F'], ['r', 'R'], ['inv', 'Inv'], ['wealth', 'Wealth'],
  ['unit', 'Unit'], ['force', 'Force'], ['scenario', 'Scenario'],
]);

/** Structural block names (CLAUDE.md §4.2). */
export const BLOCK_NAMES = new Set([
  'COMBAT', 'DUNGEON STATUS', 'RESOURCES', 'BATTLE', 'CAMPAIGN',
]);

const RE_MULT = /^(.*?)\s*[x×]\s*(\d+)$/i;
const RE_PROGRESS = /^(.*?)\s+(\d+)\s*\/\s*(\d+)$/;
const RE_TRANSITION = /^(.*?)\s*(?:->|→)\s*(.*)$/;
const RE_TRAILING_NUM = /^(.*\S)\s+(-?\d+(?:\.\d+)?)$/;
const RE_NAME_DELTA = /^(.*?[^\s+-])\s*([+-])\s*(\d+)$/;

/**
 * Scan a line for bracket groups, respecting depth.
 * @param {string} text
 * @returns {{start:number,end:number,inner:string}[]}
 */
export function scanBrackets(text) {
  const out = [];
  let depth = 0, start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '[') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === ']') {
      if (depth > 0) {
        depth--;
        if (depth === 0) out.push({ start, end: i + 1, inner: text.slice(start + 1, i) });
      }
    }
  }
  return out;
}

/**
 * Decide what a bracket group is.
 *
 * Roll context (core §4.1.9) and tags share `[word: ...]` shape, so the type
 * token is checked against the known set first; on a `d:` line an unknown type
 * before the resolution arrow is roll context rather than an unknown tag.
 *
 * @param {string} inner
 * @param {{diceLine?:boolean, beforeArrow?:boolean}} [ctx]
 * @returns {'tag'|'rollContext'|'annotation'}
 */
export function classifyBracket(inner, ctx = {}) {
  const s = inner.trim();
  if (!s) return 'annotation';
  const m = /^#?\s*([^:|]+?)\s*:/.exec(s);
  if (!m) {
    // No colon: movement `[Far->Close]`, stage direction `[whispers]`.
    return 'annotation';
  }
  if (KNOWN_TAG_TYPES.has(m[1].trim().toLowerCase())) return 'tag';
  if (ctx.diceLine && ctx.beforeArrow) return 'rollContext';
  return 'tag'; // tolerant: unknown type, still a tag
}

/**
 * Parse one field of a tag body.
 * @param {string} raw
 * @returns {object} field
 */
export function parseField(raw) {
  const f = {
    raw, op: 'set', key: null, value: null,
    count: null, delta: null, progress: null, transition: null, list: null,
  };
  let s = raw.trim();
  if (!s) { f.value = ''; return f; }

  // `+flag` / `-flag` add/remove shorthand (core §4.1.1). Digits after the sign
  // are a delta on a bare value, not an add/remove.
  if (/^[+-]\s*[A-Za-z]/.test(s)) {
    f.op = s[0] === '+' ? 'add' : 'remove';
    s = s.slice(1).trim();
  }

  // Bare multiplier field: `x12` (wargaming §2).
  let m = /^[x×]\s*(\d+)$/i.exec(s);
  if (m) { f.count = Number(m[1]); f.value = s; return f; }

  // `exits N:R2, E:R5` — a dungeon keyword, not a category (dungeon §2).
  m = /^exits\b\s*:?\s*(.*)$/i.exec(s);
  if (m) {
    f.key = 'exits';
    f.value = m[1].trim();
    f.exits = f.value.split(',').map((part) => {
      const e = /^\s*([A-Za-z]{1,2})\s*:\s*(.+?)\s*$/.exec(part);
      return e ? { dir: e[1].toUpperCase(), to: e[2] } : { dir: null, to: part.trim() };
    }).filter((x) => x.to);
    return f;
  }

  // Category syntax `trait: friendly, curious` (core §4.1.7). The key is a
  // single word — `exits S:R2` above is a keyword phrase, not a category.
  m = /^([A-Za-z][\w'-]*)\s*:\s*(.*)$/.exec(s);
  if (m && !/^(https?)$/i.test(m[1])) {
    f.key = m[1].trim();
    f.category = true;
    const rest = m[2].trim();
    const t = RE_TRANSITION.exec(rest);
    if (t && t[1].trim()) {
      f.transition = { from: t[1].trim(), to: t[2].trim() };
      f.value = rest;
    } else if (rest.includes(',')) {
      f.list = rest.split(',').map((x) => x.trim()).filter(Boolean);
      f.value = rest;
    } else {
      f.value = rest;
    }
    return f;
  }

  // `Key 3/6` progress (core §4.2).
  m = RE_PROGRESS.exec(s);
  if (m) {
    f.key = m[1].trim() || null;
    f.progress = { current: Number(m[2]), total: Number(m[3]) };
    f.value = s;
    return f;
  }

  // `Key 5 -> 4`, `Supply d8->d6`, `rusty -> repaired` (core §4.1.1).
  m = RE_TRANSITION.exec(s);
  if (m && m[1].trim() && m[2].trim()) {
    const from = m[1].trim(), to = m[2].trim();
    const km = RE_TRAILING_NUM.exec(from);
    const dm = /^(.*?\S)\s+(\S+)$/.exec(from);
    if (km) { f.key = km[1].trim(); f.transition = { from: km[2], to }; }
    else if (dm && /^d\d+$/i.test(dm[2])) { f.key = dm[1].trim(); f.transition = { from: dm[2], to }; }
    else f.transition = { from, to };
    f.value = s;
    return f;
  }

  // `HP-2`, `HP+3`, `Gold+15` (core §4.1.5, resources §3.1).
  m = RE_NAME_DELTA.exec(s);
  if (m) {
    f.key = m[1].trim();
    f.delta = { sign: m[2], amount: Number(m[3]) };
    f.value = s;
    return f;
  }

  // `HP 12`, `Morale 8`, `Timer 3`.
  m = RE_TRAILING_NUM.exec(s);
  if (m) { f.key = m[1].trim(); f.value = m[2]; return f; }

  // `Armor CT30/RT25/LT25`, `HP 3 each`, `charges 2/5`. A leading word followed
  // by a digit-bearing token reads as key + value; a run of plain words
  // (`dusty shelves`, `Ward of the Dead`) stays a flag.
  m = /^([A-Za-z][\w'-]*)\s+(\S+.*)$/.exec(s);
  if (m && /\d/.test(m[2].split(/\s+/)[0])) {
    f.key = m[1].trim();
    f.value = m[2].trim();
    return f;
  }

  f.value = s;
  return f;
}

/**
 * Parse a full bracketed tag, e.g. `[PC:Kael|HP 12/15|Supply d6]`.
 * @param {string} raw including the surrounding brackets
 * @returns {object|null} null when the text is not tag-shaped
 */
export function parseTag(raw) {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  let body = trimmed.slice(1, -1);

  let ref = false;
  body = body.replace(/^\s*#\s*/, () => { ref = true; return ''; });

  const ci = body.indexOf(':');
  if (ci === -1) return null;
  const typeRaw = body.slice(0, ci).trim();
  if (!typeRaw || typeRaw.includes('|')) return null;

  const rest = body.slice(ci + 1);
  const parts = splitFields(rest);
  const head = (parts.shift() ?? '').trim();

  const tag = {
    raw: trimmed,
    ref,
    typeRaw,
    type: KNOWN_TAG_TYPES.get(typeRaw.toLowerCase()) ?? typeRaw,
    known: KNOWN_TAG_TYPES.has(typeRaw.toLowerCase()),
    name: head,
    count: null,
    head: null,
    fields: parts.map(parseField),
    multiline: /\n/.test(raw),
  };

  parseHead(tag, head);
  return tag;
}

/** Split a tag body on `|`, ignoring separators nested in brackets. */
function splitFields(s) {
  const out = [];
  let depth = 0, cur = '';
  for (const c of s) {
    if (c === '[') depth++;
    else if (c === ']') depth--;
    else if (c === '|' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * The segment between `Type:` and the first `|` carries the name and, for some
 * types, a value: `[Clock:Ritual 5/12]`, `[Timer:Dawn 3]`, `[Wealth:Gold+15]`,
 * `[F:Skeletonx3]`, `[Inv:Torch-1]`.
 */
function parseHead(tag, head) {
  let s = head.trim();

  let m = RE_PROGRESS.exec(s);
  if (m) {
    tag.name = m[1].trim();
    tag.head = { kind: 'progress', current: Number(m[2]), total: Number(m[3]) };
    return;
  }

  m = RE_TRANSITION.exec(s);
  if (m && m[1].trim() && m[2].trim()) {
    const km = RE_TRAILING_NUM.exec(m[1].trim());
    if (km) {
      tag.name = km[1].trim();
      tag.head = { kind: 'transition', from: km[2], to: m[2].trim() };
      return;
    }
  }

  m = RE_MULT.exec(s);
  if (m && m[1].trim()) {
    tag.name = m[1].trim();
    tag.count = Number(m[2]);
    return;
  }

  m = RE_NAME_DELTA.exec(s);
  if (m) {
    tag.name = m[1].trim();
    tag.head = { kind: 'delta', sign: m[2], amount: Number(m[3]) };
    return;
  }

  m = RE_TRAILING_NUM.exec(s);
  if (m) {
    tag.name = m[1].trim();
    tag.head = { kind: 'value', value: m[2] };
    return;
  }

  tag.name = s;
}

/**
 * Emit the canonical form of a tag (CLAUDE.md §5.3).
 * @param {object} tag
 * @returns {string}
 */
export function serializeTag(tag) {
  let head = tag.name;
  if (tag.count != null) head += `x${tag.count}`;
  const h = tag.head;
  if (h?.kind === 'progress') head += ` ${h.current}/${h.total}`;
  else if (h?.kind === 'transition') head += ` ${h.from}->${h.to}`;
  else if (h?.kind === 'delta') head += `${h.sign}${h.amount}`;
  else if (h?.kind === 'value') head += ` ${h.value}`;

  const fields = tag.fields.map(serializeField);
  return `[${tag.ref ? '#' : ''}${tag.type}:${[head, ...fields].join('|')}]`;
}

/** @param {object} f */
export function serializeField(f) {
  const sign = f.op === 'add' ? '+' : f.op === 'remove' ? '-' : '';
  if (f.count != null && f.key == null && !f.transition) return `${sign}x${f.count}`;
  if (f.key && f.transition) return `${sign}${f.key} ${f.transition.from}->${f.transition.to}`;
  if (f.key && f.progress) return `${sign}${f.key} ${f.progress.current}/${f.progress.total}`;
  if (f.key && f.delta) return `${sign}${f.key}${f.delta.sign}${f.delta.amount}`;
  if (f.key && f.list) return `${sign}${f.key}: ${f.list.join(', ')}`;
  if (f.key === 'exits') return `${sign}exits ${f.value}`;
  if (f.key && f.category) return `${sign}${f.key}: ${f.value}`;
  if (f.key) return `${sign}${f.key} ${f.value}`;
  if (f.transition) return `${sign}${f.transition.from} -> ${f.transition.to}`;
  if (f.progress) return `${sign}${f.progress.current}/${f.progress.total}`;
  return `${sign}${f.value}`;
}

/**
 * Pull every tag, roll-context group and annotation out of a line.
 * @param {string} text
 * @param {{diceLine?:boolean}} [opts]
 */
export function extractTags(text, opts = {}) {
  const groups = scanBrackets(text);
  const arrowAt = opts.diceLine ? findArrow(text) : -1;
  const tags = [], rollContext = [], annotations = [];

  for (const g of groups) {
    const kind = classifyBracket(g.inner, {
      diceLine: !!opts.diceLine,
      beforeArrow: arrowAt === -1 ? true : g.start < arrowAt,
    });
    if (kind === 'tag') {
      const t = parseTag(text.slice(g.start, g.end));
      if (t) { t.span = [g.start, g.end]; tags.push(t); continue; }
      annotations.push({ raw: g.inner, span: [g.start, g.end] });
    } else if (kind === 'rollContext') {
      rollContext.push({ raw: g.inner, span: [g.start, g.end] });
    } else {
      annotations.push({ raw: g.inner, span: [g.start, g.end] });
    }
  }

  let stripped = text;
  for (const t of [...tags].reverse()) {
    stripped = stripped.slice(0, t.span[0]) + stripped.slice(t.span[1]);
  }
  return { tags, rollContext, annotations, stripped: stripped.replace(/\s+/g, ' ').trim() };
}

/** Index of the resolution arrow outside any bracket group, or -1. */
function findArrow(text) {
  let depth = 0;
  for (let i = 0; i < text.length - 1; i++) {
    const c = text[i];
    if (c === '[') depth++;
    else if (c === ']') depth--;
    else if (depth === 0 && c === '-' && text[i + 1] === '>') return i;
    else if (depth === 0 && c === '→') return i;
  }
  return -1;
}
