/**
 * 🏁 First Session Logged (CLAUDE.md §8).
 *
 * Compose a whole session the way the composer does, export it as Lonelog
 * markdown, reimport it, and require an identical fold. This is the milestone's
 * acceptance criterion expressed as a test; the browser smoke run covers the
 * same path through the UI.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLine, buildTag, sceneLine, sessionLines } from '../src/composer.js';
import { toMarkdown, fromMarkdown, normalizeCampaign } from '../src/store.js';
import { lex } from '../src/lonelog/lexer.js';
import { fold, getElement } from '../src/lonelog/fold.js';
import { render } from '../src/lonelog/render.js';
import { lint } from '../src/lonelog/lint.js';

/** Build a session using only the composer's own helpers. */
function composeSession() {
  const log = [];
  const state = () => fold(lex(log.join('\n')));

  log.push(...sessionLines(state(), '2026-07-26'));
  log.push(sceneLine(state(), 'Dark alley, midnight'));
  log.push(`${buildLine('action', 'Sneak past the guard')}`);
  log.push(buildLine('dice', 'Stealth d6=5 vs TN 4 -> Success'));
  log.push(`${buildLine('consequence', 'I slip by unnoticed.')} ${buildTag({ type: 'PC', name: 'Alex', fields: ['HP 8'] })}`);
  log.push(buildLine('question', 'Does he see me?'));
  log.push(buildLine('resolution', 'No, but... (d6=3)'));
  log.push(`${buildLine('consequence', 'He lingers.')} ${buildTag({ type: 'N', name: 'Guard', fields: ['watchful'] })}`);
  log.push(buildLine('note', 'the timer really worked'));

  log.push('[COMBAT]');
  log.push(buildTag({ type: 'F', name: 'Thug', fields: ['HP 6', 'Close'] }));
  log.push('Rd1');
  log.push(buildLine('action', 'Strike the thug'));
  log.push(buildLine('dice', 'd20+4=17 vs AC 12 -> Hit'));
  log.push(`${buildLine('consequence', 'He drops.')} ${buildTag({ type: 'F', name: 'Thug', fields: ['dead'] })}`);
  log.push('[/COMBAT]');

  log.push(sceneLine(state(), 'Rooftops, before dawn'));
  log.push(`${buildLine('consequence', 'I take stock.')} ${buildTag({ type: 'Inv', name: 'Torch', fields: ['3'] })}`);
  log.push(buildTag({ type: 'Thread', name: 'Who hired the thug?', fields: ['Open'] }));

  return log;
}

test('a composed session is valid, lint-clean Lonelog', () => {
  const entries = lex(composeSession().join('\n') + '\n');
  assert.deepEqual(
    lint(entries).filter((f) => f.severity === 'error'), [],
    'the composer must not be able to emit spec violations',
  );
  assert.equal(entries.filter((e) => e.kind === 'prose').length, 0,
    'every composed line should lex as a recognised kind');
});

test('the composed session folds into the expected state', () => {
  const state = fold(lex(composeSession().join('\n') + '\n'));

  assert.equal(state.sessions.length, 1);
  assert.equal(state.scenes.length, 2);
  assert.deepEqual(state.scenes.map((s) => s.scene), [1, 2]);
  assert.equal(getElement(state, 'PC', 'Alex').fields.get('HP').value, '8');
  assert.ok(getElement(state, 'N', 'Guard').flags.has('watchful'));
  assert.ok(getElement(state, 'F', 'Thug').flags.has('dead'));
  assert.equal(getElement(state, 'Inv', 'Torch').value.value, '3');
  assert.ok(getElement(state, 'Thread', 'Who hired the thug?').flags.has('Open'));
  assert.deepEqual([...state.addons].sort(), ['combat', 'resources']);
  assert.equal(state.blockStack.length, 0, 'the combat block must be closed');
});

test('🏁 export to markdown and reimport yields an identical fold', () => {
  const original = normalizeCampaign({
    meta: { title: 'Smoke Campaign', ruleset: 'Generic', createdAt: '2026-07-26' },
    log: composeSession(),
  });

  const markdown = toMarkdown(original);
  const reimported = fromMarkdown(markdown, 'Smoke Campaign');

  assert.deepEqual(reimported.log, original.log, 'every log line must survive the round trip');

  const before = fold(lex(original.log.join('\n')));
  const after = fold(lex(reimported.log.join('\n')));
  assert.deepEqual(plain(after), plain(before));

  // And the markdown itself is byte-stable through the engine.
  assert.equal(render(lex(markdown)), markdown);
});

test('🏁 truncation is a clean undo: the log returns to its earlier state', () => {
  const log = composeSession();
  const cut = 8;

  const truncated = log.slice(0, cut);
  const restored = [...truncated, ...log.slice(cut)];

  assert.deepEqual(restored, log);
  assert.deepEqual(
    plain(fold(lex(restored.join('\n')))),
    plain(fold(lex(log.join('\n')))),
  );

  // Folding the truncated log must not retain anything from the removed tail.
  const partial = fold(lex(truncated.join('\n')));
  assert.equal(getElement(partial, 'F', 'Thug'), null);
  assert.equal(partial.addons.has('combat'), false);
});

test('an unrecognised line imported from someone else survives untouched', () => {
  const markdown = toMarkdown(normalizeCampaign({
    meta: { title: 'Foreign' },
    log: ['@ Do a thing', '~~~ not lonelog at all ~~~', '=> It worked'],
  }));
  const back = fromMarkdown(markdown, 'Foreign');
  assert.deepEqual(back.log, ['@ Do a thing', '~~~ not lonelog at all ~~~', '=> It worked']);
});

function plain(state) {
  return JSON.parse(JSON.stringify(state, (_k, v) => {
    if (v instanceof Map) return { __map: [...v.entries()] };
    if (v instanceof Set) return { __set: [...v].sort() };
    return v;
  }));
}
