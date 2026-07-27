/**
 * Lonelog lexer: text -> Entry[].
 *
 * Losslessness is the contract (CLAUDE.md §5.2). Every entry keeps its exact
 * source in `raw` plus its line terminator in `eol`, so `render()` can rebuild
 * the input byte for byte. Classification is advisory on top of that.
 */

import { extractTags, BLOCK_NAMES } from './tags.js';

/**
 * @typedef {{kind:string, raw:string, eol:string, line:number, indent:number,
 *   [key:string]: any}} Entry
 */

export const KINDS = /** @type {const} */ ([
  'blank', 'frontmatter', 'fence', 'heading',
  'narrativeOpen', 'narrativeClose', 'narrative',
  'block', 'marker', 'action', 'question', 'dice', 'resolution',
  'consequence', 'tbl', 'gen', 'note', 'dialogue', 'sessionMeta',
  'metaField', 'tableEntry', 'genAxis', 'tag', 'prose',
]);

const RE_SCENE = /^(T(\d+)-)?S(\d+)([a-z])?(?:\.(\d+))?\b/;
const RE_ROUND = /^Rd(\d+)\b/;
const RE_TURN = /^Tn(\d+)\b/;
const RE_BLOCK_BRACKET = /^\[\s*(\/?)\s*([A-Z][A-Z ]*?)\s*\]$/;
const RE_BLOCK_ANALOG = /^---\s*(END\s+)?([A-Z][A-Z ]*?)\s*---$/;
// Long in-fiction block (core §4.4). The prose names `\---` / `---\`, but the
// section's own example opens with `\--`, so two dashes are accepted (§5.3).
const RE_NARRATIVE_OPEN = /^\\-{2,}/;
const RE_NARRATIVE_CLOSE = /-{2,}\\$/;
/**
 * Analog campaign and session header fields (core §5.1, §5.2.2): `[Date]` with
 * its value on the same line or the next. A closed vocabulary — the specs list
 * every key — so an ordinary bracketed aside is never mistaken for one.
 */
