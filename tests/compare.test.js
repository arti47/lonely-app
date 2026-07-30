/**
 * Comparator invariants (CLAUDE.md §9.5, ledger T3).
 *
 * The comparator only ever reads numbers the player entered. `tests/invariants`
 * separately proves no RNG exists anywhere in src/.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseComparison, evaluate, rollLine, resolveOracle, lookup, tableDie, ODDS, MODES,
} from '../src/compare.js';
import { lex } from '../src/lonelog/lexer.js';
import { fold, getTable } from '../src/lonelog/fold.js';

const foldText = (t) => fold(lex(t));

/* ---------------------------- T3: shorthand ----------------------------- */

test('T3 reads `vs TN` with an explicit outcome', () => {
  const c = parseComparison('Stealth d6=5 vs TN 4 -> Success');
  assert.equal(c.left, 5);
  assert.equal(c.target, 4);
  assert.equal(c.targetLabel, 'TN');
  assert.equal(c.satisfied, true);
  assert.equal(c.outcome, 'Success');
});

test('T3 reads DC and AC targets the same way', () => {
  assert.equal(parseComparison('d20+Lockpicking=17 vs DC 15 -> Success').satisfied, true);
  const ac = parseComparison('d20+4=11 vs AC 14 -> Miss');
  assert.equal(ac.satisfied, false);
  assert.equal(ac.targetLabel, 'AC');
});

test('T3 reads the ≥ / ≤ shorthand in both spellings', () => {
  assert.equal(parseComparison('5≥4 -> S').satisfied, true);
  assert.equal(parseComparison('5>=4').satisfied, true);
  assert.equal(parseComparison('2≤4 -> F').satisfied, true, '≤ is satisfied when the roll is under');
  assert.equal(parseComparison('2<=4').operator, '<=');
});

test('T3 reads bare S and F flags', () => {
  assert.equal(parseComparison('2≤4 F').flag, 'F');
  assert.equal(parseComparison('5≥4 S').flag, 'S');
});

test('T3 leaves a line it cannot interpret alone rather than guessing', () => {
  const c = parseComparison('Draw from deck -> Queen of Spades');
  assert.equal(c.left, null);
  assert.equal(c.target, null);
  assert.equal(c.satisfied, null);
  assert.equal(c.outcome, 'Queen of Spades');
});

test('T3 handles `vs 4+` written without a label', () => {
  const c = parseComparison('d6=5 vs 4+ -> Yes');
  assert.equal(c.target, 4);
  assert.equal(c.satisfied, true);
});

/* ---------------------------- evaluate modes ---------------------------- */

test('target mode sums dice and modifiers', () => {
  const r = evaluate({ mode: 'target', dice: [4, 3], modifier: 2, target: 7, targetLabel: 'TN' });
  assert.equal(r.total, 9);
  assert.equal(r.outcome, 'Success');
  assert.match(r.detail, /4\+3\+2=9 vs TN 7/);
});

test('target mode supports roll-under systems', () => {
  const under = evaluate({ mode: 'target', dice: [32], target: 55, compare: '<=' });
  assert.equal(under.outcome, 'Success');
  const over = evaluate({ mode: 'target', dice: [80], target: 55, compare: '<=' });
  assert.equal(over.outcome, 'Fail');
});

test('pool mode counts dice at or over the threshold', () => {
  const r = evaluate({ mode: 'pool', dice: [6, 5, 3, 1], threshold: 5 });
  assert.equal(r.total, 2);
  assert.equal(r.outcome, '2 successes');
  assert.equal(evaluate({ mode: 'pool', dice: [1, 2], threshold: 5 }).outcome, 'Failure');
  assert.equal(evaluate({ mode: 'pool', dice: [6, 2], threshold: 5 }).outcome, '1 success');
});

test('paired challenge dice give strong / weak / miss', () => {
  const strong = evaluate({ mode: 'paired', dice: [6], modifier: 3, challenge: [4, 8] });
  assert.equal(strong.total, 9);
  assert.equal(strong.outcome, 'Strong Hit');

  const weak = evaluate({ mode: 'paired', dice: [4], modifier: 2, challenge: [4, 8] });
  assert.equal(weak.outcome, 'Weak Hit');

  const miss = evaluate({ mode: 'paired', dice: [1], modifier: 1, challenge: [4, 8] });
  assert.equal(miss.outcome, 'Miss');
});

test('paired mode reports a match on equal challenge dice', () => {
  const r = evaluate({ mode: 'paired', dice: [5], modifier: 2, challenge: [6, 6] });
  assert.ok(r.notes.includes('Match'));
});

test('paired mode ties go to the challenge die, not the player', () => {
  const tie = evaluate({ mode: 'paired', dice: [4], modifier: 0, challenge: [4, 4] });
  assert.equal(tie.outcome, 'Miss', 'a total equal to the challenge die does not beat it');
});

