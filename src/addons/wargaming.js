/**
 * Solo Wargaming add-on surface (ledger T48–T57).
 *
 * Surfaces on the first `[Unit:]`, `[Force:]` or `[Scenario:]` tag, a `Tn#`
 * marker, or a `[BATTLE]` / `[CAMPAIGN]` block (D6).
 *
 * `Tn#` is deliberately distinct from the Combat add-on's `Rd#` — unit-scale
 * turns and personal-scale rounds can both appear in one log (wargaming §1), so
 * this panel never touches the round marker.
 */

import { el } from '../core.js';
import { promptModal } from '../ui.js';
import { elementsOfType } from '../lonelog/fold.js';
import { flagLine, transitionLine, countLine, tag, field } from '../state.js';
import { pick } from './combat.js';

export const id = 'wargaming';
export const reference = 'addon-wargaming';
export const title = 'Battle';
export const types = ['Unit', 'Force', 'Scenario'];

/** Unit status vocabulary (wargaming §2). Defaults; systems may substitute. */
export const UNIT_STATUS = [
  'Fresh', 'Steady', 'Wavering', 'Broken', 'Routed', 'Rallied', 'Pinned', 'Engaged', 'Exhausted',
];

/** Abstract sizes for systems that do not count models (wargaming §2). */
export const ABSTRACT_SIZE = ['full', 'half', 'depleted'];

/** Optional phase suffixes on a turn marker (wargaming §1). */
export const PHASES = ['Move', 'Shoot', 'Combat', 'Heat', 'Morale'];

/* ----------------------------- line builders ----------------------------- */

/** `Tn2` or `Tn2 Move:` (wargaming §1). */
export function nextTurnLine(state, phase = null) {
  const current = state.marker?.turn?.turn ?? 0;
  return phase ? `Tn${current + 1} ${phase}:` : `Tn${current + 1}`;
}

/** `Tn2 Shoot:` — a phase within the turn already open. */
export function phaseLine(state, phase) {
  const current = state.marker?.turn?.turn ?? 1;
  return `Tn${current} ${phase}:`;
}

/** `[Unit:Rifles|x11]` — casualties (wargaming §2). */
export function casualtyLine(unit, size) {
  return countLine(unit, size);
}

/** `[Unit:Orc Mob|full -> half]` for abstract sizes. */
export function sizeLine(unit, to) {
  const from = ABSTRACT_SIZE.find((s) => unit.flags.has(s));
  return from ? transitionLine(unit, from, to) : flagLine(unit, to, 'add');
}

/** `[Unit:Rifles|Steady -> Broken]` (wargaming §2). */
export function statusLine(unit, to) {
  const from = UNIT_STATUS.find((s) => unit.flags.has(s));
  return from ? transitionLine(unit, from, to) : flagLine(unit, to, 'add');
}

/** `[Unit:Atlas|Heat 5]` (wargaming §5). */
export function heatLine(unit, value) {
  return tag(unit, [field({ key: 'Heat', value: String(value) })]);
}

/** `[Unit:Summoner|Armor CT22->8/RT18/LT18]` (wargaming §5). */
export function armorLine(unit, value) {
  return tag(unit, [field({ key: 'Armor', value: String(value).trim() })]);
}

/** Heat thresholds (wargaming §5). Advisory labels, never applied. */
export function heatBand(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n >= 18) return 'Critical — auto-shutdown check';
  if (n >= 14) return 'Danger — ammo explosion risk';
  if (n >= 10) return 'Overheat — movement and attack penalties';
  return null;
}

/** `[BATTLE]` / `[CAMPAIGN]` snapshots (wargaming §1, §4). */
export function snapshotLines(state, block = 'CAMPAIGN') {
  const lines = [`[${block}]`];
  for (const force of elementsOfType(state, 'Force')) {
    lines.push(tag(force, [...force.fields].map(([k, v]) => field({ key: k, value: v.value }))));
  }
  for (const unit of elementsOfType(state, 'Unit')) {
    const fields = [
      ...(unit.count ? [field({ count: unit.count.value })] : []),
      ...[...unit.fields].map(([k, v]) => field({ key: k, value: v.value })),
      ...[...unit.flags.keys()].map((f) => field({ value: f })),
    ];
    lines.push(tag(unit, fields));
  }
  lines.push(`[/${block}]`);
  return lines;
}

/* -------------------------------- render --------------------------------- */