const RE_META_FIELD = /^\[\s*([A-Za-z][A-Za-z ]*?)\s*\]\s*(.*)$/;
export const CAMPAIGN_META_KEYS = new Set([
  'title', 'ruleset', 'genre', 'player', 'pcs', 'start date', 'last update',
  'tools', 'themes', 'tone', 'setting', 'inspiration', 'safety tools',
]);
export const SESSION_META_KEYS = new Set([
  'date', 'duration', 'scenes', 'recap', 'goals', 'mood', 'threads',
]);
// `[Notes]` is offered by both headers, so it belongs to whichever is open.
const SHARED_META_KEYS = new Set(['notes']);
const RE_HEADING = /^(#{1,6})\s+(.*)$/;
const RE_DIALOGUE = /^(N|PC)\s*(\(([^)]*)\))?\s*:\s*(.*)$/;
// `*Date: 2025-09-03 | Duration: 1h30 | Scenes: S1-S2*` under a session heading
// (core §5.2.1). Requires a `Key: value` opener so ordinary italic prose is not
// swallowed.
const RE_SESSION_META = /^\*\s*([A-Z][A-Za-z ]*:[^*]*)\*$/;
// Inline table definitions and multi-axis generators (core §4.3.1–3) put their
// bodies on the lines that follow the header, so the lexer carries a small
// amount of context.
const RE_TABLE_ENTRY = /^(\d+)\s*(?:[-–]\s*(\d+))?\s*:\s*(.+)$/;
const RE_GEN_AXIS = /^([A-Za-z][\w '-]*?)\s*:\s*(.+)$/;
const RE_ARROW = /\s*(?:->|→)\s*/;

/**
 * @param {string} text
 * @returns {Entry[]}
 */
export function lex(text) {
  const lines = splitLines(text);
  /** @type {Entry[]} */
  const entries = [];

  let inFence = false;
  let inFrontmatter = false;
  let inNarrative = false;
  /** Analog blocks currently open, so an abbreviated closer can find its own. */
  const analogStack = [];
  /** @type {null|'table'|'gen'} */
  let body = null;
  let i = 0;

  while (i < lines.length) {
    const { text: raw, eol } = lines[i];
    const s = raw.trim();
    const base = { raw, eol, line: i, indent: raw.length - raw.trimStart().length };

    // YAML front matter, only when it opens the document (core §5.1).
    if (i === 0 && s === '---') {
      inFrontmatter = true;
      entries.push({ ...base, kind: 'frontmatter', delimiter: true });
      i++; continue;
    }
    if (inFrontmatter) {
      const delimiter = s === '---';
      if (delimiter) inFrontmatter = false;
      // Core §5.1 writes a real `[PC:]` tag into the header's `pcs:` line, so
      // the header's tags are carried like any other line's.
      entries.push({ ...base, kind: 'frontmatter', delimiter, ...(delimiter ? {} : tagPayload(s)) });
      i++; continue;
    }

    if (/^```/.test(s)) {
      inFence = !inFence;
      entries.push({ ...base, kind: 'fence', open: inFence });
      i++; continue;
    }

    if (s === '') { body = null; entries.push({ ...base, kind: 'blank' }); i++; continue; }

    // Long in-fiction block, asymmetric delimiters (core §4.4).
    if (RE_NARRATIVE_OPEN.test(s)) {
      // Opened and closed on one line — `\--- The fog rolls in. ---\`. Without
      // this the block never closes and swallows the rest of the log.
      const selfClosed = RE_NARRATIVE_CLOSE.test(s.replace(RE_NARRATIVE_OPEN, ''));
      inNarrative = !selfClosed;
      entries.push({ ...base, kind: 'narrativeOpen', selfClosed });
      i++; continue;
    }
    if (inNarrative) {
      if (RE_NARRATIVE_CLOSE.test(s)) {
        inNarrative = false;
        entries.push({ ...base, kind: 'narrativeClose' });
      } else {
        entries.push({ ...base, kind: 'narrative' });
      }
      i++; continue;
    }

    // Multi-line tag form (core §4.1.8): `[PC:Jonah` ... `]`.
    if (/^\[[A-Za-z#]/.test(s) && !s.includes(']')) {
      const start = i;
      let joined = raw, lastEol = eol;
      i++;
      while (i < lines.length && !lines[i].text.includes(']')) {
        joined += lastEol + lines[i].text;
        lastEol = lines[i].eol;
        i++;
      }
      if (i < lines.length) {
        joined += lastEol + lines[i].text;
        lastEol = lines[i].eol;
        i++;
      }
      entries.push({
        ...base, line: start, kind: 'tag', raw: joined, eol: lastEol,
        multiline: true, ...tagPayload(joined),
      });
      continue;
    }

    if (!inFence) {
      const h = RE_HEADING.exec(s);
      if (h) {
        // The digital form of a scene, round or turn marker is a markdown
        // heading — `### S1 *School library after hours*` (core §5.3, and every
        // digital example in §2.4 and §6). Read the marker out of the heading,
        // or a log written the way the spec writes them folds with no scenes at
        // all, and a block opened in a scene header never opens (combat §1.1).
        const inner = /** @type {Record<string, any>} */ (classify(h[2], body));
        if (inner.kind === 'marker') {
          entries.push(/** @type {Entry} */ (
            /** @type {unknown} */ ({ ...base, ...inner, level: h[1].length, heading: true })));
          body = null;
          i++; continue;
        }
        entries.push({ ...base, kind: 'heading', level: h[1].length, title: h[2] });
        i++; continue;
      }
    }

    const bb = RE_BLOCK_BRACKET.exec(s);
    if (bb && BLOCK_NAMES.has(bb[2])) {
      entries.push({ ...base, kind: 'block', name: bb[2], closing: bb[1] === '/', form: 'digital' });
      i++; continue;
    }
    const ba = RE_BLOCK_ANALOG.exec(s);
    if (ba) {
      const named = ba[2].trim();
      // A block's analog closer may abbreviate its name: dungeon §3 closes
      // `--- DUNGEON STATUS ---` with `--- END STATUS ---`. Match the innermost
      // open analog block by its last word rather than demanding the full name,
      // or the block never closes and the stack leaks for the rest of the log.
      const closes = ba[1]
        ? (BLOCK_NAMES.has(named) ? named : matchOpenBlock(analogStack, named))
        : null;
      const name = ba[1] ? closes : (BLOCK_NAMES.has(named) ? named : null);
      if (name) {
        if (ba[1]) analogStack.pop();
        else analogStack.push(name);
        entries.push({ ...base, kind: 'block', name, closing: !!ba[1], form: 'analog' });
        i++; continue;
      }
    }

    const mf = RE_META_FIELD.exec(s);
    if (mf && isMetaKey(mf[1])) {
      entries.push({
        ...base, kind: 'metaField', metaKey: mf[1].trim(), text: mf[2].trim(),
        scope: metaScope(mf[1]),
      });
      i++; continue;
    }

    const classified = /** @type {Record<string, any>} */ (classify(s, body));
    body = classified.kind === 'tbl' && classified.table?.kind === 'definition' ? 'table'
      : classified.kind === 'gen' && classified.generator ? 'gen'
        : classified.kind === 'tableEntry' ? 'table'
          : classified.kind === 'genAxis' ? 'gen'
            : null;
    entries.push(/** @type {Entry} */ ({ ...base, ...classified }));
    i++;
  }

  return entries;
}

/** The innermost open analog block whose name ends with `named`, if any. */
function matchOpenBlock(stack, named) {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i] === named || stack[i].endsWith(` ${named}`)) return stack[i];
  }
  return null;
}

