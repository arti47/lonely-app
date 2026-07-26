/**
 * State pane (CLAUDE.md §8 Phase 3).
 *
 * Everything here is a *view* onto the fold. The character sheet is derived from
 * `[PC:]` tags rather than configured from a schema (D5), and editing a value
 * **appends a tag line to the log** — state is never mutated directly (§5.1).
 * Every rendered value carries the line that last set it and links back to it
 * (§5.7).
 */

import { el, clear } from './core.js';
import { modal, promptModal, referenceButton } from './ui.js';
import { serializeTag } from './lonelog/tags.js';
import { elementsOfType } from './lonelog/fold.js';
import { surfaced } from './addons/index.js';

/** Core element types the State pane renders in its own right. */
export const CORE_TYPES = ['PC', 'N', 'L', 'Thread', 'Clock', 'Track', 'Timer', 'E'];

/** Types owned by an add-on surface (Phase 5); listed generically until then. */
export const ADDON_TYPES = ['F', 'R', 'Inv', 'Wealth', 'Unit', 'Force', 'Scenario'];

const SECTIONS = [
  { key: 'PC', title: 'Character', types: ['PC'] },
  { key: 'meters', title: 'Clocks, tracks & timers', types: ['Clock', 'Track', 'Timer', 'E'] },
  { key: 'Thread', title: 'Threads', types: ['Thread'] },
  { key: 'cast', title: 'People & places', types: ['N', 'L'] },
];

/* -------------------------------------------------------------------------- */
/* Line builders — pure, exported for tests. Each returns one Lonelog line.    */
/* -------------------------------------------------------------------------- */

/**
 * Build one tag field. Exported so add-on surfaces emit tags the same way the
 * State pane does (CLAUDE.md §9.2 — notation lives in one place).
 * @param {object} partial
 */
export function field(partial) {
  return {
    raw: '', op: 'set', key: null, value: '',
    count: null, delta: null, progress: null, transition: null, list: null,
    category: false, ...partial,
  };
}

/**
 * Build a tag line for an element.
 * @param {{type:string,name:string}} element
 * @param {object[]} fields
 * @param {object|null} [head]
 * @param {number|null} [count] head-attached group count, e.g. `[F:Skeletonx2]`
 */
export function tag(element, fields, head = null, count = null) {
  return serializeTag({
    ref: false, type: element.type, name: element.name,
    count, head, fields,
  });
}

/**
 * Set a group's size. Combat writes the count onto the name (`[F:Skeletonx2]`,
 * combat §3.2) while wargaming uses a size field (`[Unit:Rifles|x11]`,
 * wargaming §2); both are the form each spec's own examples use.
 * @param {object} element @param {number} n
 */
export function countLine(element, n) {
  const size = Math.max(0, Math.round(n));
  return element.type === 'Unit'
    ? tag(element, [field({ count: size })])
    : tag(element, [], null, size);
}

/** Replace an element's head value: `[Wealth:Gold 52]`, `[Unit:Atlas|Heat 5]`. */
export function headValueLine(element, value) {
  return tag(element, [], { kind: 'value', value: String(value) });
}

/** Clamp helper so a meter never leaves its own track. */
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

/**
 * Step a clock/track/event meter (core §4.2). Restates the whole X/Y value,
 * which is how the specs' own examples show a clock advancing.
 * @param {object} element @param {number} delta
 */
export function progressLine(element, delta) {
  const current = element.progress?.current ?? 0;
  const total = element.progress?.total ?? 0;
  const next = clamp(current + delta, 0, Math.max(total, current + delta));
  return tag(element, [], { kind: 'progress', current: next, total });
}

/**
 * Step a countdown timer (core §4.2).
 * @param {object} element @param {number} delta
 */
export function timerLine(element, delta) {
  const current = Number(element.value?.value ?? 0) || 0;
  return tag(element, [], { kind: 'value', value: String(Math.max(0, current + delta)) });
}

/**
 * Adjust a numeric stat by a delta, in the spec's own shorthand — `[PC:Alex|HP-2]`
 * (core §4.1.5) — so the log reads as a change rather than a restatement.
 */
export function deltaLine(element, key, delta) {
  return tag(element, [field({
    key,
    delta: { sign: delta < 0 ? '-' : '+', amount: Math.abs(delta) },
  })]);
}

