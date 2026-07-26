/**
 * Lonelog renderer: Entry[] -> markdown.
 *
 * `render()` is lossless by construction — it replays `raw` + `eol`, so
 * `render(lex(t)) === t` for any input (CLAUDE.md §5.2). Canonicalisation and
 * analog/digital conversion are explicit opt-in transforms, never side effects
 * of reading a log.
 */

import { serializeTag } from './tags.js';

/**
 * Rebuild the source exactly.
 * @param {object[]} entries
 * @returns {string}
 */
export function render(entries) {
  return entries.map((e) => e.raw + e.eol).join('');
}

/**
 * Rebuild with tags normalised to canonical form (CLAUDE.md §5.3).
 * Non-tag text is left untouched — canonicalising prose is not this tool's job.
 * @param {object[]} entries
 * @returns {string}
 */
export function renderCanonical(entries) {
  return entries.map((e) => canonicalLine(e) + e.eol).join('');
}

function canonicalLine(e) {
  if (!e.tags?.length) return e.raw;
  // Core §4.1.8: multi-line and single-line tag forms are equivalent. Collapsing
  // one into the other would rewrite the author's chosen readability, not
  // normalise whitespace, so leave it alone.
  if (e.multiline) return e.raw;
  let out = '';
  let cursor = 0;
  const ordered = [...e.tags].filter((t) => t.span).sort((a, b) => a.span[0] - b.span[0]);
  for (const t of ordered) {
    out += e.raw.slice(cursor, t.span[0]) + serializeTag(t);
    cursor = t.span[1];
  }
  return out + e.raw.slice(cursor);
}

/**
 * Convert structural blocks between the two equivalent forms (core §2.2,
 * combat §1.3, ledger T27).
 * @param {object[]} entries
 * @param {'digital'|'analog'} form
 * @returns {string}
 */
export function renderForm(entries, form) {
  return entries.map((e) => {
    if (e.kind !== 'block') return e.raw + e.eol;
    const indent = e.raw.slice(0, e.indent);
    const body = form === 'digital'
      ? `[${e.closing ? '/' : ''}${e.name}]`
      : `--- ${e.closing ? 'END ' : ''}${e.name} ---`;
    return indent + body + e.eol;
  }).join('');
}

/**
 * Truncate a log at a line index — the undo primitive (CLAUDE.md §5.1).
 * @param {object[]} entries
 * @param {number} lineIndex exclusive
 * @returns {object[]}
 */
export function truncate(entries, lineIndex) {
  return entries.filter((e) => e.line < lineIndex);
}
