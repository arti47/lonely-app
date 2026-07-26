/**
 * Learned roll templates and packs (CLAUDE.md §8 Phase 7, D4).
 *
 * The property that matters: a template is derived from lines the log already
 * contains, and applying it produces a spec the comparator evaluates — without
 * the app ever rolling anything (D2).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  shapeOf, detectRepeats, templateFromShape, applyTemplate,
  toPack, fromPack, PACK_KIND, REPEAT_THRESHOLD,
} from '../src/templates.js';
import { lex } from '../src/lonelog/lexer.js';
import { evaluate, rollLine } from '../src/compare.js';

const log = (lines) => lex(lines.join('\n') + '\n');

/* -------------------------------- shapes --------------------------------- */

test('a shape abstracts the rolled numbers and keeps the roll', () => {
  assert.equal(shapeOf('Stealth d6=5 vs TN 4 -> Success'), 'Stealth d6=# vs TN 4');
  assert.equal(shapeOf('Stealth d6=2 vs TN 4 -> Fail'), 'Stealth d6=# vs TN 4');
});

test('a different target is a different shape', () => {
  assert.notEqual(shapeOf('Stealth d6=5 vs TN 4'), shapeOf('Stealth d6=5 vs TN 6'));
});

test('shapes normalise whitespace and drop the outcome', () => {
  assert.equal(shapeOf('  Attack   d20+4=17   vs AC 12  ->  Hit, 1d8=5  '), 'Attack d20+4=# vs AC 12');
});

test('paired challenge dice collapse to one shape', () => {
  assert.equal(
    shapeOf('Action=4+Stat=2=6 vs Challenge=4,8 -> Weak Hit'),
    'Action=#+Stat=#=# vs Challenge=#',
  );
});

/* ------------------------------- detection ------------------------------- */

test('a shape is offered only once it repeats', () => {
  const twice = detectRepeats(log([
    'd: Stealth d6=5 vs TN 4 -> Success',
    'd: Stealth d6=2 vs TN 4 -> Fail',
  ]));
  assert.deepEqual(twice, [], `below ${REPEAT_THRESHOLD} occurrences it stays quiet`);

  const thrice = detectRepeats(log([
    'd: Stealth d6=5 vs TN 4 -> Success',
    'd: Stealth d6=2 vs TN 4 -> Fail',
    '@ Try again',
    'd: Stealth d6=6 vs TN 4 -> Success',
  ]));
  assert.equal(thrice.length, 1);
  assert.equal(thrice[0].shape, 'Stealth d6=# vs TN 4');
  assert.equal(thrice[0].count, 3);
});

test('shapes already saved are not offered again', () => {
  const entries = log([
    'd: Stealth d6=5 vs TN 4 -> Success',
    'd: Stealth d6=2 vs TN 4 -> Fail',
    'd: Stealth d6=6 vs TN 4 -> Success',
  ]);
  assert.deepEqual(detectRepeats(entries, { known: ['Stealth d6=# vs TN 4'] }), []);
});

test('detection ignores every line that is not a roll', () => {
  assert.deepEqual(detectRepeats(log([
    '@ Sneak', '? Seen?', '-> No', '=> Clear', 'tbl: Mood d4=2 -> Fog',
  ])), []);
});

test('repeats are ranked by how often they happen', () => {
  const found = detectRepeats(log([
    'd: Fight d6=1 vs TN 4 -> Fail',
    'd: Fight d6=2 vs TN 4 -> Fail',
    'd: Fight d6=3 vs TN 4 -> Fail',
    'd: Fight d6=4 vs TN 4 -> Success',
    'd: Sneak d6=1 vs TN 5 -> Fail',
    'd: Sneak d6=2 vs TN 5 -> Fail',
    'd: Sneak d6=3 vs TN 5 -> Fail',
  ]));
  assert.deepEqual(found.map((r) => [r.shape, r.count]), [
    ['Fight d6=# vs TN 4', 4],
    ['Sneak d6=# vs TN 5', 3],
  ]);
});

/* ------------------------------- templates ------------------------------- */

