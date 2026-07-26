/** Fold semantics — where real defects live (CLAUDE.md §11). */

import test from 'node:test';
import assert from 'node:assert/strict';

import { lex } from '../src/lonelog/lexer.js';
import { fold, foldWithCheckpoints, getElement, elementsOfType } from '../src/lonelog/fold.js';

const foldText = (t) => fold(lex(t));
const field = (el, k) => el.fields.get(k)?.value;

test('T13 PC deltas apply against the running value', () => {
  const s = foldText('[PC:Alex|HP 8]\n[PC:Alex|HP-2]\n');
  assert.equal(field(getElement(s, 'PC', 'Alex'), 'HP'), '6');
});

test('deltas against an X/Y stat move the current value, not the maximum', () => {
  const s = foldText('[PC:Kael|HP 12/15]\n[PC:Kael|HP-4]\n[PC:Kael|HP+1]\n');
  assert.equal(field(getElement(s, 'PC', 'Kael'), 'HP'), '9/15');
});

test('T18 later tags merge rather than replace earlier ones', () => {
  const s = foldText('[N:Jonah|friendly|injured]\n[N:Jonah|captured]\n');
  const el = getElement(s, 'N', 'Jonah');
  assert.deepEqual([...el.flags.keys()].sort(), ['captured', 'friendly', 'injured']);
});

test('T18 +/- add and remove flags', () => {
  const s = foldText('[N:Jonah|friendly|wounded]\n[N:Jonah|+captured|-wounded]\n');
  const el = getElement(s, 'N', 'Jonah');
  assert.ok(el.flags.has('captured'));
  assert.ok(!el.flags.has('wounded'));
});

test('T18 flag transitions swap one state for another', () => {
  const s = foldText('[N:Guard|alert]\n[N:Guard|alert -> unconscious]\n');
  const el = getElement(s, 'N', 'Guard');
  assert.ok(!el.flags.has('alert'));
  assert.ok(el.flags.has('unconscious'));
});

test('T44 usage-die step-down chain tracks the current die', () => {
  const s = foldText('[PC:Kael|Supply d8]\n[PC:Kael|Supply d8->d6]\n[PC:Kael|Supply d6->d4]\n');
  assert.equal(field(getElement(s, 'PC', 'Kael'), 'Supply'), 'd4');
});

test('T46 wealth deltas accumulate on the head value', () => {
  const s = foldText('[Wealth:Gold 45]\n[Wealth:Gold+15]\n[Wealth:Gold-8]\n');
  assert.equal(getElement(s, 'Wealth', 'Gold').value.value, '52');
});

test('T41 inventory deltas accumulate', () => {
  const s = foldText('[Inv:Torch|4]\n[Inv:Torch-1]\n[Inv:Torch-1]\n');
  assert.equal(getElement(s, 'Inv', 'Torch').value.value, '2');
});

test('T14 reference tags do not mutate state', () => {
  const s = foldText('[N:Jonah|friendly]\n[#N:Jonah]\n');
  const el = getElement(s, 'N', 'Jonah');
  assert.deepEqual([...el.flags.keys()], ['friendly']);
  assert.equal(el.refs.length, 1);
});

test('T19 clock progress is readable', () => {
  const s = foldText('[Clock:Suspicion 1/6]\n[Clock:Suspicion 3/6]\n');
  assert.deepEqual(
    { c: getElement(s, 'Clock', 'Suspicion').progress.current, t: getElement(s, 'Clock', 'Suspicion').progress.total },
    { c: 3, t: 6 },
  );
});

test('T37 room statuses accumulate through the crawl', () => {
  const s = foldText('[R:1|unexplored]\n[R:1|cleared]\n[R:1|+looted]\n');
  const el = getElement(s, 'R', '1');
  assert.ok(el.flags.has('cleared'));
  assert.ok(el.flags.has('looted'));
});

test('T31 group counts fall as casualties are taken', () => {
  const s = foldText('[F:Skeletonx3|HP 3 each]\n[F:Skeletonx2]\n[F:Skeletonx0]\n');
  assert.equal(getElement(s, 'F', 'Skeleton').count.value, 0);
});

test('T48/T50 unit size accepts counts and abstract sizes', () => {
  const s = foldText('[Unit:Orc Mob|full|Morale 5]\n[Unit:Orc Mob|half|wavering]\n');
  const el = getElement(s, 'Unit', 'Orc Mob');
  assert.ok(el.flags.has('half'));
  assert.equal(field(el, 'Morale'), '5');
});

test('T23 scene, round and turn markers are tracked independently', () => {
  const s = foldText('S5 *Crypt*\nRd1\nTn1\n');
  assert.equal(s.marker.scene.scene, 5);
  assert.equal(s.marker.round.round, 1);
  assert.equal(s.marker.turn.turn, 1);
});

test('T23 flashback, montage and thread scenes parse their parts', () => {
  const s = foldText('S8a *Flashback*\nS12.3 *Graveyard*\nT2-S1 *City*\n');
  assert.deepEqual(s.scenes.map((x) => [x.scene, x.flashback, x.montage, x.thread]), [
    [8, 'a', null, null],
    [12, null, 3, null],
    [1, null, null, 2],
  ]);
});

