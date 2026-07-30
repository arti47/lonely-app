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

/* ========================================================================== */
/* Third pass — C1–C8 (`docs/audit.md`). Structure, positional slots and the   */
/* analog header: forms the specs write that the app read as something else.   */
/* ========================================================================== */

import * as dungeon from '../src/addons/dungeon.js';

/* --------- C1 — an analog block closes under its abbreviated name --------- */

test('C1 `--- END STATUS ---` closes `--- DUNGEON STATUS ---` (dungeon §3)', () => {
  // The spec's own analog example, verbatim.
  const { entries, state } = read([
    '--- DUNGEON STATUS ---',
    'R1: cleared, looted (entry cave)',
    'R5: locked (heavy door)',
    '--- END STATUS ---',
    '@ Push on',
  ]);
  const blocks = entries.filter((e) => e.kind === 'block');
  assert.equal(blocks.length, 2, 'both delimiters are block lines');
  assert.equal(blocks[1].closing, true);
  assert.equal(blocks[1].name, 'DUNGEON STATUS');
  assert.equal(state.blockStack.length, 0, 'the stack must not leak past the block');
  assert.deepEqual(state.blocks.map((b) => b.name), ['DUNGEON STATUS']);
});

test('C1 a stray `--- END X ---` naming nothing open stays prose', () => {
  const { entries } = read(['--- END STATUS ---']);
  assert.equal(entries[0].kind, 'prose');
});

/* ------------- C2 — a room description is not a room status -------------- */

test('C2 the description slot folds as a description (dungeon §1, §1.3)', () => {
  const room = getElement(read(['[R:1|cleared, looted|entry cave|exits N:R2, E:R3]']).state, 'R', '1');
  assert.deepEqual([...room.flags.keys()], ['cleared', 'looted']);
  assert.equal(room.fields.get('desc').value, 'entry cave');
  assert.equal(room.fields.get('exits').value, 'N:R2, E:R3');
});

test('C2 two statuses in separate fields are still statuses', () => {
  const room = getElement(read(['[R:1|cleared|looted]']).state, 'R', '1');
  assert.deepEqual([...room.flags.keys()], ['cleared', 'looted']);
  assert.ok(!room.fields.has('desc'));
});

test('C2 a dungeon snapshot re-reads as the rooms it was taken from', () => {
  const before = read(['[R:1|cleared, looted|entry cave|exits N:R2, E:R3]', '[R:4|unexplored]']).state;
  const lines = dungeon.snapshotLines(before);
  assert.ok(lines.includes('[R:1|cleared, looted|entry cave|exits N:R2, E:R3]'),
    `snapshot lost the room's slots: ${lines.join(' / ')}`);
  const after = fold(lex(lines.join('\n') + '\n'));
  for (const id of ['1', '4']) {
    const a = getElement(before, 'R', id), b = getElement(after, 'R', id);
    assert.deepEqual([...b.flags.keys()], [...a.flags.keys()]);
    assert.equal(b.fields.get('desc')?.value, a.fields.get('desc')?.value);
    assert.equal(b.fields.get('exits')?.value, a.fields.get('exits')?.value);
  }
});

/* ------ C3 — positional slots are free text, not accidental stat keys ----- */

test('C3 every scenario example in wargaming §3 keeps its objective', () => {
  for (const [line, name, objective, turns] of [
    ['[Scenario: Breakthrough | Exit 2+ units south|10 turns]', 'Breakthrough', 'Exit 2+ units south', '10 turns'],
    ['[Scenario:Wyrdstone Hunt | Collect 3 shards|6 turns]', 'Wyrdstone Hunt', 'Collect 3 shards', '6 turns'],
    ['[Scenario: Last Stand | Survive 5 turns | 5 turns]', 'Last Stand', 'Survive 5 turns', '5 turns'],
  ]) {
    const s = getElement(read([line]).state, 'Scenario', name);
    assert.equal(s.fields.get('objective').value, objective, line);
    assert.equal(s.fields.get('turns').value, turns, line);
    assert.ok(!s.fields.has('Exit') && !s.fields.has('Collect') && !s.fields.has('Survive'),
      `the objective's first word became a stat key: ${line}`);
  }
});

