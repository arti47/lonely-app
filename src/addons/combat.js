/**
 * Combat add-on surface (ledger T28–T34).
 *
 * Surfaces automatically the first time a `[F:]` tag, an `Rd#` marker or a
 * `[COMBAT]` block appears in the log (D6). Every control appends a line; none
 * of them mutate state (§5.1).
 */

import { el, clear } from '../core.js';
import { promptModal } from '../ui.js';
import { elementsOfType } from '../lonelog/fold.js';
import { deltaLine, flagLine, transitionLine, countLine, tag, field } from '../state.js';

export const id = 'combat';
export const title = 'Combat';
export const types = ['F'];

/** Range bands (combat §3.3). Ordered near to far. */
export const POSITIONS = ['Engaged', 'Close', 'Medium', 'Far'];

/** Terminal states worth a one-tap control (combat §3.1). */
export const OUTCOMES = ['wounded', 'staggered', 'dead', 'fled'];

/* ----------------------------- line builders ----------------------------- */

/** `Rd2` — rounds are local to the encounter and start at 1 (combat §2). */
export function nextRoundLine(state) {
  const current = state.marker?.round?.round ?? 0;
  return `Rd${current + 1}`;
}

/**
 * `Rd3 Roster: [F:Captain|HP 4] [F:Piratex1|HP 4]` (combat §5.2).
 * A snapshot line, so it restates rather than deltas.
 */
export function rosterLine(state) {
  const round = state.marker?.round?.round ?? 1;
  const parts = [...elementsOfType(state, 'PC'), ...elementsOfType(state, 'F')]
    .filter((e) => !e.flags.has('dead') && !e.flags.has('fled'))
    .map((e) => {
      const stats = [...e.fields].map(([k, v]) => field({ key: k, value: v.value }));
      return tag(e, stats, null, e.count?.value ?? null);
    });
  return `Rd${round} Roster: ${parts.join(' ')}`;
}

/** `(Init: Captain 18, Alex 15)` — a meta note, not a new symbol (combat Quick Ref). */
export function initiativeLine(order) {
  return `(Init: ${String(order).trim()})`;
}

/** `[F:Thug A|HP-3]` (combat §3.1). */
export function damageLine(foe, amount) {
  return deltaLine(foe, hpKey(foe), -Math.abs(amount));
}

/** `[F:Thug A|HP+2]`. */
export function healLine(foe, amount) {
  return deltaLine(foe, hpKey(foe), Math.abs(amount));
}

/** The stat this combatant actually uses — HP, Threat, Harm… */
function hpKey(foe) {
  const keys = [...foe.fields.keys()];
  return keys.find((k) => /^(hp|health|threat|harm|wounds?)$/i.test(k)) ?? keys[0] ?? 'HP';
}

/** `[F:Thug A|Far -> Close]` (combat §3.3). */
export function moveLine(foe, to) {
  const from = POSITIONS.find((p) => foe.flags.has(p));
  return from ? transitionLine(foe, from, to) : flagLine(foe, to, 'add');
}

/** `[F:Thug A|dead]` (combat §3.1). */
export function outcomeLine(foe, outcome) {
  return flagLine(foe, outcome, 'add');
}

/** `[F:Skeletonx2]` — a group loses one (combat §3.2). */
export function splitLine(foe, n) {
  return countLine(foe, n);
}

/* -------------------------------- render --------------------------------- */

export function render(host, state, ctx) {
  const foes = elementsOfType(state, 'F');
  const round = state.marker?.round;

  host.append(el('div', { class: 'addon-tools' }, [
    el('button', {
      class: 'btn btn-tiny', type: 'button',
      onclick: () => ctx.commit([nextRoundLine(state)]),
    }, [round ? `Round ${round.round + 1}` : 'Round 1']),
    foes.length ? el('button', {
      class: 'btn btn-tiny', type: 'button', title: 'Snapshot every combatant at this round',
      onclick: () => ctx.commit([rosterLine(state)]),
    }, ['Roster']) : null,
    el('button', {
      class: 'btn btn-tiny', type: 'button',
      onclick: async () => {
        const order = await promptModal('Initiative order', {
          title: 'Note initiative', placeholder: 'Captain 18, Alex 15, Pirates 8',
        });
        if (order?.trim()) await ctx.commit([initiativeLine(order)]);
      },
    }, ['Initiative…']),
  ]));

  if (!foes.length) {
    host.append(el('p', { class: 'hint' }, [
      'No combatants tracked. Write [F:Name|HP 6|Close] and they appear here.',
    ]));
    return;
  }

  host.append(el('ul', { class: 'plain-list' }, foes.map((foe) => foeRow(foe, ctx))));
}

function foeRow(foe, ctx) {
  const down = foe.flags.has('dead') || foe.flags.has('fled');
  const position = POSITIONS.find((p) => foe.flags.has(p));
  const stats = [...foe.fields].map(([k, v]) => `${k} ${v.value}`);
  const other = [...foe.flags.keys()].filter((f) => !POSITIONS.includes(f));

  const detail = [
    foe.count ? `x${foe.count.value}` : null,
    ...stats,
    ...other,
  ].filter(Boolean).join(' · ');

  const controls = down ? [] : [
    el('button', {
      class: 'btn btn-tiny', type: 'button', 'aria-label': `Damage ${foe.name}`,
      onclick: () => ctx.commit([damageLine(foe, 1)]),
    }, ['−1']),
    el('button', {
      class: 'btn btn-tiny', type: 'button', 'aria-label': `Damage ${foe.name} by an amount`,
      onclick: async () => {
        const n = await promptModal(`Damage to ${foe.name}`, { title: 'Damage', placeholder: '3' });
        if (n && Number.isFinite(Number(n))) await ctx.commit([damageLine(foe, Number(n))]);
      },
    }, ['−n']),
    foe.count ? el('button', {
      class: 'btn btn-tiny', type: 'button', title: 'One of the group drops',
      onclick: () => ctx.commit([splitLine(foe, Math.max(0, foe.count.value - 1))]),
    }, ['group −1']) : null,
    el('button', {
      class: 'btn btn-tiny', type: 'button',
      onclick: async () => {
        const to = await pick('Move to', POSITIONS.filter((p) => p !== position));
        if (to) await ctx.commit([moveLine(foe, to)]);
      },
    }, [position ?? 'position…']),
    el('button', {
      class: 'btn btn-tiny', type: 'button',
      onclick: async () => {
        const outcome = await pick(`${foe.name} is…`, OUTCOMES.filter((o) => !foe.flags.has(o)));
        if (outcome) await ctx.commit([outcomeLine(foe, outcome)]);
      },
    }, ['status…']),
  ].filter(Boolean);

  return el('li', { class: down ? 'is-down' : null }, [
    el('span', { class: 'el-name' }, [foe.name]),
    el('span', { class: 'el-detail' }, [detail || '—']),
    el('div', { class: 'stat-steppers' }, controls),
    ctx.traceButton(foe.lastLine),
  ]);
}

/** Small chooser built on the shared modal (no native prompts, §2). */
export async function pick(title, options) {
  if (!options.length) return null;
  const { modal } = await import('../ui.js');
  return modal({
    title,
    body: '',
    actions: [{ label: 'Cancel', value: null }, ...options.map((o) => ({ label: o, value: o }))],
  });
}