/** Add or remove a flag: `[N:Jonah|+captured]` / `[N:Jonah|-wounded]` (§4.1.1). */
export function flagLine(element, flag, op = 'add') {
  return tag(element, [field({ op, value: String(flag).trim() })]);
}

/**
 * Move between mutually exclusive states. The transition form is used rather
 * than a restatement because flags accumulate — restating `Closed` would leave
 * `Open` set too (§4.1.1).
 */
export function transitionLine(element, from, to) {
  return tag(element, [field({ transition: { from: String(from), to: String(to) } })]);
}

/** Set or replace a stat outright: `[PC:Alex|HP 12]`. */
export function setLine(element, key, value) {
  return tag(element, [field({ key, value: String(value).trim() })]);
}

/** Thread states offered in the UI (core §4.1.4); custom states stay allowed. */
export const THREAD_STATES = ['Open', 'Closed', 'Abandoned'];

/* -------------------------------------------------------------------------- */
/* Rendering                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The persistent state header shown on every in-play screen (CLAUDE.md §1).
 * @param {object} state
 * @param {(line:number)=>any} [onTrace]
 */
export function renderStateHeader(state, onTrace) {
  const chips = [];

  if (state.marker.scene) chips.push(chip('Scene', state.marker.scene.id, state.marker.scene.line));
  if (state.marker.round) chips.push(chip('Round', state.marker.round.id));
  if (state.marker.turn) chips.push(chip('Turn', state.marker.turn.id));

  for (const block of state.blockStack) chips.push(chip('In', titleCase(block.name), block.startLine));

  // The PC's own numeric stats are the thing worth keeping on screen.
  const pc = elementsOfType(state, 'PC')[0];
  if (pc) {
    for (const [key, v] of pc.fields) {
      if (chips.length > 7) break;
      chips.push(chip(key, v.value, v.line));
    }
  }

  for (const clock of [...elementsOfType(state, 'Clock'), ...elementsOfType(state, 'E')]) {
    if (!clock.progress) continue;
    chips.push(chip(clock.name, `${clock.progress.current}/${clock.progress.total}`, clock.progress.line));
  }

  if (!chips.length) chips.push(chip('State', 'nothing tracked yet'));

  function chip(key, value, line) {
    const node = el(line != null && onTrace ? 'button' : 'span', {
      class: 'chip', type: line != null && onTrace ? 'button' : null,
      title: line != null ? `Set on line ${line + 1}` : null,
      onclick: line != null && onTrace ? () => onTrace(line) : null,
    }, [el('span', { class: 'chip-key' }, [key]), ` ${value}`]);
    return node;
  }

  return el('div', { class: 'state-header', role: 'status', 'aria-label': 'Campaign state' }, chips);
}

/**
 * @param {HTMLElement} host
 * @param {object} state
 * @param {{commit:(lines:string[])=>Promise<any>, trace:(line:number)=>any,
 *          traceButton?:(line:number)=>Node|null, hidden?:Set<string>,
 *          toggleHidden?:(addonId:string)=>any}} ctx
 */
