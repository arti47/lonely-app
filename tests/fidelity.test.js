/**
 * Second-pass spec-fidelity audit (CLAUDE.md §11, `docs/audit.md` B1–B8).
 *
 * Each test closes one finding from reading the five vendored specs against the
 * app. They assert the *specs' own examples*, quoted verbatim, so a regression
 * has to break a documented form to pass unnoticed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { lex } from '../src/lonelog/lexer.js';
import { fold, getElement, elementsOfType } from '../src/lonelog/fold.js';
import { render } from '../src/lonelog/render.js';
import { extractTags } from '../src/lonelog/tags.js';
import { currentFlag } from '../src/state.js';
import { nextSceneNumber } from '../src/composer.js';
import * as combat from '../src/addons/combat.js';
import * as wargaming from '../src/addons/wargaming.js';
import * as resources from '../src/addons/resources.js';
import { ENTRIES } from '../src/reference.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (lines) => {
  const text = lines.join('\n') + '\n';
  const entries = lex(text);
  return { text, entries, state: fold(entries) };
};

/* ---------------- B1 — digital scene headers are scene markers ------------ */

test('B1 a markdown scene heading is a scene, not a heading (core §5.3)', () => {
  // The spec's digital format, verbatim from §5.3.
  const { entries, state } = read(['### S1 *School library after hours*', '@ Look around']);
  assert.equal(entries[0].kind, 'marker');
  assert.equal(entries[0].marker.kind, 'scene');
  assert.equal(entries[0].marker.scene, 1);
  assert.equal(entries[0].level, 3, 'the heading level is kept');
  assert.equal(state.scenes.length, 1);
  assert.equal(state.marker.scene.id, 'S1');
});

test('B1 every digital scene form folds, and numbering continues past them', () => {
  const { state } = read([
    '## Session 1',
    '### S1 *Tavern, evening*',
    '### S5a *Flashback: Father’s workshop*',
    '### S7.2 *Day 3: Mountains*',
    '### T2-S1 *Meanwhile, ally in the city*',
    '### S8 *Arriving*',
  ]);
  assert.deepEqual(state.scenes.map((s) => s.id), ['S1', 'S5a', 'S7.2', 'T2-S1', 'S8']);
  assert.equal(state.sessions.length, 1, 'a session heading is still a session');
  assert.equal(nextSceneNumber(state), 9, 'the composer continues from the digital scenes');
});

test('B1 a block opened in a digital scene header opens and closes (combat §1.1)', () => {
  const { state } = read([
    '### S5 *Warehouse ambush* [COMBAT]',
    '[F:Thug|HP 6|Close]',
    '### S6 *Outside, after*',
  ]);
  assert.ok(state.addons.has('combat'));
  assert.equal(state.blocks.length, 1, 'the implicit block closed at the next scene');
  assert.equal(state.blocks[0].name, 'COMBAT');
  assert.equal(state.blockStack.length, 0, 'nothing is left open');
});

test('B1 reading a marker out of a heading stays lossless (§5.2)', () => {
  const { text, entries } = read([
    '## Session 1',
    '### S1 *School library after hours*',
    '#### Rd1',
    '### Not a scene at all',
  ]);
  assert.equal(render(entries), text);
  assert.deepEqual(entries.map((e) => e.kind), ['heading', 'marker', 'marker', 'heading']);
});

/* ------------------- B2 — roll context without a category ----------------- */

test('B2 every roll-context example in core §4.1.9 reads as roll context', () => {
  const lines = [
    'd: Investigate 2d6 [Be kind to others, Naive] = 8 -> Mixed',
    'd: Stealth d6 [+cover, -injured] vs TN 4 -> Fail',
    'd: Persuade 2d6 [power: silver tongue | against: suspicious-2] = 9 -> Strong Hit',
  ];
  for (const line of lines) {
    const { rollContext, annotations } = extractTags(line, { diceLine: true });
    assert.equal(rollContext.length, 1, `${line} — roll context not recognised`);
    assert.equal(annotations.length, 0, `${line} — recorded as an annotation instead`);
  }
});

test('B2 a bracket outside a dice line is still an annotation (combat §3.3)', () => {
  const { annotations, rollContext } = extractTags('@(Thug A) Rushes in [Far->Close]');
  assert.equal(annotations.length, 1);
  assert.equal(rollContext.length, 0);
});

/* ------------- B3 — status vocabularies match the specs' own case ---------- */

test('B3 the current state is matched case-insensitively and by recency', () => {
  const { state } = read(['[Unit:Orc Mob|full|Morale 5|Fresh]', '[Unit:Orc Mob|half|wavering]']);
  const unit = getElement(state, 'Unit', 'Orc Mob');
  // The log left both sizes set; the current one is the one written last.
  assert.equal(currentFlag(unit, wargaming.ABSTRACT_SIZE), 'half');
  // Written lowercase in the spec's own example, tabulated capitalised in §2.
  assert.equal(currentFlag(unit, wargaming.UNIT_STATUS), 'wavering');
  assert.equal(currentFlag(unit, ['Nothing', 'Here']), null);
});

test('B3 a lowercase unit status transitions rather than accumulating', () => {
  const first = read(['[Unit:Rifles|x8|wavering]']);
  const unit = getElement(first.state, 'Unit', 'Rifles');
  const line = wargaming.statusLine(unit, 'Steady');
  assert.equal(line, '[Unit:Rifles|wavering -> Steady]');

  const after = fold(lex(`${first.text}${line}\n`));
  const rolled = getElement(after, 'Unit', 'Rifles');
  const statuses = [...rolled.flags.keys()].filter((f) => currentFlag(rolled, wargaming.UNIT_STATUS) !== null
    && wargaming.UNIT_STATUS.some((s) => s.toLowerCase() === f.toLowerCase()));
  assert.deepEqual(statuses, ['Steady'], 'the old status must be gone, not merely joined');
});