test('a template carries the label, dice and target from its shape', () => {
  const template = templateFromShape('Stealth d6=# vs TN 4', { count: 3 });
  assert.equal(template.label, 'Stealth');
  assert.equal(template.target, 4);
  assert.equal(template.targetLabel, 'TN');
  assert.deepEqual(template.inputs, [{ label: 'd6', die: 6 }]);
  assert.equal(template.seenCount, 3);
});

test('a multi-die shape asks for that many dice', () => {
  assert.equal(templateFromShape('Attack 2d6=# vs TN 7').inputs.length, 2);
  assert.equal(templateFromShape('Pool 4d6=#').inputs.length, 4);
});

test('named additions become modifiers the player supplies', () => {
  const template = templateFromShape('d20+Lockpicking=# vs DC 15');
  assert.deepEqual(template.modifiers, ['Lockpicking']);
  assert.equal(template.target, 15);
  assert.equal(template.targetLabel, 'DC');
});

test('a roll-under shape keeps its comparison direction', () => {
  assert.equal(templateFromShape('Sanity d100=# vs 55').compare, '>=');
  assert.equal(templateFromShape('Sanity d100=#<=55').compare, '<=');
});

test('applying a template yields a spec the comparator evaluates', () => {
  const template = templateFromShape('Stealth d6=# vs TN 4');
  const spec = applyTemplate(template, { dice: [5] });
  const result = evaluate(spec);

  assert.equal(result.outcome, 'Success');
  assert.equal(rollLine(spec, result), 'd: Stealth 5=5 vs TN 4 -> Success');
  assert.equal(lex(rollLine(spec, result) + '\n')[0].kind, 'dice');
});

test('applying a template never supplies the dice itself', () => {
  const spec = applyTemplate(templateFromShape('Stealth d6=# vs TN 4'), {});
  assert.deepEqual(spec.dice, [], 'the player rolls; the template only remembers the shape');
});

test('a template survives a round trip through its own shape', () => {
  const original = templateFromShape('Attack d20+4=# vs AC 12');
  const rebuilt = templateFromShape(original.shape);
  assert.deepEqual(
    { label: rebuilt.label, target: rebuilt.target, inputs: rebuilt.inputs },
    { label: original.label, target: original.target, inputs: original.inputs },
  );
});

/* --------------------------------- packs --------------------------------- */

test('a pack round-trips through export and import', () => {
  const templates = [
    templateFromShape('Stealth d6=# vs TN 4', { count: 5 }),
    templateFromShape('Attack d20+4=# vs AC 12', { count: 3 }),
  ];
  const pack = toPack('House rolls', templates);
  assert.equal(pack.kind, PACK_KIND);

  const back = fromPack(JSON.parse(JSON.stringify(pack)));
  assert.equal(back.name, 'House rolls');
  assert.deepEqual(back.templates.map((t) => t.shape), templates.map((t) => t.shape));
  assert.ok(back.templates.every((t) => t.packId), 'imported rolls are grouped by their pack');
});

test('an imported pack still evaluates', () => {
  const pack = toPack('P', [templateFromShape('Stealth d6=# vs TN 4')]);
  const [template] = fromPack(JSON.parse(JSON.stringify(pack))).templates;
  assert.equal(evaluate(applyTemplate(template, { dice: [5] })).outcome, 'Success');
});

test('a malformed pack is refused with a readable reason', () => {
  assert.throws(() => fromPack(null), /Not a Lonely roll pack/);
  assert.throws(() => fromPack({ app: 'other', kind: PACK_KIND }), /Not a Lonely roll pack/);
  assert.throws(() => fromPack({ app: 'lonely-app', kind: PACK_KIND }), /no templates/);
  assert.throws(
    () => fromPack({ app: 'lonely-app', kind: PACK_KIND, templates: [{ nope: 1 }] }),
    /no usable templates/,
  );
});

test('a pack is a by-product of play: shapes come from a real log', () => {
  const entries = log([
    'S1 *Alley*',
    'd: Stealth d6=5 vs TN 4 -> Success',
    'd: Stealth d6=2 vs TN 4 -> Fail',
    'd: Stealth d6=6 vs TN 4 -> Success',
  ]);
  const [repeat] = detectRepeats(entries);
  const pack = toPack('From play', [templateFromShape(repeat.shape, { count: repeat.count })]);
  assert.equal(fromPack(JSON.parse(JSON.stringify(pack))).templates[0].label, 'Stealth');
});
