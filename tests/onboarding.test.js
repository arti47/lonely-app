/** First-run surfaces (CLAUDE.md §8.2 F7–F9). */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TASKS, progress, shouldShowChecklist, SAMPLE_LOG, landingRoute,
} from '../src/onboarding.js';
import { lex } from '../src/lonelog/lexer.js';
import { fold } from '../src/lonelog/fold.js';
import { render } from '../src/lonelog/render.js';
import { lint } from '../src/lonelog/lint.js';
import { surfaced } from '../src/addons/index.js';

const read = (lines) => {
  const text = lines.join('\n') + '\n';
  const entries = lex(text);
  return { text, entries, state: fold(entries) };
};

/* -------------------------------- checklist ------------------------------- */

test('F7: an empty log has nothing ticked', () => {
  const { state, entries } = read([]);
  const { items, complete } = progress(state, entries);
  assert.equal(complete, false);
  assert.deepEqual(items.map((i) => i.complete), [false, false, false, false]);
});

test('F7: each task ticks itself off from log content alone', () => {
  const cases = {
    session: ['## Session 1'],
    line: ['@ Sneak past the guard'],
    tag: ['[PC:Alex|HP 8]'],
    roll: ['d: d6=5 vs TN 4 -> Success'],
  };
  for (const [id, lines] of Object.entries(cases)) {
    const { state, entries } = read(lines);
    const done = progress(state, entries).items.filter((i) => i.complete).map((i) => i.id);
    assert.ok(done.includes(id), `${id} did not tick for ${JSON.stringify(lines)}`);
  }
});

test('F7: a played log completes the list, and a complete list stops showing', () => {
  const { state, entries } = read([
    '## Session 1', '@ Sneak past the guard', '[PC:Alex|HP 8]', 'd: d6=5 vs TN 4 -> Success',
  ]);
  assert.equal(progress(state, entries).complete, true);
  assert.equal(shouldShowChecklist(state, entries, 'auto'), false);
});

test('F7: hiding wins even when the list is unfinished', () => {
  const { state, entries } = read(['@ Sneak past the guard']);
  assert.equal(shouldShowChecklist(state, entries, 'auto'), true);
  assert.equal(shouldShowChecklist(state, entries, 'hidden'), false);
});

test('F7: every task has a hint naming a control', () => {
  for (const task of TASKS) {
    assert.ok(task.label?.trim(), `${task.id} has no label`);
    assert.ok(task.hint?.trim(), `${task.id} has no hint`);
  }
});

/* ----------------------------- sample campaign ---------------------------- */

test('F8: the sample round-trips byte-identically', () => {
  const { text, entries } = read(SAMPLE_LOG);
  assert.equal(render(entries), text);
});

test('F8: the sample contains no line the app cannot read', () => {
  const { entries } = read(SAMPLE_LOG);
  const prose = entries.filter((e) => e.kind === 'prose' && e.raw.trim());
  assert.deepEqual(prose.map((e) => e.raw), []);
});

test('F8: the sample breaks no spec rule worth flagging', () => {
  const { entries } = read(SAMPLE_LOG);
  const errors = lint(entries).filter((f) => f.severity !== 'info');
  assert.deepEqual(errors.map((f) => `${f.rule}:${f.line}`), []);
});

test('F8: the sample surfaces add-on panels without the reader writing anything', () => {
  const { state } = read(SAMPLE_LOG);
  const ids = surfaced(state).map((a) => a.id);
  assert.ok(ids.length >= 2, `only surfaced ${JSON.stringify(ids)}`);
  assert.ok(ids.includes('combat'));
  assert.ok(ids.includes('resources'));
});

test('F8: the sample is a finished-looking log, not a stub', () => {
  const { state, entries } = read(SAMPLE_LOG);
  assert.equal(progress(state, entries).complete, true, 'the example should show every step done');
  assert.ok(state.scenes.length >= 3);
  assert.ok(state.tables.size >= 1, 'the log should carry its own table');
  assert.ok(state.blockStack.length === 0, 'the example must leave no block open');
});

test('F8: the sample names no game system (D3, §9.8)', () => {
  const text = SAMPLE_LOG.join('\n').toLowerCase();
  for (const system of ['ironsworn', 'mythic', 'd&d', 'dungeons', 'pathfinder', 'fate core', 'blades in the dark']) {
    assert.ok(!text.includes(system), `the sample names ${system}`);
  }
});

/* ------------------------------ where to land ----------------------------- */

test('F9: a first-ever launch lands on the guide, later launches do not', () => {
  assert.equal(landingRoute({ seenGuide: false, campaignCount: 0 }), 'reference');
  assert.equal(landingRoute({ seenGuide: true, campaignCount: 0 }), 'campaigns');
  assert.equal(landingRoute({ seenGuide: false, campaignCount: 2 }), 'campaigns');
});

test('F9: an explicit hash is a deep link and is never overridden', () => {
  assert.equal(landingRoute({ seenGuide: false, campaignCount: 0, hasHash: true }), null);
  assert.equal(landingRoute({ seenGuide: true, campaignCount: 3, hasHash: true }), null);
});