test('T28/T54 blocks open and close as a stack', () => {
  const s = foldText('[COMBAT]\n@Slash\n[/COMBAT]\n');
  assert.equal(s.blockStack.length, 0);
  assert.deepEqual(s.blocks.map((b) => b.name), ['COMBAT']);
});

test('T27 analog blocks are equivalent to digital ones', () => {
  const digital = foldText('[COMBAT]\n[F:Thug|HP 6]\n[/COMBAT]\n');
  const analog = foldText('--- COMBAT ---\n[F:Thug|HP 6]\n--- END COMBAT ---\n');
  assert.deepEqual(digital.blocks.map((b) => b.name), analog.blocks.map((b) => b.name));
  assert.equal(getElement(analog, 'F', 'Thug').fields.get('HP').value, '6');
});

test('D6 add-ons are detected from log content alone', () => {
  assert.deepEqual([...foldText('[F:Thug|HP 6]\n').addons], ['combat']);
  assert.deepEqual([...foldText('[R:1|cleared]\n').addons], ['dungeon']);
  assert.deepEqual([...foldText('[Inv:Torch|3]\n').addons], ['resources']);
  assert.deepEqual([...foldText('[Unit:Rifles|x12]\n').addons], ['wargaming']);
  assert.deepEqual([...foldText('@ Walk on\n').addons], []);
});

test('§5.7 every folded value carries the line that set it', () => {
  const s = foldText('[PC:Alex|HP 8]\n@ Take a hit\n[PC:Alex|HP-3]\n');
  assert.equal(getElement(s, 'PC', 'Alex').fields.get('HP').line, 2);
});

test('unrecognised lines are preserved and do not corrupt state', () => {
  const entries = lex('The guard turns.\n[N:Guard|alert]\nSomething else entirely\n');
  const s = fold(entries);
  assert.equal(entries.filter((e) => e.kind === 'prose').length, 2);
  assert.equal(elementsOfType(s, 'N').length, 1);
});

test('T24 front matter populates campaign meta', () => {
  const s = foldText('---\ntitle: Clearview Mystery\nruleset: Loner + Mythic\n---\n\n# Clearview\n');
  assert.equal(s.meta.title.value, 'Clearview Mystery');
  assert.equal(s.meta.ruleset.value, 'Loner + Mythic');
});

test('T25 sessions are collected from digital and analog headers', () => {
  const digital = foldText('## Session 1\n\n## Session 2\n');
  assert.deepEqual(digital.sessions.map((x) => x.number), [1, 2]);
  const analog = foldText('=== Session 3 ===\n');
  assert.deepEqual(analog.sessions.map((x) => x.number), [3]);
});

test('checkpoints snapshot state before each scene', () => {
  const entries = lex('S1 *One*\n[PC:Alex|HP 8]\nS2 *Two*\n[PC:Alex|HP-2]\n');
  const { state, checkpoints } = foldWithCheckpoints(entries);
  assert.equal(checkpoints.length, 2);
  assert.equal(getElement(checkpoints[1].state, 'PC', 'Alex').fields.get('HP').value, '8');
  assert.equal(getElement(state, 'PC', 'Alex').fields.get('HP').value, '6');
});

test('element identity is case-insensitive on the name', () => {
  const s = foldText('[N:Jonah|friendly]\n[N:jonah|wounded]\n');
  assert.equal(elementsOfType(s, 'N').length, 1);
});

test('T28 a block opened in a scene header closes at the next scene (combat §1.1)', () => {
  const s = foldText([
    'S9 *Dockside ambush* [COMBAT]',
    '[F:Pirate Captain|HP 10|Close]',
    'Rd1',
    '@ Slash at the Captain',
    'S10 *The morning after*',
    '@ Count the cost',
    '',
  ].join('\n'));

  assert.equal(s.blockStack.length, 0, 'the implicit block must not stay open');
  assert.deepEqual(s.blocks.map((b) => [b.name, b.startLine, b.endLine]), [['COMBAT', 0, 4]]);
  assert.ok(s.addons.has('combat'));
});

test('an explicit block is not closed by a scene marker', () => {
  const s = foldText('[COMBAT]\nS2 *Still fighting*\n@ Swing\n');
  assert.equal(s.blockStack.length, 1);
  assert.equal(s.blockStack[0].name, 'COMBAT');
});

test('T25 session metadata attaches to its session (core §5.2.1)', () => {
  const s = foldText('## Session 4\n*Date: 2026-07-26 | Duration: 1h30 | Scenes: S1-S2*\n');
  assert.deepEqual(s.sessions[0].meta, {
    date: '2026-07-26', duration: '1h30', scenes: 'S1-S2',
  });
});

test('ordinary italic prose is not mistaken for session metadata', () => {
  const entries = lex('*The fog rolls in off the harbour*\n');
  assert.equal(entries[0].kind, 'prose');
});