test('C3 a force keeps commander, strength and objective (wargaming §2)', () => {
  const f = getElement(
    read(['[Force: Ironclad Company | Colonel Vane | 3 units| Hold the bridge]']).state,
    'Force', 'Ironclad Company',
  );
  assert.equal(f.fields.get('commander').value, 'Colonel Vane');
  assert.equal(f.fields.get('strength').value, '3 units');
  assert.equal(f.fields.get('objective').value, 'Hold the bridge');
});

test('C3 an update is not positional — a delta still applies as a delta', () => {
  const s = read(['[Unit:Rifles|x12|Morale 8]', '[Unit:Rifles|Morale-2]']).state;
  assert.equal(getElement(s, 'Unit', 'Rifles').fields.get('Morale').value, '6');
});

/* ------------- C4 — a campaign snapshot restates the whole force ---------- */

test('C4 a [CAMPAIGN] snapshot folds back to the forces it snapshotted', () => {
  const before = read([
    '[Force: Ironclad Company | Colonel Vane | 3 units| Hold the bridge]',
    '[Unit:Rifles|x12|Morale 8|Fresh]',
  ]).state;
  const after = fold(lex(wargaming.snapshotLines(before, 'CAMPAIGN').join('\n') + '\n'));
  const a = getElement(before, 'Force', 'Ironclad Company');
  const b = getElement(after, 'Force', 'Ironclad Company');
  for (const slot of ['commander', 'strength', 'objective']) {
    assert.equal(b.fields.get(slot)?.value, a.fields.get(slot)?.value, `snapshot dropped ${slot}`);
  }
});

/* ------------ C5 — a resource snapshot does not rename its items ---------- */

test('C5 a [RESOURCES] snapshot keeps item identity and quantity (resources §1, §5)', () => {
  const before = read(['[Inv:Torch|3|lit]', '[Inv:Rope|1|50ft]', '[Wealth:Gold 52 | Silver 8]']).state;
  const lines = resources.snapshotLines(before);
  assert.ok(lines.includes('[Inv:Torch|3|lit]'), `quantity left the field slot: ${lines.join(' / ')}`);
  const after = fold(lex(lines.join('\n') + '\n'));
  const torch = getElement(after, 'Inv', 'Torch');
  assert.equal(torch.name, 'Torch', 'the quantity must not become part of the name');
  assert.equal(torch.value.value, '3');
  assert.equal(elementsOfType(after, 'Inv').length, 2, 'a snapshot must not duplicate its items');
});

test('C5 a grouped item keeps its multiplier through a snapshot', () => {
  const before = read(['[Inv:Arrowx12]']).state;
  const after = fold(lex(resources.snapshotLines(before).join('\n') + '\n'));
  assert.equal(getElement(after, 'Inv', 'Arrow').count.value, 12);
});

/* --------------- C6 — the analog header folds like the digital ------------ */

test('C6 an analog campaign header folds its fields (core §5.1)', () => {
  // The spec's own header block, values on the line beneath the key.
  const { state } = read([
    '=== Campaign Log: Clearview Mystery ===',
    '[Title]', 'Clearview Mystery',
    '[Ruleset]', 'Loner + Mythic Oracle',
    '[Genre]', 'Teen mystery / supernatural',
    '[Player]', 'Roberto',
    '[Last Update] 2025-10-28',
    '[Tone]', 'Eerie but playful',
  ]);
  assert.equal(state.meta.title.value, 'Clearview Mystery');
  assert.equal(state.meta.ruleset.value, 'Loner + Mythic Oracle');
  assert.equal(state.meta.genre.value, 'Teen mystery / supernatural');
  assert.equal(state.meta.player.value, 'Roberto');
  assert.equal(state.meta['last update'].value, '2025-10-28');
  assert.equal(state.meta.tone.value, 'Eerie but playful');
});

test('C6 an analog session header folds onto its session (core §5.2.2)', () => {
  const { state } = read([
    '=== Session 1 ===',
    '[Date]', '2025-09-03',
    '[Duration]', '1h30',
    '[Recap]', 'First session, introducing Alex',
    '[Goals]', 'Set up the central mystery',
    'S1 *School library after hours*',
  ]);
  const session = state.sessions[0];
  assert.equal(session.number, 1);
  assert.equal(session.meta.date, '2025-09-03');
  assert.equal(session.meta.duration, '1h30');
  assert.equal(session.meta.recap, 'First session, introducing Alex');
  assert.equal(session.meta.goals, 'Set up the central mystery');
});

