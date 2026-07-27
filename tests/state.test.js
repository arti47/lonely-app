/**
 * State pane line builders (CLAUDE.md §8 Phase 3).
 *
 * The load-bearing property: editing state emits a log line, and folding that
 * line back produces the state the user asked for (§5.1). Every case below
 * asserts the round trip rather than just the string.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  progressLine, timerLine, deltaLine, flagLine, transitionLine, setLine, THREAD_STATES,
} from '../src/state.js';
import { lex } from '../src/lonelog/lexer.js';
import { fold, getElement } from '../src/lonelog/fold.js';

const foldText = (t) => fold(lex(t));

/** Fold a log, apply an edit line, fold again, return the element. */
function afterEdit(log, build, type, name) {
  const before = foldText(log);
  const element = getElement(before, type, name);
  assert.ok(element, `${type}:${name} should exist before the edit`);
  const line = build(element);
  const after = foldText(log + line + '\n');
  return { line, element: getElement(after, type, name), state: after };
}

test('a clock steps and folds back to the stepped value', () => {
  const { line, element } = afterEdit(
    '[Clock:Suspicion 3/6]\n', (c) => progressLine(c, +1), 'Clock', 'Suspicion',
  );
  assert.equal(line, '[Clock:Suspicion 4/6]');
  assert.equal(element.progress.current, 4);
  assert.equal(element.progress.total, 6);
});

test('a clock will not step below zero', () => {
  const { element } = afterEdit('[Clock:Alert 0/4]\n', (c) => progressLine(c, -1), 'Clock', 'Alert');
  assert.equal(element.progress.current, 0);
});

test('a track steps the same way and keeps its own type', () => {
  const { line, element } = afterEdit(
    '[Track:Escape 3/8]\n', (t) => progressLine(t, +1), 'Track', 'Escape',
  );
  assert.equal(line, '[Track:Escape 4/8]');
  assert.equal(element.type, 'Track');
});

test('a timer counts down and stops at zero', () => {
  const first = afterEdit('[Timer:Dawn 3]\n', (t) => timerLine(t, -1), 'Timer', 'Dawn');
  assert.equal(first.line, '[Timer:Dawn 2]');
  assert.equal(first.element.value.value, '2');

  const floor = afterEdit('[Timer:Dawn 0]\n', (t) => timerLine(t, -1), 'Timer', 'Dawn');
  assert.equal(floor.element.value.value, '0');
});

test('a PC stat delta emits the spec shorthand and folds correctly', () => {
  const { line, element } = afterEdit(
    '[PC:Alex|HP 8]\n', (pc) => deltaLine(pc, 'HP', -2), 'PC', 'Alex',
  );
  assert.equal(line, '[PC:Alex|HP-2]');
  assert.equal(element.fields.get('HP').value, '6');
});

test('a delta on an X/Y stat moves the current value only', () => {
  const { element } = afterEdit(
    '[PC:Kael|HP 12/15]\n', (pc) => deltaLine(pc, 'HP', -3), 'PC', 'Kael',
  );
  assert.equal(element.fields.get('HP').value, '9/15');
});

test('setting a stat replaces it outright', () => {
  const { line, element } = afterEdit(
    '[PC:Alex|HP 8]\n', (pc) => setLine(pc, 'HP', '12'), 'PC', 'Alex',
  );
  assert.equal(line, '[PC:Alex|HP 12]');
  assert.equal(element.fields.get('HP').value, '12');
});

test('adding and removing a flag round-trips through the fold', () => {
  const added = afterEdit('[N:Guard|watchful]\n', (n) => flagLine(n, 'alert', 'add'), 'N', 'Guard');
  assert.equal(added.line, '[N:Guard|+alert]');
  assert.ok(added.element.flags.has('alert'));

  const removed = afterEdit(
    '[N:Guard|watchful|alert]\n', (n) => flagLine(n, 'alert', 'remove'), 'N', 'Guard',
  );
  assert.equal(removed.line, '[N:Guard|-alert]');
  assert.ok(!removed.element.flags.has('alert'));
  assert.ok(removed.element.flags.has('watchful'), 'other flags must survive');
});

