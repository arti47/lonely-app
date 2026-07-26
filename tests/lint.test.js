/** Lint rules (ledger T58) — one per catalogued defect in docs/spec-review.md. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { lex } from '../src/lonelog/lexer.js';
import { lint } from '../src/lonelog/lint.js';

const rules = (t) => lint(lex(t)).map((f) => f.rule);

test('L1 flags `=>` used as an operator (review #1)', () => {
  assert.ok(rules('[Wealth:Gold 50gc+7gc] => [Wealth: Gold 57gc]\n').includes('L1'));
  assert.ok(!rules('=> Good price! [Wealth:Gold+15]\n').includes('L1'));
});

test('L2 flags a line-leading `!` symbol (review #2)', () => {
  assert.ok(rules('! Thug attacks: d20+3=17 -> Hit\n').includes('L2'));
});

test('L3 flags [E:] and [Clock:] used for the same thing (review #3)', () => {
  assert.ok(rules('[E:AlertClock 2/6]\n[Clock:Suspicion 3/6]\n').includes('L3'));
  assert.ok(!rules('[Clock:Suspicion 3/6]\n').includes('L3'));
});

test('L4 flags "each" stats with no group count (review #4)', () => {
  assert.ok(rules('[F:Guard 2|HP 5 each|Close]\n').includes('L4'));
  assert.ok(!rules('[F:Guardx2|HP 5 each|Close]\n').includes('L4'));
});

test('L5 flags combat damage on an [N:] tag inside a battle (review #5)', () => {
  assert.ok(rules('[BATTLE]\n=> [N:Captain Streng|HP-1]\n[/BATTLE]\n').includes('L5'));
  assert.ok(!rules('=> [N:Captain Streng|HP-1]\n').includes('L5'));
});

test('L6 flags [Scenario:] outside a [BATTLE] block (review #6)', () => {
  assert.ok(rules('[Scenario:Raid|Grab the loot|5 turns]\n').includes('L6'));
  assert.ok(!rules('[BATTLE]\n[Scenario:Raid|Grab the loot|5 turns]\n[/BATTLE]\n').includes('L6'));
});

test('L7 flags a multiplier in the [Inv:] quantity field (review #7)', () => {
  assert.ok(rules('[Inv:Scroll of Push | x1]\n').includes('L7'));
  assert.ok(!rules('[Inv:Scroll of Push|1]\n').includes('L7'));
});

test('L8 reports non-canonical tag whitespace (review #8)', () => {
  const f = lint(lex('[Inv: Torch | 3]\n')).find((x) => x.rule === 'L8');
  assert.ok(f);
  assert.match(f.message, /\[Inv:Torch\|3\]/);
});

test('L9 flags mixed x and × multipliers (review #7)', () => {
  assert.ok(rules('[F:Goblinx3|HP 3]\n[Inv:Arrow×12]\n').includes('L9'));
});

test('L11 flags an X/Y value on a [Timer:] (review #10)', () => {
  assert.ok(rules('[Timer:Supply 4/5]\n').includes('L11'));
  assert.ok(!rules('[Timer:Dawn 3]\n').includes('L11'));
});

test('lint is advisory: a clean log produces no errors', () => {
  const findings = lint(lex([
    'S1 *Dark alley, midnight*',
    '@ Sneak past the guard',
    'd: Stealth d6=5 vs TN 4 -> Success',
    '=> I slip by unnoticed. [L:Alley|dark]',
    '? Does he see me?',
    '-> No, but... (d6=3)',
    '=> He lingers. [N:Guard|watchful]',
    '',
  ].join('\n')));
  assert.deepEqual(findings.filter((f) => f.severity === 'error'), []);
});

test('every finding cites its review section', () => {
  for (const f of lint(lex('[Timer:Supply 4/5]\n[Inv: Torch | 3]\n'))) {
    assert.match(f.review, /^#\d+$/);
  }
});