export function renderState(host, state, ctx) {
  clear(host);

  const rendered = new Set();
  let any = false;

  for (const section of SECTIONS) {
    const items = section.types.flatMap((t) => elementsOfType(state, t));
    if (!items.length) continue;
    any = true;
    for (const t of section.types) rendered.add(t);
    host.append(el('section', { class: 'group' }, [
      el('h2', {}, [section.title]),
      section.key === 'PC'
        ? el('div', {}, items.map((pc) => pcSheet(pc, ctx)))
        : section.key === 'meters'
          ? el('ul', { class: 'meter-list' }, items.map((m) => meterRow(m, ctx)))
          : section.key === 'Thread'
            ? el('ul', { class: 'plain-list' }, items.map((t) => threadRow(t, ctx)))
            : el('ul', { class: 'plain-list' }, items.map((c) => castRow(c, ctx))),
    ]));
  }

  // Add-on panels appear because the log contains their tags, never because a
  // setting was flipped (D6). Hiding one is view state and never edits the log.
  for (const addon of surfaced(state)) {
    any = true;
    for (const type of addon.types) rendered.add(type);
    const hidden = ctx.hidden?.has(addon.id);

    const panel = el('section', { class: 'group addon', dataset: { addon: addon.id } }, [
      el('div', { class: 'addon-head' }, [
        el('h2', {}, [addon.title]),
        addon.reference ? referenceButton(addon.reference, { label: addon.title }) : null,
        el('button', {
          class: 'btn btn-tiny', type: 'button',
          'aria-expanded': hidden ? 'false' : 'true',
          onclick: () => ctx.toggleHidden?.(addon.id),
        }, [hidden ? 'Show' : 'Hide']),
      ]),
    ]);

    if (!hidden) addon.render(panel, state, ctx);
    else panel.append(el('p', { class: 'hint' }, ['Hidden here. Your log still has every line.']));

    host.append(panel);
  }

  // Anything not owned by a surface — a homebrew type — still has to be visible.
  const rest = [...state.elements.values()].filter((e) => !rendered.has(e.type));
  if (rest.length) {
    any = true;
    const byType = new Map();
    for (const e of rest) {
      if (!byType.has(e.type)) byType.set(e.type, []);
      byType.get(e.type).push(e);
    }
    for (const [type, items] of [...byType].sort()) {
      host.append(el('section', { class: 'group' }, [
        el('h2', {}, [type]),
        el('ul', { class: 'plain-list' }, items.map((item) => castRow(item, ctx))),
        null,
      ]));
    }
  }

  if (!any) {
    host.append(el('p', { class: 'empty' }, [
      'Nothing tracked yet. State appears here as tags appear in your log — write '
      + '[PC:Name|HP 10] and a character sheet grows itself.',
    ]));
  }
}

/** A character sheet folded out of `[PC:]` tags (D5). */
function pcSheet(pc, ctx) {
  const stats = [...pc.fields].map(([key, v]) => el('div', { class: 'stat' }, [
    el('span', { class: 'stat-key' }, [key]),
    traceValue(v.value, v.line, ctx),
    el('div', { class: 'stat-steppers' }, [
      stepper('−', `Decrease ${key}`, () => ctx.commit([deltaLine(pc, key, -1)])),
      stepper('+', `Increase ${key}`, () => ctx.commit([deltaLine(pc, key, +1)])),
      el('button', {
        class: 'btn btn-tiny', type: 'button', title: `Set ${key}`,
        onclick: async () => {
          const next = await promptModal(`New value for ${key}`, { title: pc.name, value: v.value });
          if (next != null && next.trim()) await ctx.commit([setLine(pc, key, next)]);
        },
      }, ['set']),
    ]),
  ]));

  return el('article', { class: 'sheet' }, [
    el('h3', { class: 'sheet-name' }, [pc.name]),
    stats.length ? el('div', { class: 'stat-grid' }, stats) : el('p', { class: 'hint' }, ['No stats recorded yet.']),
    flagRow(pc, ctx, 'Conditions'),
  ]);
}

function meterRow(m, ctx) {
  const isTimer = m.type === 'Timer';
  const current = isTimer ? Number(m.value?.value ?? 0) : (m.progress?.current ?? 0);
  const total = isTimer ? null : (m.progress?.total ?? 0);
  const line = isTimer ? m.value?.line : m.progress?.line;
  const pct = total ? Math.min(100, Math.round((current / total) * 100)) : 0;

  const step = (delta) => ctx.commit([isTimer ? timerLine(m, delta) : progressLine(m, delta)]);

  return el('li', { class: `meter meter-${m.type.toLowerCase()}` }, [
    el('div', { class: 'meter-head' }, [
      el('span', { class: 'el-name' }, [m.name]),
      el('span', { class: 'meter-type' }, [m.type]),
      traceValue(isTimer ? String(current) : `${current}/${total}`, line, ctx),
    ]),
    isTimer ? null : el('div', {
      class: 'meter-bar', role: 'meter', 'aria-valuenow': String(current),
      'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-label': m.name,
    }, [el('span', { class: 'meter-fill', style: `width:${pct}%` })]),
    el('div', { class: 'stat-steppers' }, [
      stepper('−', `Decrease ${m.name}`, () => step(-1)),
      stepper('+', `Increase ${m.name}`, () => step(+1)),
    ]),
  ]);
}