test('C6 digital and analog session metadata agree (T25, T27)', () => {
  const digital = read(['## Session 1', '*Date: 2025-09-03 | Duration: 1h30*']).state;
  const analog = read(['=== Session 1 ===', '[Date] 2025-09-03', '[Duration] 1h30']).state;
  assert.deepEqual(analog.sessions[0].meta, digital.sessions[0].meta);
});

test('C6 a bracket that is not a header key is left alone', () => {
  // Roll context and option sets must not be mistaken for header fields.
  const { entries } = read(['[Naive]', 'tbl: Mood [Tense, Melancholic]']);
  assert.notEqual(entries[0].kind, 'metaField');
  assert.equal(entries[1].kind, 'tbl');
});

test('C6 an analog header is lossless', () => {
  const text = '=== Session 1 ===\n[Date]\n2025-09-03\n[Recap] Alex again\n';
  assert.equal(render(lex(text)), text);
});

/* -------- C7/C8 — the narrative block opens and closes as written --------- */

test('C7 a one-line narrative block does not swallow the log (core §4.4)', () => {
  const { entries } = read(['\\--- The diary is water-damaged. ---\\', '@ Read on', '=> Nothing legible']);
  assert.equal(entries[0].kind, 'narrativeOpen');
  assert.equal(entries[0].selfClosed, true);
  assert.equal(entries[1].kind, 'action', 'the line after a closed block is ordinary notation');
  assert.equal(entries[2].kind, 'consequence');
});

test('C8 the two-dash opener the spec writes is accepted (core §4.4)', () => {
  // §4.4's own example opens `\--The diary reads:` even though the prose says
  // `\---`. Tolerant in, canonical out (§5.3).
  const { entries } = read(['\\--The diary reads:', '"Day 47: The tides no longer obey."', '---\\', '@ Close it']);
  assert.equal(entries[0].kind, 'narrativeOpen');
  assert.equal(entries[1].kind, 'narrative');
  assert.equal(entries[2].kind, 'narrativeClose');
  assert.equal(entries[3].kind, 'action');
});

test('C7 a multi-line narrative block still spans its lines', () => {
  const { entries } = read(['\\---', 'Line one', 'Line two', '---\\', '@ Out']);
  assert.deepEqual(entries.map((e) => e.kind),
    ['narrativeOpen', 'narrative', 'narrative', 'narrativeClose', 'action']);
});

/* ----------- C9 — a PC declared in the campaign header is a PC ------------ */

test('C9 front matter establishes the tags it carries (core §5.1)', () => {
  const { state } = read(['---', 'title: Clearview Mystery', 'pcs: Alex [PC:Alex|HP 8|Stress 0]', '---']);
  assert.equal(state.meta.title.value, 'Clearview Mystery');
  const alex = getElement(state, 'PC', 'Alex');
  assert.ok(alex, 'the PC named in the header should exist');
  assert.equal(alex.fields.get('HP').value, '8');
});

/* -------- C10 — importing a campaign header does not drop its fields ------ */

import { toMarkdown, fromMarkdown } from '../src/store.js';

test('C10 every campaign-header field survives import and export (core §5.1)', () => {
  // The spec's own header keys, including the ones this app has no opinion on.
  const source = [
    '---',
    'title: Clearview Mystery',
    'ruleset: Loner + Mythic Oracle',
    'genre: Teen mystery / supernatural',
    'player: Roberto',
    'pcs: Alex [PC:Alex|HP 8|Stress 0]',
    'tools: Oracles - Mythic, Random Event tables',
    'themes: Friendship, courage, secrets',
    'tone: Eerie but playful',
    'notes: Inspired by 80s teen mystery shows',
    '---',
    '',
    '@ Walk to the lighthouse',
  ].join('\n') + '\n';

  const c = fromMarkdown(source);
  assert.equal(c.meta.title, 'Clearview Mystery');
  assert.equal(c.meta.extra.pcs, 'Alex [PC:Alex|HP 8|Stress 0]');
  assert.equal(c.meta.extra.themes, 'Friendship, courage, secrets');

  const out = toMarkdown(c);
  for (const line of ['pcs: Alex [PC:Alex|HP 8|Stress 0]', 'tools: Oracles - Mythic, Random Event tables',
    'themes: Friendship, courage, secrets', 'notes: Inspired by 80s teen mystery shows']) {
    assert.ok(out.includes(line), `export dropped \`${line}\``);
  }
  // And the whole thing is stable: a second trip changes nothing.
  assert.equal(toMarkdown(fromMarkdown(out)), out);
});

