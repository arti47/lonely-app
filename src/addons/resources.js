/**
 * Resource Tracking add-on surface (ledger T40–T47).
 *
 * Surfaces on the first `[Inv:]` or `[Wealth:]` tag, or a `[RESOURCES]` block
 * (D6). Usage dice live in `[PC:]` because they are character stats rather than
 * carried things (resources §2).
 */

import { el } from '../core.js';
import { promptModal } from '../ui.js';
import { elementsOfType } from '../lonelog/fold.js';
import { flagLine, tag, field } from '../state.js';
import { pick } from './combat.js';

export const id = 'resources';
export const reference = 'addon-resources';
export const title = 'Resources';
export const types = ['Inv', 'Wealth'];

/** The usage-die step-down chain (resources §2.1, Quick Reference). */
export const USAGE_CHAIN = ['d12', 'd10', 'd8', 'd6', 'd4', 'depleted'];

/* ----------------------------- line builders ----------------------------- */

/** `[Inv:Torch-1]` / `[Inv:Torch+2]` (resources §1.2). */
export function quantityLine(item, delta) {
  const sign = delta < 0 ? '-' : '+';
  return tag(item, [], { kind: 'delta', sign, amount: Math.abs(delta) });
}

/** `[Inv:Oil Flask|depleted]` (resources §1.2). */
export function depletedLine(item) {
  return flagLine(item, 'depleted', 'add');
}

/** `[Wealth:Gold+15]` / `[Wealth:Gold-8]` (resources §3.1). */
export function wealthLine(currency, delta) {
  const sign = delta < 0 ? '-' : '+';
  return tag(currency, [], { kind: 'delta', sign, amount: Math.abs(delta) });
}

/**
 * Step a usage die down its chain: `[PC:Kael|Supply d8->d6]`, and
 * `d4 -> depleted` at the end (resources §2.1).
 * @param {object} pc @param {string} key @param {string} current
 */
export function stepDownLine(pc, key, current) {
  const i = USAGE_CHAIN.indexOf(String(current).toLowerCase());
  const next = i === -1 || i === USAGE_CHAIN.length - 1 ? 'depleted' : USAGE_CHAIN[i + 1];
  return tag(pc, [field({ key, transition: { from: current, to: next } })]);
}

/** Usage-die stats on a PC — `Supply d8`, `Ammo d10` (resources §2.1). */
export function usageDice(pc) {
  return [...pc.fields]
    .filter(([, v]) => /^d(4|6|8|10|12)$/i.test(String(v.value).trim()))
    .map(([key, v]) => ({ key, value: String(v.value).trim(), line: v.line }));
}

/**
 * `[RESOURCES]` snapshot at a session boundary (resources §5). Restates rather
 * than deltas, which is the point of a snapshot.
 * @param {object} state
 * @returns {string[]}
 */
export function snapshotLines(state) {
  const lines = ['[RESOURCES]'];

  for (const pc of elementsOfType(state, 'PC')) {
    const stats = [...pc.fields].map(([k, v]) => field({ key: k, value: v.value }));
    if (stats.length) lines.push(tag(pc, stats));
  }
  for (const w of elementsOfType(state, 'Wealth')) {
    lines.push(tag(w, [], w.value ? { kind: 'value', value: w.value.value } : null));
  }
  for (const item of elementsOfType(state, 'Inv')) {
    if (item.flags.has('depleted')) continue;
    const props = [...item.flags.keys()].map((f) => field({ value: f }));
    lines.push(tag(item, props, item.value ? { kind: 'value', value: item.value.value } : null));
  }

  lines.push('[/RESOURCES]');
  return lines;
}

/* -------------------------------- render --------------------------------- */