function isMetaKey(key) {
  const k = key.trim().toLowerCase();
  return CAMPAIGN_META_KEYS.has(k) || SESSION_META_KEYS.has(k) || SHARED_META_KEYS.has(k);
}

/** @returns {'campaign'|'session'|'either'} */
function metaScope(key) {
  const k = key.trim().toLowerCase();
  if (CAMPAIGN_META_KEYS.has(k)) return 'campaign';
  if (SESSION_META_KEYS.has(k)) return 'session';
  return 'either';
}

/** Split preserving terminators so round-trip is exact. */
function splitLines(text) {
  const out = [];
  const re = /([^\n]*)(\r?\n|$)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ text: m[1], eol: m[2] });
    if (m[0] === '' || re.lastIndex >= text.length) break;
  }
  // A trailing terminator yields a final empty record; drop it so the eol stays
  // attached to the line that produced it.
  if (out.length && out[out.length - 1].text === '' && out[out.length - 1].eol === '') out.pop();
  return out;
}

/**
 * Classify a non-structural line and attach its tags.
 * @param {string} s
 * @param {null|'table'|'gen'} [body] whether we are inside a table or generator
 * @returns {Record<string, any>}
 */
function classify(s, body = null) {
  // Scene / round / turn markers may prefix a line of notation (core §5.3,
  // combat §2, wargaming §1).
  const marker = readMarker(s);
  if (marker) {
    const rest = s.slice(marker.length).trim();
    // A block may open inside a scene header — `S5 *Warehouse ambush* [COMBAT]`
    // — and is closed by the next scene marker rather than a closing tag
    // (combat §1.1).
    const inline = /\[([A-Z][A-Z ]*)\]/.exec(rest);
    return {
      kind: 'marker', marker: marker.marker, rest,
      opensBlock: inline && BLOCK_NAMES.has(inline[1]) ? inline[1] : null,
      ...tagPayload(rest), segments: segment(rest),
    };
  }

  if (/^@/.test(s)) {
    const m = /^@\s*(\(([^)]*)\))?\s*(.*)$/.exec(s);
    return { kind: 'action', actor: m?.[2]?.trim() || null, text: m?.[3] ?? '', ...tagPayload(s) };
  }
  if (/^\?/.test(s)) return { kind: 'question', text: s.slice(1).trim(), ...tagPayload(s) };
  if (/^d\s*:/.test(s)) return { kind: 'dice', text: s.replace(/^d\s*:\s*/, ''), ...tagPayload(s, true) };
  if (/^tbl\s*:/.test(s)) {
    const text = s.replace(/^tbl\s*:\s*/, '');
    return { kind: 'tbl', text, table: readTable(text), ...tagPayload(s) };
  }
  if (/^gen\s*:/.test(s)) {
    const text = s.replace(/^gen\s*:\s*/, '');
    // A header with no arrow opens a multi-line axis block (core §4.3.3);
    // anything else is the single-line compound form (§4.3).
    const generator = RE_ARROW.test(text) ? null : { name: stripQualifier(text) };
    return { kind: 'gen', text, generator, ...tagPayload(s) };
  }
  if (/^(->|→)/.test(s)) return { kind: 'resolution', text: s.replace(/^(->|→)\s*/, ''), ...tagPayload(s) };
  if (/^=>/.test(s)) return { kind: 'consequence', text: s.slice(2).trim(), ...tagPayload(s) };

  // Bodies of an open table or generator block (core §4.3.1–3).
  if (body === 'table') {
    const m = RE_TABLE_ENTRY.exec(s);
    if (m) {
      return {
        kind: 'tableEntry',
        min: Number(m[1]),
        max: m[2] ? Number(m[2]) : Number(m[1]),
        result: m[3].trim(),
      };
    }
  }
  if (body === 'gen') {
    const m = RE_GEN_AXIS.exec(s);
    if (m && !/^(note|reflection|house rule|reminder|question)$/i.test(m[1].trim())) {
      const [roll, result] = m[2].split(RE_ARROW);
      return {
        kind: 'genAxis',
        axis: m[1].trim(),
        roll: (result === undefined ? '' : roll).trim(),
        result: (result === undefined ? roll : result).trim(),
      };
    }
  }

  // Meta note: the whole line parenthesised (core §4.5).
  if (/^\(.*\)$/.test(s) && !s.slice(1, -1).includes('(')) {
    const m = /^\(\s*([A-Za-z][A-Za-z ]*?)\s*:\s*([\s\S]*)\)$/.exec(s);
    return { kind: 'note', noteType: m ? m[1].toLowerCase() : null, text: m ? m[2] : s.slice(1, -1) };
  }

  const d = RE_DIALOGUE.exec(s);
  if (d) return { kind: 'dialogue', speakerRole: d[1], speaker: d[3]?.trim() || null, text: d[4] };

  const sm = RE_SESSION_META.exec(s);
  if (sm) {
    const meta = {};
    for (const part of sm[1].split('|')) {
      const kv = /^\s*([A-Za-z][A-Za-z ]*?)\s*:\s*(.*?)\s*$/.exec(part);
      if (kv) meta[kv[1].trim().toLowerCase()] = kv[2];
    }
    return { kind: 'sessionMeta', meta, text: sm[1].trim() };
  }

  const payload = tagPayload(s);
  if (payload.tags.length && payload.stripped === '') return { kind: 'tag', ...payload };
  return { kind: 'prose', text: s, ...payload };
}

