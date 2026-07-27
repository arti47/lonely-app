/** Composer line construction (CLAUDE.md §8 Phase 2). Pure helpers only. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLine, buildTag, nextSceneNumber, nextSessionNumber,
  sceneLine, sessionLines, suggestNames, blockOptions, SYMBOLS,
  BASIC_SYMBOLS, usesAdvancedSymbols, suggestFields,
} from '../src/composer.js';
import { lex } from '../src/lonelog/lexer.js';
import { fold, getElement } from '../src/lonelog/fold.js';

const foldText = (t) => fold(lex(t));

test('every symbol produces a line its own lexer recognises', () => {
  for (const s of SYMBOLS) {
    const line = buildLine(s.kind, 'something happens');
    const [entry] = lex(line + '\n');
    assert.equal(entry.kind, s.kind, `${s.glyph} produced ${entry.kind}`);
  }
});

test('D9: every symbol says what it means, in a word', () => {
  for (const s of SYMBOLS) {
    assert.ok(s.word?.trim(), `${s.glyph} has no word`);
    assert.ok(s.prompt?.trim(), `${s.glyph} has no prompt`);
    assert.ok(s.word.length <= 9, `${s.glyph}'s word "${s.word}" will not fit a 360px bar`);
  }
});

test('D9: the beginner set is the four that carry a session on their own', () => {
  assert.deepEqual(BASIC_SYMBOLS.map((s) => s.kind),
    ['action', 'question', 'dice', 'consequence']);
  // They must lead the bar, so collapsing never reorders the buttons.
  assert.deepEqual(SYMBOLS.slice(0, 4), BASIC_SYMBOLS);
});

test('D9: a log that already uses an advanced symbol opens expanded', () => {
  const basic = lex('@ Sneak past\n? Is anyone there\nd: d6=5 -> Yes\n=> I slip by\n');
  assert.equal(usesAdvancedSymbols(basic), false);

  for (const line of ['-> Yes, but...', 'tbl: Mood d4=2 -> Melancholic', 'gen: NPC -> Merchant', '(note: house rule)']) {
    assert.equal(usesAdvancedSymbols(lex(line + '\n')), true, `${line} should expand the bar`);
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

test('a tag is built from separate fields, and empty rows are dropped', () => {
  // The dialog collects one field per row; `|` is the builder's business.
  assert.equal(buildTag({ type: 'N', name: 'Jonah', fields: ['wounded', '', 'HP 8', '  '] }),
    '[N:Jonah|wounded|HP 8]');
  assert.equal(buildTag({ type: 'N', name: 'Jonah', fields: ['', ''] }), '[N:Jonah]');
});

test('a meter typed as a field lands on the tag head, so the fold sees a meter', () => {
  // `[Clock:Suspicion|3/6]` folds as a flag literally named "3/6" — the Sheet
  // then has nothing to step. The fill belongs on the head (core §4.2).
  for (const type of ['Clock', 'Track', 'E']) {
    const line = buildTag({ type, name: 'Suspicion', fields: ['3/6'] });
    assert.equal(line, `[${type}:Suspicion 3/6]`);
    const el = getElement(fold(lex(line + '\n')), type, 'Suspicion');
    assert.deepEqual(
      { current: el.progress?.current, total: el.progress?.total }, { current: 3, total: 6 },
      `${line} did not fold to a meter`,
    );
    assert.equal(el.flags.size, 0, 'the fill must not also be a flag');
  }
});

test('a bare number on a Timer or Wealth tag is its value, not a flag', () => {
  const timer = buildTag({ type: 'Timer', name: 'Dawn', fields: ['3'] });
  assert.equal(timer, '[Timer:Dawn 3]');
  assert.equal(getElement(fold(lex(timer + '\n')), 'Timer', 'Dawn').value.value, '3');

  const wealth = buildTag({ type: 'Wealth', name: 'Gold', fields: ['40'] });
  assert.equal(wealth, '[Wealth:Gold 40]');
  assert.equal(getElement(fold(lex(wealth + '\n')), 'Wealth', 'Gold').value.value, '40');

  // A number on anything else is still a plain field — `[N:Jonah|3]` is what
  // the writer typed and the notation has no head value there.
  assert.equal(buildTag({ type: 'N', name: 'Jonah', fields: ['3'] }), '[N:Jonah|3]');
});

test('a hand-written [Clock:X|4/6] is read tolerantly as the meter it means', () => {
  // §5.3: accept the irregular form, keep emitting the canonical one.
  const el = getElement(fold(lex('[Clock:Alarm|4/6]\n')), 'Clock', 'Alarm');
  assert.deepEqual({ c: el.progress?.current, t: el.progress?.total }, { c: 4, t: 6 });
  assert.equal(el.flags.size, 0);
});

test('fields autocomplete from the vocabulary this campaign already uses', () => {
  const state = fold(lex([
    '[N:Jonah|wounded|HP 8]',
    '[N:Mara|friendly|Grit 2]',
    '[PC:Alex|HP 10|Stress 1]',
  ].join('\n') + '\n'));

  assert.deepEqual(suggestFields(state, 'N'), ['Grit', 'HP', 'friendly', 'wounded']);
  assert.deepEqual(suggestFields(state, 'PC'), ['HP', 'Stress']);
  assert.deepEqual(suggestFields(state, 'F'), [], 'a type with no elements suggests nothing');
});
