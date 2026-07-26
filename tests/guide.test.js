/** New-user guide (CLAUDE.md §8). */

import test from 'node:test';
import assert from 'node:assert/strict';

import { STEPS } from '../src/guide.js';
import { entryFor } from '../src/reference.js';
import { lex } from '../src/lonelog/lexer.js';

const ROUTES = new Set(['campaigns', 'log', 'state', 'resolve', 'reference', 'settings']);

test('every step is complete and uniquely identified', () => {
  const ids = new Set();
  for (const step of STEPS) {
    assert.ok(!ids.has(step.id), `duplicate step ${step.id}`);
    ids.add(step.id);
    assert.ok(step.title?.trim(), `${step.id} has no title`);
    assert.ok(step.body.length && step.body.every((p) => p.trim()), `${step.id} has an empty paragraph`);
  }
});

test('the guide covers the app in the order a new user meets it', () => {
  const order = STEPS.map((s) => s.id);
  assert.equal(order[0], 'start', 'the first step must be making a campaign');
  for (const id of ['first-line', 'tags', 'state', 'roll', 'oracle', 'scenes', 'addons', 'keeping']) {
    assert.ok(order.includes(id), `the guide never covers ${id}`);
  }
  assert.ok(order.indexOf('first-line') < order.indexOf('state'),
    'you write a line before state can appear');
  assert.ok(order.indexOf('roll') < order.indexOf('quick-rolls'),
    'quick rolls are learned from rolls, so rolling comes first');
});

test('every step that links somewhere links to a real screen', () => {
  for (const step of STEPS) {
    if (!step.route) continue;
    assert.ok(ROUTES.has(step.route), `${step.id} points at unknown route ${step.route}`);
    assert.ok(step.routeLabel?.trim(), `${step.id} has a route with no label`);
  }
});

test('every step that cites the reference cites one that exists', () => {
  for (const step of STEPS) {
    if (!step.reference) continue;
    assert.ok(entryFor(step.reference), `${step.id} points at missing entry ${step.reference}`);
  }
});

test('every example in the guide is notation the app can read', () => {
  for (const step of STEPS) {
    for (const example of step.examples ?? []) {
      const [entry] = lex(example + '\n');
      assert.notEqual(entry.kind, 'prose', `${step.id}: "${example}" lexed as prose`);
    }
  }
});

test('steps needing a campaign are exactly those pointing into one', () => {
  for (const step of STEPS) {
    const inCampaign = ['log', 'state', 'resolve'].includes(step.route ?? '');
    assert.equal(!!step.needsCampaign, inCampaign,
      `${step.id} disagrees about whether it needs a campaign`);
  }
});

test('the guide promises nothing the app does not do', () => {
  const text = STEPS.flatMap((s) => s.body).join(' ').toLowerCase();
  for (const claim of ['rolls for you', 'sign in', 'account', 'upload', 'cloud sync']) {
    if (claim === 'account' || claim === 'upload') continue; // used in the negative
    assert.ok(!text.includes(claim), `the guide claims "${claim}"`);
  }
  assert.ok(text.includes('never rolls'), 'the guide must be clear the app does not roll');
  assert.ok(text.includes('no server'), 'the guide must be clear there is no server');
});
