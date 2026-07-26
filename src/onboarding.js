/**
 * First-run surfaces (CLAUDE.md §8.2 F7–F9, D11).
 *
 * Three things live here: the getting-started checklist that ticks itself off by
 * reading the fold, the sample campaign, and the decision about where a
 * first-ever launch lands.
 *
 * Nothing here writes to the log except `createSample`, which writes a whole
 * campaign the user asked for. The checklist reads state and never changes it —
 * its dismissal is `view` state and must never reach a fold (D6).
 */

import { el, clear } from './core.js';

/* ------------------------------- checklist -------------------------------- */

/** Line kinds that count as "wrote a line of notation". */
const WRITTEN_KINDS = new Set(['action', 'question', 'dice', 'resolution', 'consequence', 'tbl', 'gen']);

/**
 * @typedef {{id:string, label:string, hint:string,
 *   done:(state:object, entries:object[])=>boolean}} Task
 */

/** @type {Task[]} */
export const TASKS = [
  {
    id: 'session',
    label: 'Start a session',
    hint: 'Session… → Start session',
    done: (state) => (state.sessions ?? []).length > 0,
  },
  {
    id: 'line',
    label: 'Write a line',
    hint: 'Tap @ Did, type, press Enter',
    done: (_state, entries) => entries.some((e) => WRITTEN_KINDS.has(e.kind)),
  },
  {
    id: 'tag',
    label: 'Name someone or somewhere',
    hint: 'Tap Tag…',
    done: (state) => (state.elements?.size ?? 0) > 0,
  },
  {
    id: 'roll',
    label: 'Record a roll',
    hint: 'Tap 🎲 Roll',
    done: (state) => (state.counts?.rolls ?? 0) > 0,
  },
];

/**
 * Which tasks are done, and whether the whole list is.
 * @param {object} state folded CampaignState
 * @param {object[]} entries lexed entries
 */
export function progress(state, entries = []) {
  const items = TASKS.map((task) => ({ ...task, complete: !!task.done(state, entries) }));
  return { items, complete: items.every((i) => i.complete) };
}

/**
 * Whether to show the checklist at all.
 * @param {object} state @param {object[]} entries @param {string} [setting] view.checklist
 */
export function shouldShowChecklist(state, entries, setting = 'auto') {
  if (setting === 'hidden') return false;
  return !progress(state, entries).complete;
}

/**
 * Render the checklist above the composer (F7).
 * @param {HTMLElement} host
 * @param {object} state
 * @param {object[]} entries
 * @param {{onHide:()=>any}} ctx
 */
export function renderChecklist(host, state, entries, ctx) {
  clear(host);
  const { items } = progress(state, entries);
  const doneCount = items.filter((i) => i.complete).length;

  host.append(el('div', { class: 'checklist', role: 'group', 'aria-label': 'Getting started' }, [
    el('div', { class: 'checklist-head' }, [
      el('span', { class: 'checklist-title' }, [`Getting started · ${doneCount} of ${items.length}`]),
      el('button', {
        class: 'btn btn-tiny btn-quiet', type: 'button',
        onclick: () => ctx.onHide(),
      }, ['Hide']),
    ]),
    el('ul', { class: 'checklist-items' }, items.map((item) => el('li', {
      class: item.complete ? 'is-done' : null,
    }, [
      el('span', { class: 'checklist-mark', 'aria-hidden': 'true' }, [item.complete ? '✓' : '○']),
      el('span', { class: 'checklist-label' }, [item.label]),
      item.complete ? null : el('span', { class: 'checklist-hint' }, [item.hint]),
    ]))),
  ]));
}

/* ----------------------------- sample campaign ---------------------------- */

export const SAMPLE_TITLE = 'Example — The Clearview Ledger';

/**
 * A short, finished-looking log (F8).
 *
 * System-agnostic and free of any publisher's content (D3, §9.8): the rolls name
 * no ruleset, and the oracle line is the app's own d100 house aid. It exists to
 * show what a played log looks like and to make the add-on panels appear on the
 * Sheet without the reader having to write anything first (D6).
 */
export const SAMPLE_LOG = [
  '## Session 1',
  '*Date: 2026-07-26 | Duration: 1h*',
  '',
  'S1 *Rain on the harbour road, past midnight*',
  '[PC:Alex|HP 8|Grit 3]',
  '[L:Clearview Harbour|fogbound|deserted]',
  '[Thread:Who took the harbour ledger|Open]',
  '@ Follow the lamplighter’s tracks toward the pier',
  '? Is anyone still awake in the customs house',
  'd: d100=22 vs 50 -> Yes, but...',
  '=> One lit window, and a shape crossing it. [N:Watchman|awake|wary]',
  '[Clock:Suspicion 1/6]',
  '',
  'S2 *The customs house door*',
  '[Inv:Lantern|1]',
  '[Inv:Pry bar|1|borrowed]',
  '@ Work the latch with the pry bar',
  'd: Stealth d6=5 vs TN 4 -> Success',
  '=> It gives without a sound.',
  'tbl: Harbour rumour [Smugglers, A missing clerk, The tide man]',
  'tbl: Harbour rumour d3=2 -> A missing clerk',
  '',
  'S3 *Inside, the ledger room*',
  '[COMBAT]',
  '[F:Bruiser|HP 5|Close|armed]',
  'Rd1',
  '@ Rush him before he can shout',
  'd: 2d6=9 vs TN 7 -> Success',
  '=> [F:Bruiser|HP-3]',
  'Rd2',
  '@ Put the lantern out and hold still',
  '=> He blunders past into the rain. [F:Bruiser|fled]',
  '[/COMBAT]',
  '=> The ledger is gone. Someone was here first. [Clock:Suspicion 2/6]',
  '(note: this is the example campaign — delete it whenever you like)',
];

/**
 * Create the sample as an ordinary, deletable campaign.
 * @param {{create:(title:string)=>Promise<any>, put:(c:object)=>Promise<any>}} store
 */
export async function createSample(store) {
  const campaign = await store.create(SAMPLE_TITLE);
  campaign.log = [...SAMPLE_LOG];
  return store.put(campaign);
}

/* ------------------------------ where to land ----------------------------- */

/**
 * Where a launch should land (F9). A first-ever launch opens the guide rather
 * than an empty list; once a campaign has existed, the list is the right home.
 *
 * Pure so the rule is testable without a browser.
 *
 * @param {{seenGuide?:boolean, campaignCount?:number, hasHash?:boolean}} ctx
 * @returns {string|null} route to land on, or null to leave the hash alone
 */
export function landingRoute({ seenGuide = false, campaignCount = 0, hasHash = false } = {}) {
  // An explicit hash is a deep link — someone meant to go there.
  if (hasHash) return null;
  if (seenGuide || campaignCount > 0) return 'campaigns';
  return 'reference';
}
