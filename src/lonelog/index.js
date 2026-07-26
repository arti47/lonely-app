/**
 * The Lonelog notation engine.
 *
 * This directory imports nothing outside itself (CLAUDE.md §3.1) so it stays
 * portable to a future CLI or editor plugin.
 */

export { lex, segment, KINDS } from './lexer.js';
export {
  parseTag, serializeTag, serializeField, parseField,
  extractTags, scanBrackets, classifyBracket,
  KNOWN_TAG_TYPES, BLOCK_NAMES,
} from './tags.js';
export {
  fold, foldWithCheckpoints, createState, snapshot,
  getElement, elementsOfType, elementKey, getTable, tablesOf,
} from './fold.js';
export { render, renderCanonical, renderForm, truncate } from './render.js';
export { lint, summarise, SEVERITY } from './lint.js';

import { lex } from './lexer.js';
import { foldWithCheckpoints } from './fold.js';
import { lint } from './lint.js';

/**
 * Parse, fold and lint in one pass — the app's normal entry point.
 * @param {string} text
 */
export function parse(text) {
  const entries = lex(text);
  const { state, checkpoints } = foldWithCheckpoints(entries);
  return { entries, state, checkpoints, findings: lint(entries) };
}
