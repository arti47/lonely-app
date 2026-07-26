/**
 * Lifecycle engine (CLAUDE.md §8 Phase 6).
 *
 * A bundle is just lines, so the properties worth asserting are: it folds into
 * the state the boundary implies, it leaves no block open, and truncating
 * exactly its length restores the prior state — which is what makes one-step
 * undo correct rather than approximate (§5.1).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { lex } from '../src/lonelog/lexer.js';
import { fold, getElement } from '../src/lonelog/fold.js';
import { sceneBundle, sessionStartBundle, sessionEndBundle, describe } from '../src/lifecycle.js';

const foldText = (t) => fold(lex(t));
const apply = (log, bundle) => log + bundle.lines.join('\n') + '\n';

const plain = (state) => JSON.parse(JSON.stringify(state, (_k, v) => {
  if (v instanceof Map) return { __map: [...v.entries()] };
  if (v instanceof Set) return { __set: [...v].sort() };
  return v;
}));

/* ------------------------------- scenes ---------------------------------- */

test('a scene bundle opens the next scene', () => {
  const bundle = sceneBundle(foldText('S1 *Alley*\n'), { context: 'The crypt' });
  assert.deepEqual(bundle.lines, ['S2 *The crypt*']);
  assert.equal(bundle.heavy, false, 'a bare marker needs no confirmation');

  const state = foldText(apply('S1 *Alley*\n', bundle));
  assert.equal(state.marker.scene.scene, 2);
});

test('a scene bundle closes an explicitly opened block first', () => {
  const log = 'S1 *Warehouse*\n[COMBAT]\n[F:Thug|HP 6]\n';
  const bundle = sceneBundle(foldText(log), { context: 'Outside' });

  assert.deepEqual(bundle.lines, ['[/COMBAT]', 'S2 *Outside*']);
  assert.equal(bundle.heavy, true, 'closing a block is worth confirming');

  const state = foldText(apply(log, bundle));
  assert.equal(state.blockStack.length, 0);
  assert.equal(state.marker.scene.scene, 2);
});

test('a scene bundle leaves a scene-header block alone — the marker closes it', () => {
  const log = 'S9 *Dockside ambush* [COMBAT]\n[F:Captain|HP 10]\n';
  const bundle = sceneBundle(foldText(log), { context: 'The morning after' });

  assert.deepEqual(bundle.lines, ['S10 *The morning after*']);
  assert.equal(foldText(apply(log, bundle)).blockStack.length, 0);
});

test('a scene bundle with no context still emits a valid marker', () => {
  const bundle = sceneBundle(foldText(''), {});
  assert.deepEqual(bundle.lines, ['S1']);
  assert.equal(lex('S1\n')[0].marker.kind, 'scene');
});

/* ------------------------------- sessions -------------------------------- */

test('a session start bundle opens a numbered, dated session', () => {
  const bundle = sessionStartBundle(foldText('## Session 1\n'), { date: '2026-07-26' });
  assert.deepEqual(bundle.lines, ['## Session 2', '*Date: 2026-07-26*', '']);

  const state = foldText(apply('## Session 1\n', bundle));
  assert.deepEqual(state.sessions.map((s) => s.number), [1, 2]);
  assert.equal(state.sessions[1].meta.date, '2026-07-26');
});

test('a session end bundle closes open blocks innermost first', () => {
  const log = '[BATTLE]\n[COMBAT]\n[F:Assassin|HP 4]\n';
  const bundle = sessionEndBundle(foldText(log));

  assert.equal(bundle.lines[0], '[/COMBAT]');
  assert.equal(bundle.lines[1], '[/BATTLE]');
  assert.equal(foldText(apply(log, bundle)).blockStack.length, 0);
});

