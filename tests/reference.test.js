/**
 * Notation reference (CLAUDE.md §8 Phase 8).
 *
 * The load-bearing properties: every automated surface can find its entry, the
 * examples are real notation, and no spec prose is reproduced (§10, §12).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ENTRIES, LINT_REFERENCE, TAG_TYPES, entryFor, search, grouped,
  tagTypeLabel, groupedTagTypes,
} from '../src/reference.js';
import { lex } from '../src/lonelog/lexer.js';
import { KNOWN_TAG_TYPES } from '../src/lonelog/tags.js';
import { ADDONS } from '../src/addons/index.js';
import { SYMBOLS } from '../src/composer.js';
import { lint } from '../src/lonelog/lint.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('every entry is complete and uniquely identified', () => {
  const ids = new Set();
  for (const entry of ENTRIES) {
    assert.ok(!ids.has(entry.id), `duplicate id ${entry.id}`);
    ids.add(entry.id);
    for (const key of ['title', 'group', 'syntax', 'summary', 'spec']) {
      assert.ok(entry[key]?.trim(), `${entry.id} is missing ${key}`);
    }
    assert.ok(entry.examples.length, `${entry.id} has no example`);
    assert.match(entry.spec, /§|Quick Ref|Design Principles/, `${entry.id} must cite the spec`);
  }
});

test('every example is notation the lexer recognises', () => {
  // Examples are read as one snippet: a table body, a generator axis or a
  // narrative line only lexes in the context its header establishes.
  for (const entry of ENTRIES) {
    const entries = lex(entry.examples.join('\n') + '\n');
    assert.notEqual(entries[0].kind, 'prose',
      `${entry.id}: "${entry.examples[0]}" lexed as prose`);
    assert.ok(entries.some((e) => e.kind !== 'prose' && e.kind !== 'blank'),
      `${entry.id} has no recognised notation`);
  }
});

test('multi-line examples lex as the construct they document', () => {
  const kindsOf = (id) => lex(entryFor(id).examples.join('\n') + '\n').map((e) => e.kind);
  assert.deepEqual(kindsOf('tbl-define'), ['tbl', 'tableEntry', 'tableEntry']);
  assert.deepEqual(kindsOf('gen').slice(1), ['gen', 'genAxis']);
  assert.equal(kindsOf('narrative-block')[0], 'narrativeOpen');
  assert.ok(kindsOf('campaign-header').every((k) => k === 'frontmatter'));
});

test('every composer symbol links to an entry', () => {
  for (const symbol of SYMBOLS) {
    assert.ok(symbol.ref, `${symbol.glyph} has no reference`);
    assert.ok(entryFor(symbol.ref), `${symbol.glyph} points at a missing entry`);
  }
});

test('every add-on surface links to an entry', () => {
  for (const addon of ADDONS) {
    assert.ok(addon.reference, `${addon.id} has no reference`);
    assert.ok(entryFor(addon.reference), `${addon.id} points at a missing entry`);
  }
});

test('every lint rule that can fire explains itself', () => {
  const fired = new Set(lint(lex([
    '[Wealth:Gold 50gc+7gc] => [Wealth:Gold 57gc]',
    '! Thug attacks',
    '[E:Alert 2/6]',
    '[Clock:Suspicion 3/6]',
    '[F:Guard 2|HP 5 each]',
    '[Scenario:Raid|Grab it|5 turns]',
    '[Inv:Scroll | x1]',
    '[Inv: Torch | 3]',
    '[Timer:Supply 4/5]',
    '',
  ].join('\n'))).map((f) => f.rule));

  assert.ok(fired.size >= 8, `expected most rules to fire, saw ${[...fired].join(',')}`);
  for (const rule of fired) {
    assert.ok(LINT_REFERENCE[rule], `${rule} has no reference entry`);
    assert.ok(entryFor(LINT_REFERENCE[rule]), `${rule} points at a missing entry`);
  }
});

test('search finds entries by title, syntax and plain words', () => {
  assert.ok(search('clock').some((e) => e.id === 'tag-clock'));
  assert.ok(search('[F:').some((e) => e.id === 'addon-combat'));
  assert.ok(search('flashback').some((e) => e.id === 'scene'));
  assert.ok(search('inventory').some((e) => e.id === 'addon-resources'));
  assert.ok(search('countdown').some((e) => e.id === 'tag-clock'));
});

test('search narrows on multiple terms and returns nothing for nonsense', () => {
  assert.ok(search('usage die').some((e) => e.id === 'addon-resources'));
  assert.deepEqual(search('zzzznotathing'), []);
});

test('an empty search browses everything, grouped', () => {
  assert.equal(search('').length, ENTRIES.length);
  const groups = grouped().map(([name]) => name);
  assert.ok(groups.includes('Core symbols'));
  assert.equal(new Set(groups).size, groups.length, 'groups must not repeat');
});

test('all five core symbols are documented', () => {
  for (const id of ['action', 'question', 'dice', 'resolution', 'consequence']) {
    assert.ok(entryFor(id), `${id} is missing from the reference`);
  }
});

test('summaries are written for this app, not copied from the specs', () => {
  const specs = readdirSync(join(root, 'docs', 'spec'))
    .map((f) => readFileSync(join(root, 'docs', 'spec', f), 'utf8').toLowerCase());

  for (const entry of ENTRIES) {
    // Any long run of words lifted verbatim would be reproduction, not paraphrase.
    const words = entry.summary.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
    for (let i = 0; i + 8 <= words.length; i++) {
      const run = words.slice(i, i + 8).join(' ');
      assert.ok(
        !specs.some((spec) => spec.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').includes(run)),
        `${entry.id} reproduces spec prose: "${run}"`,
      );
    }
  }
});

test('every tag type the notation knows has a plain-English name', () => {
  const known = [...new Set(KNOWN_TAG_TYPES.values())].sort();
  const labelled = TAG_TYPES.map((t) => t.type).sort();
  assert.deepEqual(labelled, known,
    'a chooser must offer every type the engine parses, and no type it does not');

  for (const entry of TAG_TYPES) {
    assert.ok(entry.label?.trim(), `${entry.type} has no label`);
    assert.ok(entry.group?.trim(), `${entry.type} has no group`);
    assert.ok(entryFor(entry.entry), `${entry.type} cites missing entry ${entry.entry}`);
  }
});

test('a type reads as a word, with its notation only where they differ', () => {
  assert.equal(tagTypeLabel({ type: 'N', label: 'NPC' }), 'NPC (N)');
  assert.equal(tagTypeLabel({ type: 'PC', label: 'Character' }), 'Character (PC)');
  // `Thread (Thread)` helps nobody.
  assert.equal(tagTypeLabel({ type: 'Thread', label: 'Thread' }), 'Thread');
});

test('tag types group by where they come from, core first', () => {
  const groups = groupedTagTypes();
  assert.equal(groups[0][0], 'Core');
  assert.deepEqual(groups.flatMap(([, entries]) => entries.map((e) => e.type)),
    TAG_TYPES.map((t) => t.type), 'grouping must not drop or reorder a type');
});
