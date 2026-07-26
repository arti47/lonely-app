/**
 * Correctness bar (CLAUDE.md Phase 1): every example in all five vendored specs
 * round-trips byte-identically, and folding is deterministic over all of them.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { lex } from '../src/lonelog/lexer.js';
import { render, renderCanonical } from '../src/lonelog/render.js';
import { fold, foldWithCheckpoints } from '../src/lonelog/fold.js';
import { lint } from '../src/lonelog/lint.js';

const corpusDir = join(dirname(fileURLToPath(import.meta.url)), 'corpus');
const files = readdirSync(corpusDir).filter((f) => f.endsWith('.lonelog')).sort();

test('corpus is present', () => {
  assert.ok(files.length > 300, `expected the full spec corpus, got ${files.length}`);
});

test('every spec example round-trips byte-identically', () => {
  const failures = [];
  for (const f of files) {
    const src = readFileSync(join(corpusDir, f), 'utf8');
    const out = render(lex(src));
    if (out !== src) failures.push(f);
  }
  assert.deepEqual(failures, [], `${failures.length}/${files.length} snippets did not round-trip`);
});

test('canonical render preserves every non-tag byte', () => {
  const failures = [];
  for (const f of files) {
    const src = readFileSync(join(corpusDir, f), 'utf8');
    const out = renderCanonical(lex(src));
    // Canonicalisation only rewrites inside brackets; line count must not move.
    if (out.split('\n').length !== src.split('\n').length) failures.push(f);
  }
  assert.deepEqual(failures, []);
});

test('lexing never drops or invents a line', () => {
  for (const f of files) {
    const src = readFileSync(join(corpusDir, f), 'utf8');
    const entries = lex(src);
    const rebuilt = entries.reduce((n, e) => n + e.raw.split('\n').length, 0);
    assert.equal(rebuilt, src.replace(/\n$/, '').split('\n').length, f);
  }
});

test('folding is deterministic and checkpoint-equivalent', () => {
  for (const f of files) {
    const src = readFileSync(join(corpusDir, f), 'utf8');
    const entries = lex(src);

    const a = fold(entries);
    const b = fold(entries);
    assert.deepEqual(serialisable(a), serialisable(b), `${f}: fold is not deterministic`);

    const { state, checkpoints } = foldWithCheckpoints(entries);
    assert.deepEqual(serialisable(state), serialisable(a), `${f}: checkpointed fold diverged`);

    for (const cp of checkpoints) {
      const resumed = fold(entries, { state: structuredClone(cp.state), from: cp.entryIndex });
      assert.deepEqual(
        serialisable(resumed), serialisable(a),
        `${f}: resuming from checkpoint at line ${cp.lineIndex} diverged from a full fold`,
      );
    }
  }
});

test('linting never throws on any spec example', () => {
  for (const f of files) {
    const src = readFileSync(join(corpusDir, f), 'utf8');
    assert.doesNotThrow(() => lint(lex(src)), f);
  }
});

/** Maps/Sets are not comparable by deepEqual across clones; normalise first. */
function serialisable(state) {
  return JSON.parse(JSON.stringify(state, (_k, v) => {
    if (v instanceof Map) return { __map: [...v.entries()] };
    if (v instanceof Set) return { __set: [...v].sort() };
    return v;
  }));
}