function threadRow(t, ctx) {
  const current = [...t.flags.keys()];
  const state = current[current.length - 1] ?? 'Open';
  return el('li', {}, [
    el('span', { class: 'el-name' }, [t.name]),
    el('span', { class: 'el-detail' }, [current.join(' · ') || '—']),
    el('div', { class: 'stat-steppers' }, THREAD_STATES.filter((s) => s !== state).map((s) =>
      el('button', {
        class: 'btn btn-tiny', type: 'button',
        onclick: () => ctx.commit([transitionLine(t, state, s)]),
      }, [s]))),
    traceLink(t.lastLine, ctx),
  ]);
}

function castRow(c, ctx) {
  const parts = [];
  if (c.count) parts.push(`x${c.count.value}`);
  if (c.value) parts.push(c.value.value);
  if (c.progress) parts.push(`${c.progress.current}/${c.progress.total}`);
  for (const [k, v] of c.fields) parts.push(`${k} ${v.value}`);
  for (const f of c.flags.keys()) parts.push(f);

  return el('li', {}, [
    el('span', { class: 'el-name' }, [c.name]),
    el('span', { class: 'el-detail' }, [parts.join(' · ') || '—']),
    el('button', {
      class: 'btn btn-tiny', type: 'button', title: `Add or remove a tag on ${c.name}`,
      onclick: () => editFlags(c, ctx),
    }, ['tag…']),
    traceLink(c.lastLine, ctx),
  ]);
}

function flagRow(element, ctx, label) {
  const flags = [...element.flags.keys()];
  return el('div', { class: 'flag-row' }, [
    el('span', { class: 'field-label' }, [label]),
    ...flags.map((f) => el('button', {
      class: 'chip chip-flag', type: 'button', title: `Remove “${f}”`,
      onclick: () => ctx.commit([flagLine(element, f, 'remove')]),
    }, [f, el('span', { class: 'chip-x', 'aria-hidden': 'true' }, ['×'])])),
    el('button', {
      class: 'btn btn-tiny', type: 'button',
      onclick: () => editFlags(element, ctx),
    }, ['+ add']),
  ]);
}

async function editFlags(element, ctx) {
  const flags = [...element.flags.keys()];
  const value = await modal({
    title: element.name,
    body: el('div', {}, [
      el('p', { class: 'hint' }, [flags.length ? `Current: ${flags.join(', ')}` : 'No tags yet.']),
      el('p', { class: 'hint' }, ['Adding appends a tag line to your log; it never edits state directly.']),
    ]),
    actions: [
      { label: 'Cancel', value: null },
      ...flags.slice(0, 2).map((f) => ({ label: `Remove ${f}`, value: `-${f}` })),
      { label: 'Add a tag', value: 'add', primary: true },
    ],
  });

  if (value == null) return;
  if (value === 'add') {
    const next = await promptModal('Tag to add', { title: element.name, placeholder: 'wounded' });
    if (next?.trim()) await ctx.commit([flagLine(element, next.trim(), 'add')]);
    return;
  }
  await ctx.commit([flagLine(element, value.slice(1), 'remove')]);
}

function stepper(glyph, label, onclick) {
  return el('button', { class: 'btn btn-tiny', type: 'button', 'aria-label': label, onclick }, [glyph]);
}

/** A value that links back to the line that set it (§5.7). */
function traceValue(text, line, ctx) {
  if (line == null) return el('span', { class: 'stat-value' }, [String(text)]);
  return el('button', {
    class: 'stat-value stat-trace', type: 'button',
    title: `Set on line ${line + 1} — open it in the log`,
    onclick: () => ctx.trace(line),
  }, [String(text)]);
}

/** Exposed to add-on surfaces so every panel traces back the same way (§5.7). */
export function traceButton(line, ctx) {
  return traceLink(line, ctx);
}

function traceLink(line, ctx) {
  if (line == null) return null;
  return el('button', {
    class: 'el-line el-trace', type: 'button',
    title: `Last changed on line ${line + 1}`,
    onclick: () => ctx.trace(line),
  }, [`line ${line + 1}`]);
}

function titleCase(s) {
  return s.toLowerCase().replace(/(^|\s)\w/g, (c) => c.toUpperCase());
}