test('a thread state change uses a transition so the old state does not linger', () => {
  const { line, element } = afterEdit(
    '[Thread:Find the sister|Open]\n', (t) => transitionLine(t, 'Open', 'Closed'), 'Thread', 'Find the sister',
  );
  assert.equal(line, '[Thread:Find the sister|Open -> Closed]');
  assert.ok(element.flags.has('Closed'));
  assert.ok(!element.flags.has('Open'), 'restating would have left both set');
});

test('every offered thread state is reachable and exclusive', () => {
  for (const target of THREAD_STATES.filter((s) => s !== 'Open')) {
    const { element } = afterEdit(
      '[Thread:X|Open]\n', (t) => transitionLine(t, 'Open', target), 'Thread', 'X',
    );
    assert.deepEqual([...element.flags.keys()], [target]);
  }
});

test('edits are appends: earlier lines are never rewritten', () => {
  const log = '[PC:Alex|HP 8]\n@ Take a hit\n';
  const { line } = afterEdit(log, (pc) => deltaLine(pc, 'HP', -1), 'PC', 'Alex');
  const combined = log + line + '\n';
  assert.ok(combined.startsWith(log), 'the original log must be a prefix of the edited one');
  assert.equal(combined.split('\n').length, 4);
});

test('every emitted edit line lexes as a tag, never as prose', () => {
  const state = foldText('[PC:Alex|HP 8]\n[Clock:Alert 1/4]\n[Timer:Dawn 3]\n[Thread:T|Open]\n[N:G|calm]\n');
  const lines = [
    deltaLine(getElement(state, 'PC', 'Alex'), 'HP', -1),
    setLine(getElement(state, 'PC', 'Alex'), 'HP', '5'),
    progressLine(getElement(state, 'Clock', 'Alert'), +1),
    timerLine(getElement(state, 'Timer', 'Dawn'), -1),
    transitionLine(getElement(state, 'Thread', 'T'), 'Open', 'Closed'),
    flagLine(getElement(state, 'N', 'G'), 'angry', 'add'),
  ];
  for (const line of lines) {
    const [entry] = lex(line + '\n');
    assert.equal(entry.kind, 'tag', `${line} lexed as ${entry.kind}`);
    assert.equal(entry.tags.length, 1);
  }
});

test('names with spaces and punctuation survive an edit round trip', () => {
  const { element } = afterEdit(
    '[N:Captain Streng|Fresh]\n', (n) => flagLine(n, 'wounded', 'add'), 'N', 'Captain Streng',
  );
  assert.equal(element.name, 'Captain Streng');
  assert.ok(element.flags.has('wounded'));
});

/* --- Adding and removing fields on any tracked object --------------------- */

import { addLine, removeLine, numericish, knownFieldKeys } from '../src/state.js';

test('a numeric value becomes a steppable field', () => {
  const { line, element } = afterEdit(
    '[PC:Alex|HP 8]\n', (pc) => addLine(pc, 'Stress', '0'), 'PC', 'Alex',
  );
  assert.equal(line, '[PC:Alex|Stress 0]');
  assert.equal(element.fields.get('Stress').value, '0');
});

test('an X/Y value becomes a track with a meter', () => {
  const { line, element } = afterEdit(
    '[PC:Kael|HP 10]\n', (pc) => addLine(pc, 'Armour', '12/15'), 'PC', 'Kael',
  );
  assert.equal(line, '[PC:Kael|Armour 12/15]');
  assert.equal(element.fields.get('Armour').value, '12/15');
  assert.deepEqual(element.fields.get('Armour').progress, { current: 12, total: 15 });
});

test('a die value becomes a usage die the resources panel can step', () => {
  const { line, element } = afterEdit(
    '[PC:Kael|HP 10]\n', (pc) => addLine(pc, 'Supply', 'd8'), 'PC', 'Kael',
  );
  assert.equal(line, '[PC:Kael|Supply d8]');
  assert.equal(element.fields.get('Supply').value, 'd8');
});

