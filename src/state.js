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
import { surfaced, ownedTypes } from './addons/index.js';

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

/**
 * Add a named field, choosing the notation from the value itself.
 *
 * `Stress 0`, `HP 12/15` and `Supply d8` all read as a keyed stat because they
 * end in something numeric; plain words do not, so those take the category form
 * `Gear: sword` (core §4.1.7). Getting this wrong would silently file the value
 * as a flag instead of a stat.
 *
 * @param {{type:string,name:string}} element
 * @param {string} key
 * @param {string} value  empty for a flag rather than a field
 */
export function addLine(element, key, value = '') {
  const name = String(key).trim();
  const text = String(value ?? '').trim();
  if (!text) return flagLine(element, name, 'add');
  return numericish(text)
    ? tag(element, [field({ key: name, value: text })])
    : tag(element, [field({ key: name, value: text, category: true })]);
}

/** Does this value parse back as part of a keyed field rather than a flag? */
export function numericish(value) {
  const v = String(value).trim();
  return /^-?\d+(\.\d+)?$/.test(v)          // 8
    || /^\d+\s*\/\s*\d+$/.test(v)          // 12/15
    || /^d\d+$/i.test(v)                      // d8
    || /\d/.test(v.split(/\s+/)[0]);         // CT30/RT25, 3 each
}

/**
 * Remove a named field or flag: `[PC:Alex|-Stress]` (core §4.1.1).
 * @param {{type:string,name:string}} element @param {string} key
 */
export function removeLine(element, key) {
  return flagLine(element, String(key).trim(), 'remove');
}

/** Field names already in use anywhere in the campaign, for autocomplete. */
export function knownFieldKeys(state) {
  const keys = new Set();
  for (const element of state.elements.values()) {
    for (const key of element.fields.keys()) keys.add(key);
  }
  return [...keys].sort();
}

/** Thread states offered in the UI (core §4.1.4); custom states stay allowed. */
export const THREAD_STATES = ['Open', 'Closed', 'Abandoned'];

/**
 * Which of a vocabulary's states this element is currently in.
 *
 * Two things matter and both bit us. The specs write their own vocabularies in
 * mixed case — wargaming §2 tabulates `Wavering` and `Broken`, then its examples
 * write `[Unit:Rifles|x8|wavering]` — so matching must ignore case. And an
 * element may carry several of them at once (a log that added `half` while
 * `full` was still set), so the answer is the one set *last*, not the first in
 * the vocabulary.
 *
 * Returns the flag exactly as the log spells it, because that is what a
 * transition has to name in order to clear it.
 *
 * @param {object} element folded element
 * @param {string[]} vocabulary
 * @returns {string|null}
 */
