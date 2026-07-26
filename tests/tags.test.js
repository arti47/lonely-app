/** Tag parsing and canonicalisation (ledger T9–T19, T30–T31, T40–T57). */

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseTag, serializeTag, extractTags, classifyBracket } from '../src/lonelog/tags.js';

test('T13 parses a PC tag with stats', () => {
  const t = parseTag('[PC:Alex|HP 8|Stress 0]');
  assert.equal(t.type, 'PC');
  assert.equal(t.name, 'Alex');
  assert.equal(t.fields.length, 2);
  assert.equal(t.fields[0].key, 'HP');
  assert.equal(t.fields[0].value, '8');
});

test('T14 reference tags are marked and carry no fields', () => {
  const t = parseTag('[#N:Jonah]');
  assert.equal(t.ref, true);
  assert.equal(t.type, 'N');
  assert.equal(t.name, 'Jonah');
});

test('whitespace around separators is insignificant (T26, review #8)', () => {
  const a = parseTag('[Inv: Torch | 3]');
  const b = parseTag('[Inv:Torch|3]');
  assert.equal(serializeTag(a), serializeTag(b));
  assert.equal(serializeTag(a), '[Inv:Torch|3]');
});

test('T19 progress tags parse current/total', () => {
  const t = parseTag('[Clock:Ritual 5/12]');
  assert.equal(t.name, 'Ritual');
  assert.deepEqual(t.head, { kind: 'progress', current: 5, total: 12 });
});

test('T19 timers carry a single countdown value', () => {
  const t = parseTag('[Timer:Dawn 3]');
  assert.equal(t.name, 'Dawn');
  assert.deepEqual(t.head, { kind: 'value', value: '3' });
});

test('T31 group counts accept both x and ×', () => {
  assert.equal(parseTag('[F:Skeletonx3|HP 3 each]').count, 3);
  assert.equal(parseTag('[F:Skeleton×3|HP 3 each]').count, 3);
  assert.equal(parseTag('[F:Skeleton x 3]').count, 3);
});

test('T18 +/- fields set the add/remove op', () => {
  const t = parseTag('[N:Jonah|+captured|-wounded]');
  assert.equal(t.fields[0].op, 'add');
  assert.equal(t.fields[0].value, 'captured');
  assert.equal(t.fields[1].op, 'remove');
  assert.equal(t.fields[1].value, 'wounded');
});

test('T18 value transitions parse both -> and →', () => {
  assert.deepEqual(parseTag('[Inv:Torch|3->2]').fields[0].transition, { from: '3', to: '2' });
  assert.deepEqual(parseTag('[N:Jonah|friendly→hostile]').fields[0].transition,
    { from: 'friendly', to: 'hostile' });
});

test('T44 usage-die step-down keeps its key', () => {
  const f = parseTag('[PC:Kael|Supply d8->d6]').fields[0];
  assert.equal(f.key, 'Supply');
  assert.deepEqual(f.transition, { from: 'd8', to: 'd6' });
});

test('T15 category syntax groups a comma list', () => {
  const f = parseTag('[PC:Jonah|trait:friendly,curious|status:wounded]').fields;
  assert.deepEqual(f[0].list, ['friendly', 'curious']);
  assert.equal(f[1].key, 'status');
  assert.equal(f[1].value, 'wounded');
});

test('T41/T46 name-attached deltas parse on the head', () => {
  assert.deepEqual(parseTag('[Inv:Torch-1]').head, { kind: 'delta', sign: '-', amount: 1 });
  assert.deepEqual(parseTag('[Wealth:Gold+15]').head, { kind: 'delta', sign: '+', amount: 15 });
  assert.equal(parseTag('[Wealth:Gold+15]').name, 'Gold');
});

test('T46 explicit totals and transitions on wealth', () => {
  assert.deepEqual(parseTag('[Wealth:Gold 45]').head, { kind: 'value', value: '45' });
  assert.deepEqual(parseTag('[Wealth:Gold 45->52]').head,
    { kind: 'transition', from: '45', to: '52' });
});

test('T35 room tags keep id, status, description and exits', () => {
  const t = parseTag('[R:4|active|storage room, dusty shelves|exits S:R2, E:R5]');
  assert.equal(t.name, '4');
  assert.equal(t.fields[0].value, 'active');
  assert.equal(t.fields[2].key, 'exits');
});

test('T48 unit tags parse size, morale and status', () => {
  const t = parseTag('[Unit:Ironclad Rifles | x12 | Morale 8 | Fresh]');
  assert.equal(t.name, 'Ironclad Rifles');
  assert.equal(t.fields[0].count, 12);
  assert.equal(t.fields[1].key, 'Morale');
  assert.equal(t.fields[2].value, 'Fresh');
});

test('T56 location armor survives as a single field', () => {
  const t = parseTag('[Unit:Atlas AS7-D|Armor CT30/RT25/LT25|Heat 0|Fresh]');
  assert.equal(t.fields[0].key, 'Armor');
  assert.equal(t.fields[0].value, 'CT30/RT25/LT25');
});

test('T17 roll context on a d: line is not mistaken for a tag', () => {
  const line = 'd: Investigate 2d6 [power: Be kind to others, Naive] = 8 -> Mixed';
  const { tags, rollContext } = extractTags(line, { diceLine: true });
  assert.equal(tags.length, 0);
  assert.equal(rollContext.length, 1);
});

test('tags after the arrow on a d: line are still tags', () => {
  const line = 'd: d20+4=15 vs AC 12 -> Hit, 1d8=5 => [F:Guard|dead]';
  const { tags } = extractTags(line, { diceLine: true });
  assert.equal(tags.length, 1);
  assert.equal(tags[0].type, 'F');
});

test('T32 movement brackets are annotations, not tags', () => {
  assert.equal(classifyBracket('Far->Close'), 'annotation');
  const { tags, annotations } = extractTags('@(Thug A) Rushes in [Far->Close]');
  assert.equal(tags.length, 0);
  assert.equal(annotations.length, 1);
});

test('unknown tag types are tolerated rather than dropped', () => {
  const t = parseTag('[Homebrew:Widget|shiny]');
  assert.equal(t.type, 'Homebrew');
  assert.equal(t.known, false);
  assert.equal(t.fields[0].value, 'shiny');
});

test('T16 multi-line tag form parses as one tag', () => {
  const t = parseTag('[PC:Jonah\n| trait: friendly, curious\n| status: wounded\n]');
  assert.equal(t.name, 'Jonah');
  assert.equal(t.multiline, true);
  assert.deepEqual(t.fields[0].list, ['friendly', 'curious']);
});
