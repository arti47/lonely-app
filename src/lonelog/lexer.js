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
  'consequence', 'tbl', 'gen', 'note', 'dialogue', 'sessionMeta', 'tag', 'prose',
]);

const RE_SCENE = /^(T(\d+)-)?S(\d+)([a-z])?(?:\.(\d+))?\b/;
const RE_ROUND = /^Rd(\d+)\b/;
const RE_TURN = /^Tn(\d+)\b/;
const RE_BLOCK_BRACKET = /^\[\s*(\/?)\s*([A-Z][A-Z ]*?)\s*\]$/;
const RE_BLOCK_ANALOG = /^---\s*(END\s+)?([A-Z][A-Z ]*?)\s*---$/;
const RE_HEADING = /^(#{1,6})\s+(.*)$/;
const RE_DIALOGUE = /^(N|PC)\s*(\(([^)]*)\))?\s*:\s*(.*)$/;
// `*Date: 2025-09-03 | Duration: 1h30 | Scenes: S1-S2*` under a session heading
// (core §5.2.1). Requires a `Key: value` opener so ordinary italic prose is not
// swallowed.
const RE_SESSION_META = /^\*\s*([A-Z][A-Za-z ]*:[^*]*)\*$/;

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
      if (s === '---') inFrontmatter = false;
      entries.push({ ...base, kind: 'frontmatter', delimiter: s === '---' });
      i++; continue;
    }

    if (/^```/.test(s)) {
      inFence = !inFence;
      entries.push({ ...base, kind: 'fence', open: inFence });
      i++; continue;
    }

    if (s === '') { entries.push({ ...base, kind: 'blank' }); i++; continue; }

    // Long in-fiction block, asymmetric delimiters (core §4.4).
    if (/^\\-{3,}/.test(s)) {
      inNarrative = true;
      entries.push({ ...base, kind: 'narrativeOpen' });
      i++; continue;
    }
    if (inNarrative) {
      if (/-{3,}\\$/.test(s)) {
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
    if (ba && BLOCK_NAMES.has(ba[2].trim())) {
      entries.push({ ...base, kind: 'block', name: ba[2].trim(), closing: !!ba[1], form: 'analog' });
      i++; continue;
    }

    entries.push({ ...base, ...classify(s) });
    i++;
  }

  return entries;
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

/** Classify a non-structural line and attach its tags. */
function classify(s) {
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
  if (/^tbl\s*:/.test(s)) return { kind: 'tbl', text: s.replace(/^tbl\s*:\s*/, ''), ...tagPayload(s) };
  if (/^gen\s*:/.test(s)) return { kind: 'gen', text: s.replace(/^gen\s*:\s*/, ''), ...tagPayload(s) };
  if (/^(->|→)/.test(s)) return { kind: 'resolution', text: s.replace(/^(->|→)\s*/, ''), ...tagPayload(s) };
  if (/^=>/.test(s)) return { kind: 'consequence', text: s.slice(2).trim(), ...tagPayload(s) };

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