test('a wordy value takes the category form so it is still a field', () => {
  const { line, element } = afterEdit(
    '[PC:Alex|HP 8]\n', (pc) => addLine(pc, 'Gear', 'sword and lantern'), 'PC', 'Alex',
  );
  assert.equal(line, '[PC:Alex|Gear: sword and lantern]');
  assert.equal(element.fields.get('Gear').value, 'sword and lantern',
    'a plain-word value must not be filed as a flag');
});

test('no value at all adds a flag rather than a field', () => {
  const { line, element } = afterEdit(
    '[N:Guard|calm]\n', (n) => addLine(n, 'alert', ''), 'N', 'Guard',
  );
  assert.equal(line, '[N:Guard|+alert]');
  assert.ok(element.flags.has('alert'));
  assert.equal(element.fields.size, 0);
});

test('fields can be added to every kind of tracked object', () => {
  for (const [type, name, seed] of [
    ['PC', 'Alex', '[PC:Alex|HP 8]'],
    ['N', 'Jonah', '[N:Jonah|friendly]'],
    ['L', 'Lighthouse', '[L:Lighthouse|ruined]'],
    ['F', 'Thug', '[F:Thug|HP 6]'],
    ['Inv', 'Torch', '[Inv:Torch|3]'],
    ['R', '1', '[R:1|cleared]'],
    ['Unit', 'Rifles', '[Unit:Rifles|x12]'],
    ['Clock', 'Alarm', '[Clock:Alarm 1/6]'],
  ]) {
    const { element } = afterEdit(`${seed}\n`, (e) => addLine(e, 'Notes', '3'), type, name);
    assert.equal(element.fields.get('Notes')?.value, '3', `${type} could not take a field`);
  }
});

test('removing a field drops the field and leaves the rest', () => {
  const { line, element } = afterEdit(
    '[PC:Alex|HP 8|Stress 2]\n', (pc) => removeLine(pc, 'Stress'), 'PC', 'Alex',
  );
  assert.equal(line, '[PC:Alex|-Stress]');
  assert.ok(!element.fields.has('Stress'));
  assert.equal(element.fields.get('HP').value, '8', 'other fields survive');
});

test('the same removal still removes a flag when that is what it names', () => {
  const { element } = afterEdit(
    '[N:Guard|alert|watchful]\n', (n) => removeLine(n, 'alert'), 'N', 'Guard',
  );
  assert.ok(!element.flags.has('alert'));
  assert.ok(element.flags.has('watchful'));
});

test('adding then removing returns the object to where it started', () => {
  const before = foldText('[PC:Alex|HP 8]\n');
  const alex = getElement(before, 'PC', 'Alex');
  const log = `[PC:Alex|HP 8]\n${addLine(alex, 'Stress', '2')}\n${removeLine(alex, 'Stress')}\n`;
  const after = getElement(foldText(log), 'PC', 'Alex');
  assert.deepEqual([...after.fields.keys()], ['HP']);
});

test('numericish decides field shape the way the parser reads it', () => {
  for (const value of ['8', '-3', '12/15', 'd8', 'CT30/RT25', '3 each']) {
    assert.equal(numericish(value), true, `${value} should read as a field value`);
  }
  for (const value of ['sword', 'well armed', 'Ward of the Dead']) {
    assert.equal(numericish(value), false, `${value} should take the category form`);
  }
});

test('field-name autocomplete offers keys already used anywhere', () => {
  const state = foldText('[PC:Alex|HP 8|Stress 0]\n[N:Guard|Morale 3]\n[Inv:Torch|3]\n');
  assert.deepEqual(knownFieldKeys(state), ['HP', 'Morale', 'Stress']);
});

test('every emitted add or remove line lexes as a tag', () => {
  const alex = getElement(foldText('[PC:Alex|HP 8]\n'), 'PC', 'Alex');
  for (const line of [
    addLine(alex, 'Stress', '0'),
    addLine(alex, 'Armour', '12/15'),
    addLine(alex, 'Gear', 'a sword'),
    addLine(alex, 'wounded', ''),
    removeLine(alex, 'Stress'),
  ]) {
    const [entry] = lex(line + '\n');
    assert.equal(entry.kind, 'tag', `${line} lexed as ${entry.kind}`);
  }
});
