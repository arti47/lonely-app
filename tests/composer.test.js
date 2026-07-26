/** Composer line construction (CLAUDE.md §8 Phase 2). Pure helpers only. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLine, buildTag, nextSceneNumber, nextSessionNumber,
  sceneLine, sessionLines, suggestNames, blockOptions, SYMBOLS,
} from '../src/composer.js';
import { lex } from '../src/lonelog/lexer.js';
import { fold } from '../src/lonelog/fold.js';

const foldText = (t) => fold(lex(t));

test('every symbol produces a line its own lexer recognises', () => {
  for (const s of SYMBOLS) {
    const line = buildLine(s.kind, 'something happens');
    const [entry] = lex(line + '\n');
    assert.equal(entry.kind, s.kind, `${s.glyph} produced ${entry.kind}`);
  }
});

test('buildLine trims and keeps the note suffix', () => {
  assert.equal(buildLine('action', '  Pick the lock  '), '@ Pick the lock');
  assert.equal(buildLine('note', 'testing a house rule'), '(note: testing a house rule)');
  assert.equal(buildLine('consequence', 'The door opens'), '=> The door opens');
});

test('buildLine with no text still emits a usable symbol', () => {
  assert.equal(buildLine('question', ''), '?');
  assert.equal(buildLine('note', ''), '(note:)');
});

test('buildTag emits canonical notation that reparses identically', () => {
  const line = buildTag({ type: 'N', name: 'Jonah', fields: [' friendly ', 'injured', ''] });
  assert.equal(line, '[N:Jonah|friendly|injured]');
  const [entry] = lex(line + '\n');
  assert.equal(entry.tags.length, 1);
  assert.equal(entry.tags[0].name, 'Jonah');
});

test('scene numbering continues from the log and ignores flashbacks and montages', () => {
  const state = foldText('S1 *One*\nS2 *Two*\nS2a *Flashback*\nS2.1 *Montage*\n');
  assert.equal(nextSceneNumber(state), 3);
  assert.equal(sceneLine(state, 'The crypt'), 'S3 *The crypt*');
  assert.equal(sceneLine(state, '   '), 'S3');
});

test('scene numbering starts at 1 on an empty log', () => {
  assert.equal(nextSceneNumber(foldText('')), 1);
});

test('session lines continue the numbering and lex as a session', () => {
  const state = foldText('## Session 1\n\n## Session 2\n');
  assert.equal(nextSessionNumber(state), 3);
  const lines = sessionLines(state, '2026-07-26');
  assert.deepEqual(lines, ['## Session 3', '*Date: 2026-07-26*', '']);
  assert.deepEqual(foldText(lines.join('\n') + '\n').sessions.map((s) => s.number), [3]);
});

test('autocomplete offers names the fold already knows', () => {
  const state = foldText('[N:Jonah|friendly]\n[N:Viktor|hostile]\n[L:Lighthouse|ruined]\n');
  assert.deepEqual(suggestNames(state, 'N'), ['Jonah', 'Viktor']);
  assert.deepEqual(suggestNames(state, 'L'), ['Lighthouse']);
  assert.deepEqual(suggestNames(state, 'F'), []);
});

test('block options reflect what is currently open', () => {
  const closed = blockOptions(foldText('@ Walk on\n'));
  assert.equal(closed.closable, null);
  assert.ok(closed.openable.includes('COMBAT'));

  const open = blockOptions(foldText('[COMBAT]\n@ Slash\n'));
  assert.equal(open.closable, 'COMBAT');
  assert.ok(!open.openable.includes('COMBAT'));
});
