/**
 * Add-on surfaces (CLAUDE.md §8 Phase 5, ledger T28–T57).
 *
 * Every control asserts the same property as Phase 3: the emitted line folds
 * back into the state the user asked for (§5.1). Surfacing is asserted to come
 * from log content alone (D6).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { lex } from '../src/lonelog/lexer.js';
import { fold, getElement } from '../src/lonelog/fold.js';
import { ADDONS, surfaced, OWNED_TYPES } from '../src/addons/index.js';
import * as combat from '../src/addons/combat.js';
import * as resources from '../src/addons/resources.js';
import * as dungeon from '../src/addons/dungeon.js';
import * as wargaming from '../src/addons/wargaming.js';

const foldText = (t) => fold(lex(t));
const ids = (state) => surfaced(state).map((a) => a.id);

function afterEdit(log, build, type, name) {
  const before = foldText(log);
  const element = getElement(before, type, name);
  assert.ok(element, `${type}:${name} should exist`);
  const line = build(element, before);
  return { line, state: foldText(log + line + '\n'), element };
}

/* ------------------------------ D6 surfacing ----------------------------- */

test('D6 each add-on surfaces only when its own notation appears', () => {
  assert.deepEqual(ids(foldText('@ Walk on\n')), []);
  assert.deepEqual(ids(foldText('[F:Thug|HP 6]\n')), ['combat']);
  assert.deepEqual(ids(foldText('[Inv:Torch|3]\n')), ['resources']);
  assert.deepEqual(ids(foldText('[R:1|active]\n')), ['dungeon']);
  assert.deepEqual(ids(foldText('[Unit:Rifles|x12]\n')), ['wargaming']);
});

test('D6 markers and blocks surface an add-on too', () => {
  assert.deepEqual(ids(foldText('Rd1\n')), ['combat']);
  assert.deepEqual(ids(foldText('Tn1\n')), ['wargaming']);
  assert.deepEqual(ids(foldText('[DUNGEON STATUS]\n[/DUNGEON STATUS]\n')), ['dungeon']);
  assert.deepEqual(ids(foldText('[RESOURCES]\n[/RESOURCES]\n')), ['resources']);
});

test('D6 surfacing is sticky — a closed fight keeps the panel', () => {
  const state = foldText('[COMBAT]\n[F:Thug|HP 6]\n[/COMBAT]\nS2 *Later, elsewhere*\n@ Walk on\n');
  assert.ok(state.addons.has('combat'));
});

test('every owned type belongs to exactly one surface', () => {
  const seen = new Set();
  for (const addon of ADDONS) {
    for (const type of addon.types) {
      assert.ok(!seen.has(type), `${type} claimed twice`);
      seen.add(type);
    }
  }
  assert.deepEqual([...seen].sort(), [...OWNED_TYPES].sort());
});

/* -------------------------------- combat --------------------------------- */

test('T29 round markers advance from the current round', () => {
  assert.equal(combat.nextRoundLine(foldText('@ Fight\n')), 'Rd1');
  assert.equal(combat.nextRoundLine(foldText('Rd1\nRd2\n')), 'Rd3');
  assert.equal(lex(combat.nextRoundLine(foldText('Rd1\n')) + '\n')[0].marker.kind, 'round');
});

test('T30 damage folds against the combatant stat that exists', () => {
  const { line, state } = afterEdit('[F:Thug A|HP 6|Close]\n', (f) => combat.damageLine(f, 3), 'F', 'Thug A');
  assert.equal(line, '[F:Thug A|HP-3]');
  assert.equal(getElement(state, 'F', 'Thug A').fields.get('HP').value, '3');
});

test('T30 damage finds a non-HP stat when that is what the system uses', () => {
  const { line } = afterEdit('[F:Broken|Threat 3|Engaged]\n', (f) => combat.damageLine(f, 2), 'F', 'Broken');
  assert.equal(line, '[F:Broken|Threat-2]');
});

test('T31 a group shrinks through the head count', () => {
  const { line, state } = afterEdit('[F:Skeletonx3|HP 3 each]\n', (f) => combat.splitLine(f, 2), 'F', 'Skeleton');
  assert.equal(line, '[F:Skeletonx2]');
  assert.equal(getElement(state, 'F', 'Skeleton').count.value, 2);
});

