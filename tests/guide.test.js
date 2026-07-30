/** How-to guide (CLAUDE.md §8). One accordion section per part of the app. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SECTIONS } from '../src/guide.js';
import { entryFor } from '../src/reference.js';
import { SYMBOLS } from '../src/composer.js';
import { lex } from '../src/lonelog/lexer.js';

const ROUTES = new Set(['campaigns', 'log', 'state', 'resolve', 'reference', 'settings']);

test('every section is complete and uniquely identified', () => {
  const ids = new Set();
  for (const section of SECTIONS) {
    assert.ok(!ids.has(section.id), `duplicate section ${section.id}`);
    ids.add(section.id);
    assert.ok(section.title?.trim(), `${section.id} has no title`);
    assert.ok(section.blurb?.trim(), `${section.id} has no blurb`);
    assert.ok(section.steps.length >= 3, `${section.id} has too few steps to be a how-to`);
    assert.ok(section.steps.every((s) => s.trim()), `${section.id} has an empty step`);
  }
});

test('the guide covers every part of the app', () => {
  const ids = SECTIONS.map((s) => s.id);
  for (const id of ['play-loop', 'campaigns', 'play', 'sheet', 'roll', 'addons', 'keeping', 'warnings', 'install']) {
    assert.ok(ids.includes(id), `the guide never covers ${id}`);
  }
  assert.equal(ids[0], 'play-loop', 'how to play comes before how to drive the app');

  // Every tab and every route with a screen behind it is explained somewhere.
  const routes = new Set(SECTIONS.map((s) => s.route).filter(Boolean));
  for (const route of ['campaigns', 'log', 'state', 'resolve', 'settings']) {
    assert.ok(routes.has(route), `no section links to ${route}`);
  }
});

test('every section that links somewhere links to a real screen', () => {
  for (const section of SECTIONS) {
    if (!section.route) continue;
    assert.ok(ROUTES.has(section.route), `${section.id} points at unknown route ${section.route}`);
    assert.ok(section.routeLabel?.trim(), `${section.id} has a route with no label`);
  }
});

test('every section that cites the reference cites one that exists', () => {
  for (const section of SECTIONS) {
    if (!section.reference) continue;
    assert.ok(entryFor(section.reference), `${section.id} points at missing entry ${section.reference}`);
  }
});

test('every example in the guide is notation the app can read', () => {
  for (const section of SECTIONS) {
    for (const example of section.examples ?? []) {
      const [entry] = lex(example + '\n');
      assert.notEqual(entry.kind, 'prose', `${section.id}: "${example}" lexed as prose`);
    }
  }
});

test('sections needing a campaign are exactly those pointing into one', () => {
  for (const section of SECTIONS) {
    const inCampaign = ['log', 'state', 'resolve'].includes(section.route ?? '');
    assert.equal(!!section.needsCampaign, inCampaign,
      `${section.id} disagrees about whether it needs a campaign`);
  }
});

test('the play loop names the controls it tells you to tap', () => {
  const loop = SECTIONS.find((s) => s.id === 'play-loop');
  const text = loop.steps.join(' ');
  for (const control of ['Scene', '@ Did', '🎲 Roll', '? Asked', '=> So', 'Tag…', 'Session…']) {
    assert.ok(text.includes(control), `the loop never mentions ${control}`);
  }
  assert.ok(loop.examples.length >= 4, 'the loop needs a worked example to land');
});

test('the guide promises nothing the app does not do', () => {
  const text = SECTIONS.flatMap((s) => [s.blurb, ...s.steps]).join(' ').toLowerCase();
  for (const claim of ['rolls for you', 'sign in', 'cloud sync']) {
    assert.ok(!text.includes(claim), `the guide claims "${claim}"`);
  }
  assert.ok(text.includes('never rolls'), 'the guide must be clear the app does not roll');
  assert.ok(text.includes('no server'), 'the guide must be clear there is no server');
});

test('the guide names no game system (D3, §9.8)', () => {
  const text = SECTIONS.flatMap((s) => [s.blurb, ...s.steps, ...(s.examples ?? [])]).join(' ').toLowerCase();
  for (const system of ['ironsworn', 'mythic', 'd&d', 'dungeons', 'pathfinder', 'blades in the dark']) {
    assert.ok(!text.includes(system), `the guide names ${system}`);
  }
});

test('the guide teaches every control the composer offers', () => {
  // The guide drifted once already: two controls shipped and it never mentioned
  // them, so the app could write notation the guide could not teach.
  const play = SECTIONS.find((s) => s.id === 'play');
  const text = play.steps.join(' ');
  for (const control of ['Tag…', 'Said…', 'Excerpt…', '⋯ More', 'Session…', 'Scene', 'Undo', 'Restore']) {
    assert.ok(text.includes(control), `Play never mentions ${control}`);
  }
  for (const symbol of SYMBOLS) {
    assert.ok(text.includes(symbol.glyph), `Play never shows ${symbol.glyph}`);
  }
});

test('the guide teaches the campaign header, which ships in the export', () => {
  const text = SECTIONS.flatMap((s) => s.steps).join(' ');
  assert.ok(/Edit header/.test(text), 'nothing tells you the header exists');
});