export function render(host, state, ctx) {
  const items = elementsOfType(state, 'Inv');
  const wealth = elementsOfType(state, 'Wealth');
  const pcs = elementsOfType(state, 'PC').filter((pc) => usageDice(pc).length);

  host.append(el('div', { class: 'addon-tools' }, [
    el('button', {
      class: 'btn btn-tiny', type: 'button', title: 'Freeze current resources into the log',
      onclick: () => ctx.commit(snapshotLines(state)),
    }, ['Snapshot']),
    el('button', {
      class: 'btn btn-tiny', type: 'button',
      onclick: async () => {
        const name = await promptModal('Item name', { title: 'Add an item', placeholder: 'Torch' });
        if (!name?.trim()) return;
        const qty = await promptModal('How many?', { title: name.trim(), value: '1' });
        await ctx.commit([
          tag({ type: 'Inv', name: name.trim() }, [field({ value: String(qty ?? 1).trim() || '1' })]),
        ]);
      },
    }, ['Add item…']),
  ]));

  if (pcs.length) {
    host.append(el('h3', { class: 'addon-sub' }, ['Usage dice']));
    host.append(el('ul', { class: 'plain-list' }, pcs.flatMap((pc) =>
      usageDice(pc).map((die) => el('li', {}, [
        el('span', { class: 'el-name' }, [`${pc.name} · ${die.key}`]),
        el('span', { class: 'el-detail' }, [die.value]),
        el('div', { class: 'stat-steppers' }, [
          el('button', {
            class: 'btn btn-tiny', type: 'button',
            title: `Step ${die.key} down the usage chain`,
            onclick: () => ctx.commit([stepDownLine(pc, die.key, die.value)]),
          }, ['step down']),
        ]),
        ctx.traceButton(die.line),
      ])))));
  }

  if (wealth.length) {
    host.append(el('h3', { class: 'addon-sub' }, ['Wealth']));
    host.append(el('ul', { class: 'plain-list' }, wealth.map((w) => el('li', {}, [
      el('span', { class: 'el-name' }, [w.name]),
      el('span', { class: 'el-detail' }, [w.value?.value ?? '—']),
      el('div', { class: 'stat-steppers' }, [
        el('button', {
          class: 'btn btn-tiny', type: 'button', 'aria-label': `Spend ${w.name}`,
          onclick: () => amount(ctx, `Spend ${w.name}`, (n) => wealthLine(w, -n)),
        }, ['spend']),
        el('button', {
          class: 'btn btn-tiny', type: 'button', 'aria-label': `Earn ${w.name}`,
          onclick: () => amount(ctx, `Earn ${w.name}`, (n) => wealthLine(w, n)),
        }, ['earn']),
      ]),
      ctx.traceButton(w.value?.line ?? w.lastLine),
    ]))));
  }

  host.append(el('h3', { class: 'addon-sub' }, ['Inventory']));
  if (!items.length) {
    host.append(el('p', { class: 'hint' }, ['Nothing carried yet.']));
    return;
  }

  host.append(el('ul', { class: 'plain-list' }, items.map((item) => {
    const gone = item.flags.has('depleted') || item.value?.value === '0';
    const props = [...item.flags.keys()];
    const detail = [item.value?.value, ...props].filter(Boolean).join(' · ');

    return el('li', { class: gone ? 'is-down' : null }, [
      el('span', { class: 'el-name' }, [item.name]),
      el('span', { class: 'el-detail' }, [detail || '—']),
      el('div', { class: 'stat-steppers' }, gone ? [] : [
        el('button', {
          class: 'btn btn-tiny', type: 'button', 'aria-label': `Use one ${item.name}`,
          onclick: () => ctx.commit([quantityLine(item, -1)]),
        }, ['−1']),
        el('button', {
          class: 'btn btn-tiny', type: 'button', 'aria-label': `Gain one ${item.name}`,
          onclick: () => ctx.commit([quantityLine(item, +1)]),
        }, ['+1']),
        el('button', {
          class: 'btn btn-tiny', type: 'button',
          onclick: () => ctx.commit([depletedLine(item)]),
        }, ['depleted']),
        el('button', {
          class: 'btn btn-tiny', type: 'button',
          onclick: async () => {
            const prop = await pick(`${item.name} is…`, ['broken', 'cracked', 'spoiled', 'repaired', 'identified']);
            if (prop) await ctx.commit([flagLine(item, prop, 'add')]);
          },
        }, ['state…']),
      ]),
      ctx.traceButton(item.lastLine),
    ]);
  })));
}

async function amount(ctx, title, build) {
  const n = await promptModal('How much?', { title, placeholder: '10' });
  if (n && Number.isFinite(Number(n))) await ctx.commit([build(Math.abs(Number(n)))]);
}