export function currentFlag(element, vocabulary) {
  const known = new Map(vocabulary.map((v) => [v.toLowerCase(), v]));
  let best = null;
  let bestLine = -Infinity;
  for (const [flag, line] of element.flags ?? []) {
    if (!known.has(String(flag).trim().toLowerCase())) continue;
    if (line >= bestLine) { best = flag; bestLine = line; }
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Whether the status strip is expanded. View state for the life of the page —
 * a preference would be a schema field for something the user re-decides every
 * few seconds (§7 does not apply).
 */
let headerExpanded = false;

/**
 * The persistent status strip shown on every in-play screen (CLAUDE.md §1, D12).
 *
 * One line by default: what session and scene you are in, then the values you
 * are playing against. Tapping it opens the full chip set, where every value
 * still traces to the line that set it (§5.7). The whole chip set pinned at all
 * times ate a third of a 360px screen before a word had been written.
 *
 * @param {object} state
 * @param {(line:number)=>any} [onTrace]
 * @param {{onScene?:()=>any, onSession?:()=>any}} [lifecycle] shown only where
 *   there is somewhere to commit to — the Play screen
 */
export function renderStateHeader(state, onTrace, lifecycle = {}) {
  const chips = [];
  /** Short `key value` pairs for the collapsed line, in the same order. */
  const summary = [];

  const session = (state.sessions ?? [])[state.sessions.length - 1];
  if (session) {
    chips.push(chip('Session', String(session.number), session.line));
    summary.push(`Session ${session.number}`);
  }
  // The strip spells its markers out. `S1`, `Rd1` and `Tn1` are the notation,
  // and the notation is exactly what a reader of this line has not learnt yet;
  // the chips underneath still show the marker itself.
  if (state.marker.scene) {
    chips.push(chip('Scene', state.marker.scene.id, state.marker.scene.line));
    summary.push(`Scene ${state.marker.scene.id.replace(/^S/, '')}`);
  }
  if (state.marker.round) {
    chips.push(chip('Round', state.marker.round.id));
    summary.push(`Round ${state.marker.round.round}`);
  }
  if (state.marker.turn) {
    chips.push(chip('Turn', state.marker.turn.id));
    summary.push(`Turn ${state.marker.turn.turn}`);
  }

  for (const block of state.blockStack) {
    chips.push(chip('In', titleCase(block.name), block.startLine));
    summary.push(titleCase(block.name));
  }

  // The PC's own numeric stats are the thing worth keeping on screen.
  const pc = elementsOfType(state, 'PC')[0];
  if (pc) {
    for (const [key, v] of pc.fields) {
      chips.push(chip(key, v.value, v.line));
      summary.push(`${key} ${v.value}`);
    }
  }

  for (const clock of [...elementsOfType(state, 'Clock'), ...elementsOfType(state, 'E')]) {
    if (!clock.progress) continue;
    chips.push(chip(clock.name, `${clock.progress.current}/${clock.progress.total}`, clock.progress.line));
    summary.push(`${clock.name} ${clock.progress.current}/${clock.progress.total}`);
  }

  if (!chips.length) {
    chips.push(chip('State', 'nothing tracked yet'));
    summary.push('Nothing tracked yet');
  }

  function chip(key, value, line) {
    return el(line != null && onTrace ? 'button' : 'span', {
      class: 'chip', type: line != null && onTrace ? 'button' : null,
      title: line != null ? `Set on line ${line + 1}` : null,
      onclick: line != null && onTrace ? () => onTrace(line) : null,
    }, [el('span', { class: 'chip-key' }, [key]), ` ${value}`]);
  }

  const wrap = el('div', { class: 'state-header', role: 'status', 'aria-label': 'Campaign state' });
  const expandedHost = el('div', { class: 'state-chips' }, chips);

  const toggle = el('button', {
    class: 'state-summary', type: 'button',
    'aria-expanded': headerExpanded ? 'true' : 'false',
    'aria-label': 'Campaign state — show every value',
    onclick: () => {
      headerExpanded = !headerExpanded;
      draw();
    },
  });

  // Scene and session are the spine of a session and belong with the state they
  // move, not buried in a row of six equal-weight composer tools (D12).
  //
  // Session first, then Scene: a session contains scenes, it is the thing you
  // start before anything else — the getting-started checklist opens by saying
  // so — and the strip's own summary already reads `Session 2 · S5`.
  const controls = el('div', { class: 'state-lifecycle' }, [
    lifecycle.onSession ? el('button', {
      class: 'btn btn-tiny', type: 'button', onclick: () => lifecycle.onSession(),
    }, ['Session…']) : null,
    lifecycle.onScene ? el('button', {
      class: 'btn btn-tiny', type: 'button', onclick: () => lifecycle.onScene(),
    }, ['Scene…']) : null,
  ].filter(Boolean));

  function draw() {
    clear(wrap);
    clear(toggle);
    toggle.setAttribute('aria-expanded', headerExpanded ? 'true' : 'false');
    toggle.append(
      el('span', { class: 'state-summary-text' }, [summary.join(' · ')]),
      el('span', { class: 'state-summary-caret', 'aria-hidden': 'true' }, [headerExpanded ? '▴' : '▾']),
    );
    wrap.append(el('div', { class: 'state-strip' }, [
      toggle,
      controls.childElementCount ? controls : null,
    ]));
    if (headerExpanded) wrap.append(expandedHost);
  }

  draw();
  return wrap;
}

/**
 * @param {HTMLElement} host
 * @param {object} state
 * @param {{commit:(lines:string[])=>Promise<any>, trace:(line:number)=>any,
 *          traceButton?:(line:number)=>Node|null, hidden?:Set<string>,
 *          knownKeys?:string[], toggleHidden?:(addonId:string)=>any}} ctx
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

  // Anything no surface owns — a homebrew type — still has to be visible, and
  // the barrel is what knows which types those are.
  const owned = ownedTypes();
  const rest = [...state.elements.values()]
    .filter((e) => !rendered.has(e.type) && !owned.has(e.type));
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
      'Nothing tracked yet. This sheet is your log read back to you, so it fills '
      + 'itself in as you play. On Play, tap Tag… and name a character — '
      + '[PC:Alex|HP 10] — and a character sheet grows itself. There is nothing '
      + 'to set up here.',
    ]));
  }
}

/**
 * One stat, with the controls that suit it. Used by the character sheet and by
 * every other tracked object, so an NPC's HP steps exactly like a PC's (D5).
 */
function statTile(element, key, v, ctx) {
  const steppable = /^-?\d+(\.\d+)?(\s*\/\s*\d+)?$/.test(String(v.value).trim());
  return el('div', { class: 'stat', dataset: { stat: key } }, [
    el('span', { class: 'stat-key' }, [key]),
    traceValue(v.value, v.line, ctx),
    el('div', { class: 'stat-steppers' }, [
      steppable ? stepper('−', `Decrease ${key} on ${element.name}`,
        () => ctx.commit([deltaLine(element, key, -1)])) : null,
      steppable ? stepper('+', `Increase ${key} on ${element.name}`,
        () => ctx.commit([deltaLine(element, key, +1)])) : null,
      el('button', {
        class: 'btn btn-tiny', type: 'button',
        'aria-label': `Set ${key} on ${element.name}`, title: `Set ${key}`,
        onclick: async () => {
          const next = await promptModal(`New value for ${key}`, { title: element.name, value: v.value });
          if (next != null && next.trim()) await ctx.commit([setLine(element, key, next)]);
        },
      }, ['set…']),
    ].filter(Boolean)),
  ]);
}

/** The "+ field" tile that opens the shared Add… dialog. */
function addTile(element, ctx) {
  return el('button', {
    class: 'stat stat-add', type: 'button',
    'aria-label': `Add a field to ${element.name}`,
    onclick: () => addDialog(element, ctx),
  }, ['+ field…']);
}

/** A character sheet folded out of `[PC:]` tags (D5). */
function pcSheet(pc, ctx) {
  const stats = [...pc.fields].map(([key, v]) => statTile(pc, key, v, ctx));
  stats.push(addTile(pc, ctx));

  return el('article', { class: 'sheet' }, [
    el('h3', { class: 'sheet-name' }, [pc.name]),
    el('div', { class: 'stat-grid' }, stats),
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
      el('button', {
        class: 'btn btn-tiny', type: 'button', 'aria-label': `Add a field to ${m.name}`,
        onclick: () => addDialog(m, ctx),
      }, ['add…']),
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
  const summary = [];
  if (c.count) summary.push(`x${c.count.value}`);
  if (c.value) summary.push(c.value.value);
  if (c.progress) summary.push(`${c.progress.current}/${c.progress.total}`);

  const stats = [...c.fields].map(([key, v]) => statTile(c, key, v, ctx));
  stats.push(addTile(c, ctx));

  return el('li', { class: 'cast-row' }, [
    el('div', { class: 'cast-head' }, [
      el('span', { class: 'el-name' }, [c.name]),
      el('span', { class: 'el-detail' }, [summary.join(' · ')]),
      traceLink(c.lastLine, ctx),
    ]),
    // Stats step here just as they do on the character sheet — an NPC's HP is
    // no less adjustable than a PC's.
    el('div', { class: 'stat-grid' }, stats),
    flagRow(c, ctx, 'Tags'),
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
      'aria-label': `Add a condition or field to ${element.name}`,
      onclick: () => addDialog(element, ctx),
    }, ['+ add…']),
  ]);
}

/**
 * One dialog for everything an element can carry. A value makes it a field, no
 * value makes it a flag — so there is one control to learn rather than two.
 */
async function addDialog(element, ctx) {
  const listId = `keys-${element.type}`;
  const datalist = el('datalist', { id: listId },
    (ctx.knownKeys ?? []).map((key) => el('option', { value: key })));

  const nameInput = /** @type {HTMLInputElement} */ (el('input', {
    class: 'input', type: 'text', id: 'add-name', list: listId, autocomplete: 'off',
    placeholder: 'Stress',
  }));
  const valueInput = /** @type {HTMLInputElement} */ (el('input', {
    class: 'input', type: 'text', id: 'add-value', autocomplete: 'off',
    placeholder: '0, 12/15, d8 — or leave empty',
  }));

  const existing = [
    ...[...element.fields].map(([key, v]) => ({ key, detail: v.value, kind: 'field' })),
    ...[...element.flags.keys()].map((key) => ({ key, detail: null, kind: 'flag' })),
  ];

  const current = existing.length
    ? el('ul', { class: 'plain-list' }, existing.map((item) => el('li', {}, [
      el('span', { class: 'el-name' }, [item.key]),
      el('span', { class: 'el-detail' }, [item.detail ?? item.kind]),
      el('button', {
        class: 'btn btn-tiny btn-quiet', type: 'button',
        'aria-label': `Remove ${item.key} from ${element.name}`,
        onclick: async (e) => {
          e.target.closest('li').remove();
          await ctx.commit([removeLine(element, item.key)]);
        },
      }, ['remove']),
    ])))
    : el('p', { class: 'hint' }, ['Nothing recorded yet.']);

  const ok = await modal({
    title: element.name,
    body: el('div', { class: 'form' }, [
      el('label', { class: 'field-label', for: 'add-name' }, ['Name']), nameInput, datalist,
      el('label', { class: 'field-label', for: 'add-value' }, ['Value']), valueInput,
      el('p', { class: 'hint' }, [
        'A value makes it a stat you can step — 8, 12/15, d8. Leave it empty for a '
        + 'plain tag like “wounded”.',
      ]),
      el('h3', { class: 'addon-sub' }, ['Already here']),
      current,
    ]),
    actions: [{ label: 'Close', value: null }, { label: 'Add', value: true, primary: true }],
  });

  if (ok !== true) return;
  const name = nameInput.value.trim();
  if (!name) return;
  await ctx.commit([addLine(element, name, valueInput.value)]);
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