test('C10 a log with no header still exports without inventing one', () => {
  const c = fromMarkdown('@ Walk on\n');
  assert.ok(toMarkdown(c).startsWith('---\ntitle: Imported campaign'),
    'a titled campaign writes its title');
  assert.deepEqual(c.meta.extra, {});
});

/* ------- C14/C15 — the compact forms name a character, not a stat --------- */

test('C14 a roster\'s unnamed PC is the PC, not a character called "HP 3"', () => {
  // Combat §5.2 Quick Reference, verbatim.
  const { state } = read(['[PC:Alex|HP 8]', 'Rd3 Roster: [PC:HP 3] [F:Boss|HP 4]']);
  const pcs = elementsOfType(state, 'PC');
  assert.equal(pcs.length, 1, `a phantom PC appeared: ${pcs.map((p) => p.name)}`);
  assert.equal(pcs[0].name, 'Alex');
  assert.equal(pcs[0].fields.get('HP').value, '3');
});

test('C14 the ultra-compact log opens with a PC, however it is written', () => {
  // Combat §7 "Ultra-compact", verbatim first two lines.
  const { state } = read(['S9 *Dock ambush* [COMBAT]', '[PC:HP 12] [F: Captain | HP 10]']);
  const pc = elementsOfType(state, 'PC')[0];
  assert.ok(pc, 'the compact form must still establish a character');
  assert.equal(pc.fields.get('HP').value, '12');
  assert.ok(!/\d/.test(pc.name), `the PC is named after its own stat: ${pc.name}`);
});

test('C15 a delta written into the name slot applies to the named element', () => {
  // Combat §7 "Ultra-compact": `[N: Jordan HP-4]`.
  const { state } = read(['[N:Jordan|ally|HP 8]', '[N: Jordan HP-4]']);
  const jordan = getElement(state, 'N', 'Jordan');
  assert.equal(elementsOfType(state, 'N').length, 1, 'the delta must not fork the NPC');
  assert.equal(jordan.fields.get('HP').value, '4');
  assert.ok(jordan.flags.has('ally'), 'the compact update keeps what was already true');
});

test('C14/C15 numbered individuals are untouched (audit A1 still holds)', () => {
  const { state } = read(['[F:Pirate 1|Close]', '[F:Pirate 2|Medium]', '[Inv:Slot 1|torch]']);
  assert.deepEqual(elementsOfType(state, 'F').map((f) => f.name), ['Pirate 1', 'Pirate 2']);
  assert.equal(elementsOfType(state, 'Inv')[0].name, 'Slot 1');
});

/* ---- C16 — the analog header is the same construct as the digital one ----- */

test('C16 an analog session header lexes as the heading it mirrors (T27)', () => {
  const { entries } = read(['=== Session 1 ===', '[Date] 2025-09-03']);
  assert.equal(entries[0].kind, 'heading', 'the analog header must not be prose');
  assert.equal(entries[0].title, 'Session 1');
  assert.equal(entries[0].form, 'analog');
  assert.equal(entries[1].kind, 'metaField');
});

test('C16 the analog campaign header names the campaign (core §5.1)', () => {
  const { entries, state } = read(['=== Campaign Log: Clearview Mystery ===', '[Ruleset] Loner']);
  assert.equal(entries[0].kind, 'heading');
  assert.equal(state.meta.title.value, 'Clearview Mystery');
  assert.equal(state.meta.ruleset.value, 'Loner');
});

test('C16 a row of equals signs is not a header', () => {
  for (const line of ['=====', '== ==', 'a === b === c']) {
    assert.equal(read([line]).entries[0].kind, 'prose', `${line} read as a heading`);
  }
});

test('C16 both header forms are lossless', () => {
  const text = '=== Campaign Log: X ===\n[Tone]\nEerie\n\n=== Session 1 ===\n[Date] 2025-09-03\n';
  assert.equal(render(lex(text)), text);
});