test('B3 a lowercase position transitions too (combat §3.3)', () => {
  const first = read(['[F:Thug|HP 6|close]']);
  const foe = getElement(first.state, 'F', 'Thug');
  assert.equal(combat.moveLine(foe, 'Engaged'), '[F:Thug|close -> Engaged]');

  const after = fold(lex(`${first.text}${combat.moveLine(foe, 'Engaged')}\n`));
  const moved = getElement(after, 'F', 'Thug');
  assert.deepEqual([...moved.flags.keys()], ['Engaged']);
});

test('B3 abstract size steps from the size the log last recorded', () => {
  const { state, text } = read(['[Unit:Orc Mob|full|Morale 5|Fresh]', '[Unit:Orc Mob|half|wavering]']);
  const unit = getElement(state, 'Unit', 'Orc Mob');
  assert.equal(wargaming.sizeLine(unit, 'depleted'), '[Unit:Orc Mob|half -> depleted]');

  const after = fold(lex(`${text}${wargaming.sizeLine(unit, 'depleted')}\n`));
  const sized = getElement(after, 'Unit', 'Orc Mob');
  assert.equal(currentFlag(sized, wargaming.ABSTRACT_SIZE), 'depleted');
  assert.ok(!sized.flags.has('half'), 'the previous size must be cleared');
});

/* ---------------- B4 — the resource snapshot keeps every currency ---------- */

test('B4 a snapshot restates every currency in a Wealth tag (resources §5)', () => {
  const { state } = read(['[Wealth:Gold 52|Silver 8]', '[Inv:Torch|2]']);
  const lines = resources.snapshotLines(state);
  assert.ok(lines.includes('[Wealth:Gold 52|Silver 8]'),
    `Silver was dropped: ${JSON.stringify(lines)}`);

  // The snapshot must fold back into the same wealth it was taken from.
  const before = getElement(state, 'Wealth', 'Gold');
  const after = getElement(fold(lex(lines.join('\n') + '\n')), 'Wealth', 'Gold');
  assert.equal(after.value.value, before.value.value);
  assert.deepEqual([...after.fields.keys()], [...before.fields.keys()]);
});

/* ------------------ B5 — documented forms the specs attest ---------------- */

test('B5 every dialogue example uses a form the spec defines (§4.4, A.7)', () => {
  const entry = ENTRIES.find((e) => e.id === 'dialogue');
  for (const example of entry.examples) {
    assert.match(example, /^(PC|N \([^)]+\)):/,
      `${example} — the spec defines only \`PC:\` and \`N (Name):\``);
    assert.equal(lex(example + '\n')[0].kind, 'dialogue');
  }
});

/* --------------- B8 — the add-on barrel survives any import order ---------- */

test('B8 importing an add-on before the barrel does not throw', () => {
  const script = "import * as w from './src/addons/wargaming.js';"
    + "import { ownedTypes } from './src/addons/index.js';"
    + "if (!w.types.length || !ownedTypes().has('Unit')) process.exit(2);";
  execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root });
});

/* -------- B6 — the same log in either format folds to the same state ------- */

test('B6 digital and analog forms of one log are equivalent (T27, core §2.4)', () => {
  const body = ['@ Sneak inside', 'd: Stealth d6=5 vs TN 4 -> Success'];
  const digital = read([
    '## Session 1', '### S1 *School library after hours*', ...body,
    '[COMBAT]', '[F:Thug|HP 6]', '[/COMBAT]', '### S2 *Outside*',
  ]);
  const analog = read([
    '=== Session 1 ===', 'S1 *School library after hours*', ...body,
    '--- COMBAT ---', '[F:Thug|HP 6]', '--- END COMBAT ---', 'S2 *Outside*',
  ]);

  // Line numbers and raw text differ by construction; everything derived must not.
  const shape = (s) => JSON.stringify(s, (k, v) => (
    ['line', 'lastLine', 'firstLine', 'startLine', 'endLine', 'history', 'raw', 'form'].includes(k)
      ? undefined
      : v instanceof Map ? { m: [...v] } : v instanceof Set ? { s: [...v].sort() } : v));

  assert.equal(shape(digital.state), shape(analog.state));
  assert.equal(digital.state.sessions[0].title, 'Session 1');
  assert.equal(analog.state.sessions[0].title, 'Session 1');
});

/* ------------- spec forms that must keep folding, as a whole -------------- */

test('a digital log in the specs’ own shape folds completely', () => {
  const { state } = read([
    '---',
    'title: Clearview Mystery',
    '---',
    '',
    '## Session 1',
    '*Date: 2025-09-03 | Duration: 1h30 | Scenes: S1-S2*',
    '',
    '### S1 *School library after hours*',
    '[PC:Alex|HP 8|Stress 0]',
    '@ Search the shelves',
    'd: d20+4=17 vs DC 15 -> Success',
    '=> A loose page falls out. [N:Librarian|watchful]',
    '[Clock:Suspicion 1/6]',
    '',
    '### S2 *Outside the library, empty hall*',
    '@ Slip away',
  ]);

  assert.equal(state.scenes.length, 2);
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0].meta.date, '2025-09-03');
  assert.equal(state.meta.title.value, 'Clearview Mystery');
  assert.equal(elementsOfType(state, 'PC').length, 1);
  assert.equal(getElement(state, 'Clock', 'Suspicion').progress.current, 1);
});