/** @returns {{length:number, marker:object}|null} */
function readMarker(s) {
  let m = RE_SCENE.exec(s);
  if (m) {
    return {
      length: m[0].length,
      marker: {
        kind: 'scene', id: m[0], scene: Number(m[3]),
        thread: m[2] ? Number(m[2]) : null,
        flashback: m[4] ?? null,
        montage: m[5] ? Number(m[5]) : null,
      },
    };
  }
  m = RE_ROUND.exec(s);
  if (m) return { length: m[0].length, marker: { kind: 'round', id: m[0], round: Number(m[1]) } };
  m = RE_TURN.exec(s);
  if (m) {
    const phase = /^\s*(Move|Shoot|Combat|Heat|Morale)\s*:/i.exec(s.slice(m[0].length));
    return {
      length: m[0].length + (phase ? phase[0].length : 0),
      marker: { kind: 'turn', id: m[0], turn: Number(m[1]), phase: phase ? phase[1] : null },
    };
  }
  return null;
}

function tagPayload(s, diceLine = false) {
  const { tags, rollContext, annotations, stripped } = extractTags(s, { diceLine });
  return { tags, rollContext, annotations, stripped };
}

/**
 * Best-effort split of compact single-line shorthand (core §6.1) into segments.
 * Advisory only — `raw` remains authoritative for rendering.
 */
export function segment(text) {
  if (!text) return [];
  const re = /(@\([^)]*\)|@|\?|d:|tbl:|gen:|=>|->)/g;
  const parts = [];
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      const chunk = text.slice(last, m.index).trim();
      if (chunk && parts.length) parts[parts.length - 1].text = chunk;
      else if (chunk) parts.push({ kind: 'prose', symbol: '', text: chunk });
    }
    parts.push({ kind: symbolKind(m[1]), symbol: m[1], text: '' });
    last = m.index + m[1].length;
  }
  if (parts.length) {
    const tail = text.slice(last).trim();
    if (tail) parts[parts.length - 1].text = tail;
  }
  return parts;
}

function symbolKind(sym) {
  if (sym.startsWith('@')) return 'action';
  if (sym === '?') return 'question';
  if (sym === 'd:') return 'dice';
  if (sym === 'tbl:') return 'tbl';
  if (sym === 'gen:') return 'gen';
  if (sym === '=>') return 'consequence';
  return 'resolution';
}

/**
 * Read the head of a `tbl:` line (core §4.3, §4.3.1–2).
 * @param {string} text
 */
function readTable(text) {
  // Filtered option set: `Mood [Tense, Melancholic, Hopeful]` (§4.3.2).
  const options = /^(.*?)\s*\[([^\]]*)\]\s*$/.exec(text);
  if (options) {
    return {
      kind: 'options',
      name: stripQualifier(options[1]),
      options: options[2].split(',').map((o) => o.trim()).filter(Boolean),
    };
  }

  // Lookup: anything carrying a resolution arrow.
  if (RE_ARROW.test(text)) {
    const [left, result] = text.split(RE_ARROW);
    const roll = /(\d*d\d+|\bd\d+)\s*=\s*(\d+)/i.exec(left);
    return {
      kind: 'lookup',
      name: stripQualifier(left.replace(/(\d*d\d+|\bd\d+)\s*=\s*\d+.*$/i, '')),
      die: roll ? roll[1].toLowerCase() : null,
      roll: roll ? Number(roll[2]) : null,
      result: result.trim(),
    };
  }

  // Definition header: `Forest Encounter (d6)` (§4.3.1).
  const def = /^(.*?)\s*\((d\d+)\)\s*$/i.exec(text);
  if (def) return { kind: 'definition', name: def[1].trim(), die: def[2].toLowerCase() };

  return { kind: 'reference', name: stripQualifier(text) };
}

/** Drop a parenthetical qualifier such as `(custom d6 tables)`. */
function stripQualifier(s) {
  return String(s).replace(/\s*\([^)]*\)\s*$/, '').trim();
}