test('a session end bundle snapshots every surfaced add-on', () => {
  const log = [
    '[PC:Kael|HP 12/15|Supply d6]',
    '[Inv:Torch|2]',
    '[R:1|cleared|entry]',
    '[Unit:Rifles|x11|Morale 8|Fresh]',
    '',
  ].join('\n');

  const bundle = sessionEndBundle(foldText(log));
  const text = bundle.lines.join('\n');

  assert.match(text, /\[RESOURCES\][\s\S]*\[\/RESOURCES\]/);
  assert.match(text, /\[DUNGEON STATUS\][\s\S]*\[\/DUNGEON STATUS\]/);
  assert.match(text, /\[CAMPAIGN\][\s\S]*\[\/CAMPAIGN\]/);

  const state = foldText(apply(log, bundle));
  assert.equal(state.blockStack.length, 0, 'every snapshot block closes itself');
  assert.equal(getElement(state, 'Inv', 'Torch').value.value, '2', 'a snapshot restates, it does not change');
});

test('a session end bundle snapshots nothing for add-ons that are not in play', () => {
  const bundle = sessionEndBundle(foldText('[Inv:Torch|2]\n'));
  const text = bundle.lines.join('\n');
  assert.match(text, /\[RESOURCES\]/);
  assert.ok(!/DUNGEON STATUS/.test(text));
  assert.ok(!/\[CAMPAIGN\]/.test(text));
});

test('combat gets no status block, because its spec defines none', () => {
  const bundle = sessionEndBundle(foldText('[COMBAT]\n[F:Thug|HP 6]\n[/COMBAT]\n'));
  assert.deepEqual(bundle.lines, [], 'nothing open, nothing to snapshot');
  assert.match(describe(bundle), /Nothing open/);
});

test('an empty add-on writes no empty block', () => {
  // The dungeon surfaced from a block, but holds no rooms.
  const bundle = sessionEndBundle(foldText('[DUNGEON STATUS]\n[/DUNGEON STATUS]\n'));
  assert.ok(!bundle.lines.some((l) => l === '[DUNGEON STATUS]'));
});

/* --------------------------- one-step undo ------------------------------- */

test('truncating a bundle restores the exact prior state', () => {
  const log = [
    '[PC:Kael|HP 12/15|Supply d6]', '[Inv:Torch|2]', '[R:1|cleared]', '[COMBAT]', '[F:Thug|HP 6]', '',
  ].join('\n');

  const before = foldText(log);
  const bundle = sessionEndBundle(before);
  const after = log.split('\n').filter((l, i, a) => i < a.length - 1);
  const combined = [...after, ...bundle.lines];

  // Undo removes exactly bundle.lines.length lines.
  const undone = combined.slice(0, combined.length - bundle.lines.length);
  assert.deepEqual(undone, after);
  assert.deepEqual(plain(foldText(undone.join('\n') + '\n')), plain(before));
});

test('every bundle line lexes as notation, never as prose', () => {
  const state = foldText([
    '[PC:Kael|HP 12/15]', '[Inv:Torch|2]', '[R:1|cleared]', '[Unit:Rifles|x11]', '[COMBAT]', '',
  ].join('\n'));

  const lines = [
    ...sceneBundle(state, { context: 'Camp' }).lines,
    ...sessionStartBundle(state, { date: '2026-07-26' }).lines,
    ...sessionEndBundle(state).lines,
  ];

  for (const line of lines) {
    if (line === '') continue;
    const [entry] = lex(line + '\n');
    assert.notEqual(entry.kind, 'prose', `${line} lexed as prose`);
  }
});

test('bundles are appends — the earlier log is always a prefix', () => {
  const log = '[COMBAT]\n[F:Thug|HP 6]\n';
  const combined = apply(log, sessionEndBundle(foldText(log)));
  assert.ok(combined.startsWith(log));
});

test('describe reads as one line of plain English', () => {
  const summary = describe(sceneBundle(foldText('S1 *X*\n[COMBAT]\n'), { context: 'Y' }));
  assert.equal(summary, 'Close the open COMBAT block · Open scene S2');
});