test('T32 movement emits a transition so the old band does not linger', () => {
  const { line, state } = afterEdit('[F:Thug A|HP 6|Far]\n', (f) => combat.moveLine(f, 'Close'), 'F', 'Thug A');
  assert.equal(line, '[F:Thug A|Far -> Close]');
  const el = getElement(state, 'F', 'Thug A');
  assert.ok(el.flags.has('Close'));
  assert.ok(!el.flags.has('Far'));
});

test('T32 movement with no prior band simply adds one', () => {
  const { line } = afterEdit('[F:Thug|HP 6]\n', (f) => combat.moveLine(f, 'Engaged'), 'F', 'Thug');
  assert.equal(line, '[F:Thug|+Engaged]');
});

test('T33 a roster line snapshots the living combatants', () => {
  const state = foldText([
    'Rd3', '[PC:Alex|HP 3]', '[F:Captain|HP 4]', '[F:Rat|HP 2]', '[F:Rat|dead]', '',
  ].join('\n'));
  const line = combat.rosterLine(state);
  assert.match(line, /^Rd3 Roster: /);
  assert.match(line, /\[PC:Alex\|HP 3\]/);
  assert.match(line, /\[F:Captain\|HP 4\]/);
  assert.ok(!/\[F:Rat/.test(line), 'the dead are not on the roster');
  assert.equal(lex(line + '\n')[0].kind, 'marker');
});

test('T34 an initiative note lexes as a meta note, not a new symbol', () => {
  const [entry] = lex(combat.initiativeLine('Captain 18, Alex 15') + '\n');
  assert.equal(entry.kind, 'note');
  assert.equal(entry.noteType, 'init');
});

/* ------------------------------- resources ------------------------------- */

test('T41 inventory quantity steps fold onto the same value', () => {
  const { line, state } = afterEdit('[Inv:Torch|4]\n', (i) => resources.quantityLine(i, -1), 'Inv', 'Torch');
  assert.equal(line, '[Inv:Torch-1]');
  assert.equal(getElement(state, 'Inv', 'Torch').value.value, '3');
});

test('T41 depleted marks an item gone', () => {
  const { line, state } = afterEdit('[Inv:Oil Flask|1]\n', (i) => resources.depletedLine(i), 'Inv', 'Oil Flask');
  assert.equal(line, '[Inv:Oil Flask|+depleted]');
  assert.ok(getElement(state, 'Inv', 'Oil Flask').flags.has('depleted'));
});

test('T44 the usage-die chain steps down and ends at depleted', () => {
  const pc = getElement(foldText('[PC:Kael|Supply d8]\n'), 'PC', 'Kael');
  assert.equal(resources.stepDownLine(pc, 'Supply', 'd8'), '[PC:Kael|Supply d8->d6]');
  assert.equal(resources.stepDownLine(pc, 'Supply', 'd4'), '[PC:Kael|Supply d4->depleted]');

  let log = '[PC:Kael|Supply d12]\n';
  for (const from of ['d12', 'd10', 'd8', 'd6', 'd4']) {
    log += resources.stepDownLine(getElement(foldText(log), 'PC', 'Kael'), 'Supply', from) + '\n';
  }
  assert.equal(getElement(foldText(log), 'PC', 'Kael').fields.get('Supply').value, 'depleted');
});

test('T44 usage dice are detected only on die-valued stats', () => {
  const pc = getElement(foldText('[PC:Kael|HP 12|Supply d8|Ammo d10|Stress 2]\n'), 'PC', 'Kael');
  assert.deepEqual(resources.usageDice(pc).map((d) => d.key), ['Supply', 'Ammo']);
});

test('T46 wealth deltas fold onto the running total', () => {
  const { line, state } = afterEdit('[Wealth:Gold 45]\n', (w) => resources.wealthLine(w, -8), 'Wealth', 'Gold');
  assert.equal(line, '[Wealth:Gold-8]');
  assert.equal(getElement(state, 'Wealth', 'Gold').value.value, '37');
});

test('T47 the RESOURCES snapshot restates state and folds identically', () => {
  const log = '[PC:Kael|HP 12/15|Supply d6]\n[Wealth:Gold 52]\n[Inv:Torch|2]\n[Inv:Rope|1]\n';
  const state = foldText(log);
  const lines = resources.snapshotLines(state);

  assert.equal(lines[0], '[RESOURCES]');
  assert.equal(lines[lines.length - 1], '[/RESOURCES]');

  const after = foldText(log + lines.join('\n') + '\n');
  assert.equal(getElement(after, 'PC', 'Kael').fields.get('HP').value, '12/15');
  assert.equal(getElement(after, 'Wealth', 'Gold').value.value, '52');
  assert.equal(getElement(after, 'Inv', 'Torch').value.value, '2');
  assert.equal(after.blockStack.length, 0, 'the snapshot block must close itself');
});

test('T47 a depleted item is left out of the snapshot', () => {
  const state = foldText('[Inv:Torch|2]\n[Inv:Oil|depleted]\n');
  assert.ok(!resources.snapshotLines(state).some((l) => l.startsWith('[Inv:Oil')));
});

/* -------------------------------- dungeon -------------------------------- */

test('T35 a new room line carries status, description and exits', () => {
  const line = dungeon.roomLine('4', 'active', 'storage room', 'S:R2, E:R5');
  assert.equal(line, '[R:4|active|storage room|exits S:R2, E:R5]');
  const room = getElement(foldText(line + '\n'), 'R', '4');
  assert.ok(room.flags.has('active'));
  assert.equal(room.fields.get('exits').value, 'S:R2, E:R5');
});

test('T37 statuses accumulate and can be withdrawn', () => {
  const added = afterEdit('[R:1|cleared]\n', (r) => dungeon.statusLine(r, 'looted'), 'R', '1');
  assert.equal(added.line, '[R:1|+looted]');
  assert.ok(getElement(added.state, 'R', '1').flags.has('cleared'));
  assert.ok(getElement(added.state, 'R', '1').flags.has('looted'));

  const removed = afterEdit('[R:1|locked]\n', (r) => dungeon.clearStatusLine(r, 'locked'), 'R', '1');
  assert.ok(!getElement(removed.state, 'R', '1').flags.has('locked'));
});

test('T36 a discovered exit folds onto the room', () => {
  const { state } = afterEdit('[R:3|cleared]\n', (r) => dungeon.exitLine(r, 'E:R7(secret)'), 'R', '3');
  assert.equal(getElement(state, 'R', '3').fields.get('exits').value, 'E:R7(secret)');
});

test('T38 the DUNGEON STATUS block snapshots every room', () => {
  const log = '[R:1|cleared|entry|exits N:R2]\n[R:2|unexplored]\n';
  const lines = dungeon.snapshotLines(foldText(log));
  assert.equal(lines[0], '[DUNGEON STATUS]');
  assert.equal(lines.length, 4);

  const after = foldText(log + lines.join('\n') + '\n');
  assert.ok(getElement(after, 'R', '1').flags.has('cleared'));
  assert.equal(after.blockStack.length, 0);
});

/* ------------------------------- wargaming ------------------------------- */

test('T55 turn markers are independent of combat rounds', () => {
  assert.equal(wargaming.nextTurnLine(foldText('Rd4\n')), 'Tn1', 'Rd# must not advance Tn#');
  assert.equal(wargaming.nextTurnLine(foldText('Tn2\n')), 'Tn3');
  assert.equal(wargaming.nextTurnLine(foldText('Tn2\n'), 'Move'), 'Tn3 Move:');
  assert.equal(wargaming.phaseLine(foldText('Tn2\n'), 'Shoot'), 'Tn2 Shoot:');

  const [entry] = lex('Tn3 Move:\n');
  assert.equal(entry.marker.kind, 'turn');
  assert.equal(entry.marker.phase, 'Move');
});

test('T48 casualties step the unit size field', () => {
  const { line, state } = afterEdit('[Unit:Rifles|x12|Morale 8|Fresh]\n',
    (u) => wargaming.casualtyLine(u, 11), 'Unit', 'Rifles');
  assert.equal(line, '[Unit:Rifles|x11]');
  assert.equal(getElement(state, 'Unit', 'Rifles').count.value, 11);
  assert.equal(getElement(state, 'Unit', 'Rifles').fields.get('Morale').value, '8', 'other stats persist');
});

test('T49 unit status transitions replace the previous state', () => {
  const { line, state } = afterEdit('[Unit:Rifles|x12|Steady]\n',
    (u) => wargaming.statusLine(u, 'Broken'), 'Unit', 'Rifles');
  assert.equal(line, '[Unit:Rifles|Steady -> Broken]');
  const unit = getElement(state, 'Unit', 'Rifles');
  assert.ok(unit.flags.has('Broken'));
  assert.ok(!unit.flags.has('Steady'));
});

test('T50 abstract sizes transition the same way', () => {
  const { line, state } = afterEdit('[Unit:Orc Mob|full|Morale 5]\n',
    (u) => wargaming.sizeLine(u, 'half'), 'Unit', 'Orc Mob');
  assert.equal(line, '[Unit:Orc Mob|full -> half]');
  assert.ok(!getElement(state, 'Unit', 'Orc Mob').flags.has('full'));
});

test('T56 heat and location armor fold back onto the unit', () => {
  const heat = afterEdit('[Unit:Atlas|Armor CT30/RT25|Heat 0|Fresh]\n',
    (u) => wargaming.heatLine(u, 5), 'Unit', 'Atlas');
  assert.equal(heat.line, '[Unit:Atlas|Heat 5]');
  assert.equal(getElement(heat.state, 'Unit', 'Atlas').fields.get('Heat').value, '5');

  const armor = afterEdit('[Unit:Atlas|Armor CT30/RT25|Heat 0]\n',
    (u) => wargaming.armorLine(u, 'CT8/RT25'), 'Unit', 'Atlas');
  assert.equal(getElement(armor.state, 'Unit', 'Atlas').fields.get('Armor').value, 'CT8/RT25');
});

test('T56 heat thresholds are advisory labels only', () => {
  assert.equal(wargaming.heatBand(5), null);
  assert.match(wargaming.heatBand(10), /Overheat/);
  assert.match(wargaming.heatBand(14), /Danger/);
  assert.match(wargaming.heatBand(18), /Critical/);
});

test('T57 the CAMPAIGN block snapshots forces and units', () => {
  const log = '[Force:Ironclad|Colonel Vane|3 units]\n[Unit:Rifles|x11|Morale 8|Fresh]\n';
  const lines = wargaming.snapshotLines(foldText(log), 'CAMPAIGN');
  assert.equal(lines[0], '[CAMPAIGN]');
  assert.equal(lines[lines.length - 1], '[/CAMPAIGN]');

  const after = foldText(log + lines.join('\n') + '\n');
  assert.equal(getElement(after, 'Unit', 'Rifles').count.value, 11);
  assert.equal(after.blockStack.length, 0);
});

test('T54 the same builder writes a BATTLE block', () => {
  const lines = wargaming.snapshotLines(foldText('[Unit:Rifles|x12]\n'), 'BATTLE');
  assert.equal(lines[0], '[BATTLE]');
  assert.equal(lines[lines.length - 1], '[/BATTLE]');
});

/* ------------------------- cross-cutting invariant ----------------------- */

test('every add-on line builder emits notation the lexer recognises', () => {
  const state = foldText([
    '[F:Thug|HP 6|Far]', '[Inv:Torch|3]', '[Wealth:Gold 45]', '[PC:Kael|Supply d8]',
    '[R:1|active]', '[Unit:Rifles|x12|Steady]', '[Force:Ironclad|3 units]', '',
  ].join('\n'));

  const foe = getElement(state, 'F', 'Thug');
  const item = getElement(state, 'Inv', 'Torch');
  const gold = getElement(state, 'Wealth', 'Gold');
  const pc = getElement(state, 'PC', 'Kael');
  const room = getElement(state, 'R', '1');
  const unit = getElement(state, 'Unit', 'Rifles');

  const lines = [
    combat.nextRoundLine(state), combat.rosterLine(state), combat.initiativeLine('A 12'),
    combat.damageLine(foe, 2), combat.moveLine(foe, 'Close'), combat.outcomeLine(foe, 'dead'),
    resources.quantityLine(item, -1), resources.depletedLine(item),
    resources.wealthLine(gold, 5), resources.stepDownLine(pc, 'Supply', 'd8'),
    dungeon.roomLine('9', 'active', 'crypt', 'N:R2'), dungeon.statusLine(room, 'looted'),
    dungeon.exitLine(room, 'E:R4'),
    wargaming.nextTurnLine(state), wargaming.phaseLine(state, 'Move'),
    wargaming.casualtyLine(unit, 10), wargaming.statusLine(unit, 'Broken'),
    wargaming.heatLine(unit, 3), wargaming.armorLine(unit, 'CT8'),
    ...resources.snapshotLines(state),
    ...dungeon.snapshotLines(state),
    ...wargaming.snapshotLines(state, 'BATTLE'),
  ];

  for (const line of lines) {
    const [entry] = lex(line + '\n');
    assert.notEqual(entry.kind, 'prose', `${line} lexed as prose`);
  }
});

test('add-on edits never rewrite earlier lines', () => {
  const log = '[F:Thug|HP 6]\n@ Swing\n';
  const { line } = afterEdit(log, (f) => combat.damageLine(f, 2), 'F', 'Thug');
  assert.ok((log + line + '\n').startsWith(log));
});