test('keep mode keeps the highest or lowest dice', () => {
  const high = evaluate({ mode: 'keep', dice: [6, 5, 4, 2], keep: 1, keepWhich: 'high', target: 5 });
  assert.equal(high.total, 6);
  assert.equal(high.outcome, 'Success');

  const low = evaluate({ mode: 'keep', dice: [6, 5, 4, 2], keep: 1, keepWhich: 'low', target: 5 });
  assert.equal(low.total, 2);
  assert.equal(low.outcome, 'Fail');

  const two = evaluate({ mode: 'keep', dice: [6, 5, 4, 2], keep: 2, keepWhich: 'high' });
  assert.equal(two.total, 11);
});

test('fudge mode counts plus and minus faces', () => {
  const r = evaluate({ mode: 'fudge', plus: 2, minus: 1, modifier: 3, target: 4 });
  assert.equal(r.total, 4);
  assert.equal(r.outcome, 'Success');
  assert.match(r.detail, /2\+ \/ 1− = 1\+3=\+4/);
});

test('fudge mode reports a signed ladder value with no target', () => {
  assert.equal(evaluate({ mode: 'fudge', plus: 0, minus: 2, modifier: 0 }).outcome, '-2');
  assert.equal(evaluate({ mode: 'fudge', plus: 3, minus: 0, modifier: 0 }).outcome, '+3');
});

test('band mode labels a total by its degree band', () => {
  const bands = [
    { min: 10, label: 'Strong Hit' },
    { min: 7, max: 9, label: 'Weak Hit' },
    { max: 6, label: 'Miss' },
  ];
  assert.equal(evaluate({ mode: 'bands', dice: [5, 5], bands }).outcome, 'Strong Hit');
  assert.equal(evaluate({ mode: 'bands', dice: [4, 4], bands }).outcome, 'Weak Hit');
  assert.equal(evaluate({ mode: 'bands', dice: [2, 3], bands }).outcome, 'Miss');
});

test('matches are surfaced but never acted on', () => {
  const r = evaluate({ mode: 'target', dice: [4, 4], target: 5 });
  assert.ok(r.notes.some((n) => n.startsWith('Match')));
  assert.equal(r.outcome, 'Success', 'a match must not change the outcome by itself');
});

test('every mode produces a d: line the lexer reads back as a roll', () => {
  const specs = [
    { mode: 'target', label: 'Stealth', dice: [5], target: 4 },
    { mode: 'pool', label: 'Fight', dice: [6, 3], threshold: 5 },
    { mode: 'paired', label: 'Action', dice: [4], modifier: 2, challenge: [3, 8] },
    { mode: 'keep', label: 'Attack', dice: [6, 2], keep: 1, keepWhich: 'high', target: 5 },
    { mode: 'fudge', label: 'Sneak', plus: 2, minus: 1, modifier: 1, target: 2 },
    { mode: 'bands', label: 'Move', dice: [4, 5], bands: [{ min: 10, label: 'Strong Hit' }, { max: 9, label: 'Weak Hit' }] },
  ];
  for (const spec of specs) {
    const line = rollLine(spec, evaluate(spec));
    const [entry] = lex(line + '\n');
    assert.equal(entry.kind, 'dice', `${line} lexed as ${entry.kind}`);
    assert.ok(/->/.test(line), `${line} must carry a resolution`);
  }
});

test('MODES all evaluate without throwing on empty input', () => {
  for (const m of MODES) {
    assert.doesNotThrow(() => evaluate({ mode: m.id, dice: [] }), m.id);
  }
});

/* -------------------------------- oracle -------------------------------- */

test('the oracle answers yes below the odds threshold and no above it', () => {
  assert.match(resolveOracle('even', 20).answer, /^Yes/);
  assert.match(resolveOracle('even', 80).answer, /^No/);
  assert.match(resolveOracle('likely', 70).answer, /^Yes/);
  assert.match(resolveOracle('unlikely', 40).answer, /^No/);
});

test('oracle extremes intensify the answer', () => {
  assert.equal(resolveOracle('even', 1).answer, 'Yes, and...');
  assert.equal(resolveOracle('even', 100).answer, 'No, and...');
});

test('the oracle emits a question and a roll line that both lex', () => {
  const lines = resolveOracle('unlikely', 12).line('Does the guard notice me?');
  const entries = lex(lines.join('\n') + '\n');
  assert.deepEqual(entries.map((e) => e.kind), ['question', 'dice']);
});

test('every odds rung is reachable and ordered', () => {
  const thresholds = ODDS.map((o) => o.threshold);
  assert.deepEqual(thresholds, [...thresholds].sort((a, b) => b - a));
});

/* -------------------------- tables from the log -------------------------- */

test('T5 an inline table definition folds into a usable table', () => {
  const state = foldText([
    'tbl: Forest Encounter (d6)',
    '  1-2: Nothing — eerie silence',
    '  3: Animal tracks, fresh',
    '  4: Abandoned campsite',
    '  5: Traveler on the road',
    '  6: Something is following you',
    '',
  ].join('\n'));

  const table = getTable(state, 'Forest Encounter');
  assert.ok(table, 'the table should be defined');
  assert.equal(table.die, 'd6');
  assert.equal(table.entries.length, 5);
  assert.equal(lookup(table, 1).result, 'Nothing — eerie silence');
  assert.equal(lookup(table, 2).result, 'Nothing — eerie silence');
  assert.equal(lookup(table, 5).result, 'Traveler on the road');
  assert.equal(lookup(table, 5).line, 'tbl: Forest Encounter d6=5 -> Traveler on the road');
});