export function render(host, state, ctx) {
  const units = elementsOfType(state, 'Unit');
  const forces = elementsOfType(state, 'Force');
  const scenario = elementsOfType(state, 'Scenario')[0];
  const turn = state.marker?.turn;

  host.append(el('div', { class: 'addon-tools' }, [
    el('button', {
      class: 'btn btn-tiny', type: 'button',
      onclick: () => ctx.commit([nextTurnLine(state)]),
    }, [turn ? `Turn ${turn.turn + 1}` : 'Turn 1']),
    el('button', {
      class: 'btn btn-tiny', type: 'button',
      onclick: async () => {
        const phase = await pick('Phase', PHASES);
        if (phase) await ctx.commit([phaseLine(state, phase)]);
      },
    }, ['Phase…']),
    el('button', {
      class: 'btn btn-tiny', type: 'button',
      onclick: () => ctx.commit(snapshotLines(state, 'CAMPAIGN')),
    }, ['Campaign block']),
  ]));

  if (scenario) {
    host.append(el('p', { class: 'hint' }, [
      `Scenario: ${scenario.name}`
      + ([...scenario.fields].map(([k, v]) => ` · ${k} ${v.value}`).join(''))
      + ([...scenario.flags.keys()].map((f) => ` · ${f}`).join('')),
    ]));
  }

  if (forces.length) {
    host.append(el('h3', { class: 'addon-sub' }, ['Forces']));
    host.append(el('ul', { class: 'plain-list' }, forces.map((force) => el('li', {}, [
      el('span', { class: 'el-name' }, [force.name]),
      el('span', { class: 'el-detail' }, [
        [...[...force.fields].map(([k, v]) => `${k} ${v.value}`), ...force.flags.keys()].join(' · ') || '—',
      ]),
      ctx.traceButton(force.lastLine),
    ]))));
  }

  host.append(el('h3', { class: 'addon-sub' }, ['Units']));
  if (!units.length) {
    host.append(el('p', { class: 'hint' }, [
      'No units tracked. Write [Unit:Rifles|x12|Morale 8|Fresh] and they appear here.',
    ]));
    return;
  }

  host.append(el('ul', { class: 'plain-list' }, units.map((unit) => unitRow(unit, ctx))));
}

function unitRow(unit, ctx) {
  const out = unit.flags.has('Routed') || unit.flags.has('destroyed');
  const status = UNIT_STATUS.find((s) => unit.flags.has(s));
  const size = ABSTRACT_SIZE.find((s) => unit.flags.has(s));
  const heat = unit.fields.get('Heat')?.value;
  const band = heatBand(heat);

  const detail = [
    unit.count ? `x${unit.count.value}` : size,
    ...[...unit.fields].map(([k, v]) => `${k} ${v.value}`),
    ...[...unit.flags.keys()].filter((f) => f !== size),
  ].filter(Boolean).join(' · ');

  return el('li', { class: out ? 'is-down' : null }, [
    el('span', { class: 'el-name' }, [unit.name]),
    el('span', { class: 'el-detail' }, [detail || '—']),
    band ? el('span', { class: 'warn-flag', title: band }, ['heat']) : null,
    el('div', { class: 'stat-steppers' }, out ? [] : [
      unit.count ? el('button', {
        class: 'btn btn-tiny', type: 'button', 'aria-label': `One casualty in ${unit.name}`,
        onclick: () => ctx.commit([casualtyLine(unit, Math.max(0, unit.count.value - 1))]),
      }, ['−1']) : el('button', {
        class: 'btn btn-tiny', type: 'button',
        onclick: async () => {
          const to = await pick(`${unit.name} strength`, ABSTRACT_SIZE.filter((s) => s !== size));
          if (to) await ctx.commit([sizeLine(unit, to)]);
        },
      }, [size ?? 'size…']),
      el('button', {
        class: 'btn btn-tiny', type: 'button',
        onclick: async () => {
          const to = await pick(`${unit.name} is…`, UNIT_STATUS.filter((s) => s !== status));
          if (to) await ctx.commit([statusLine(unit, to)]);
        },
      }, [status ?? 'status…']),
      heat != null ? el('button', {
        class: 'btn btn-tiny', type: 'button',
        onclick: async () => {
          const value = await promptModal('Heat after this turn', { title: unit.name, value: String(heat) });
          if (value != null && value.trim()) await ctx.commit([heatLine(unit, value.trim())]);
        },
      }, [`heat ${heat}`]) : null,
      unit.fields.has('Armor') ? el('button', {
        class: 'btn btn-tiny', type: 'button',
        onclick: async () => {
          const value = await promptModal('Armor by location', {
            title: unit.name, value: unit.fields.get('Armor').value,
          });
          if (value?.trim()) await ctx.commit([armorLine(unit, value)]);
        },
      }, ['armor…']) : null,
    ].filter(Boolean)),
    ctx.traceButton(unit.lastLine),
  ]);
}