test('T6 a filtered option set folds and indexes by position', () => {
  const state = foldText('tbl: Mood [Tense, Melancholic, Hopeful, Uncanny]\n');
  const table = getTable(state, 'Mood');
  assert.deepEqual(table.options, ['Tense', 'Melancholic', 'Hopeful', 'Uncanny']);
  assert.equal(tableDie(table), 'd4');
  assert.equal(lookup(table, 2).result, 'Melancholic');
  assert.equal(lookup(table, 2).line, 'tbl: Mood d4=2 -> Melancholic');
});

test('T8 a multi-line generator folds its axes', () => {
  const state = foldText([
    'gen: NPC (custom)',
    '  Role: d6=3 -> Merchant',
    '  Trait: d6=5 -> Secretive',
    '  Want: d6=1 -> Escape',
    '',
  ].join('\n'));

  const gen = state.generators.get('npc');
  assert.ok(gen);
  assert.deepEqual(gen.axes.map((a) => [a.axis, a.roll, a.result]), [
    ['Role', 'd6=3', 'Merchant'],
    ['Trait', 'd6=5', 'Secretive'],
    ['Want', 'd6=1', 'Escape'],
  ]);
});

test('T7 the single-line generator form is not treated as a block header', () => {
  const [entry] = lex('gen: Mythic Event d100=78 + 11 -> NPC Action / Betray\n');
  assert.equal(entry.kind, 'gen');
  assert.equal(entry.generator, null);
});

test('a table lookup outside any definition still lexes and folds', () => {
  const state = foldText('tbl: d100=42 -> "A broken sword"\n');
  assert.equal(state.counts.lookups, 1);
});

test('table bodies do not swallow the lines after them', () => {
  const entries = lex([
    'tbl: Weather (d4)',
    '  1: Clear',
    '  2: Fog',
    '',
    '@ Set out anyway',
    '',
  ].join('\n'));
  assert.deepEqual(
    entries.map((e) => e.kind),
    ['tbl', 'tableEntry', 'tableEntry', 'blank', 'action'],
  );
});

test('lookup is safe on a table with neither entries nor options', () => {
  assert.deepEqual(lookup({ name: 'Empty', entries: [], options: [] }, 3), { result: null, line: null });
  assert.deepEqual(lookup(null, 3), { result: null, line: null });
});

/* ---- A roll with nothing to compare has no verdict of its own (flow) ----- */

test('a target roll with no target offers no outcome to invent', () => {
  // Core §3.2.1 asks every roll for an outcome. `d: 17 -> 17` is not one.
  const spec = { mode: 'target', dice: ['17'] };
  const result = evaluate(spec);
  assert.equal(result.outcome, null);
  assert.equal(result.total, 17);
  assert.equal(rollLine(spec, result), 'd: 17');
});

test("the player's own word becomes the outcome", () => {
  // The specs write `d: 19 >= 13 Hit` as readily as `-> Success`.
  const spec = { mode: 'target', label: 'Slash', dice: ['19'], target: '13', outcome: 'Hit' };
  assert.equal(rollLine(spec, evaluate(spec)), 'd: Slash 19=19 vs TN 13 -> Hit');

  const bare = { mode: 'target', dice: ['42'], outcome: 'Partial success' };
  assert.equal(rollLine(bare, evaluate(bare)), 'd: 42 -> Partial success');
});

test('keep mode with no target says nothing about the total either', () => {
  const spec = { mode: 'keep', dice: ['17', '3'], keep: '1', keepWhich: 'high' };
  assert.equal(evaluate(spec).outcome, null);
  assert.ok(!rollLine(spec, evaluate(spec)).includes('->'));
});

test('a mode that has a verdict without a target keeps it', () => {
  // A Fate ladder rung is the result; a success pool counts its own hits.
  assert.equal(evaluate({ mode: 'fudge', plus: 3, minus: 0 }).outcome, '+3');
  assert.equal(evaluate({ mode: 'pool', dice: ['6', '2'], threshold: '5' }).outcome, '1 success');
  assert.equal(evaluate({ mode: 'paired', dice: ['7'], challenge: ['3', '9'] }).outcome, 'Weak Hit');
});

test('every line the comparator writes still lexes as a dice line', () => {
  for (const spec of [
    { mode: 'target', dice: ['17'], outcome: 'Hit' },
    { mode: 'target', dice: ['17'] },
    { mode: 'keep', dice: ['17', '3'], keep: '1' },
    { mode: 'fudge', plus: 2, minus: 1 },
  ]) {
    const line = rollLine(spec, evaluate(spec));
    const [entry] = lex(line + '\n');
    assert.equal(entry.kind, 'dice', `${line} lexed as ${entry.kind}`);
  }
});
