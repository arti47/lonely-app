/**
 * Dungeon Crawling add-on surface (ledger T35–T39).
 *
 * Surfaces on the first `[R:]` tag or `[DUNGEON STATUS]` block (D6).
 *
 * Room tags track *state*, not space — the add-on is explicit that a map handles
 * layout better than text (dungeon, Design Principles), so this panel shows
 * status and exits and never tries to draw a map.
 */

import { el } from '../core.js';
import { promptModal } from '../ui.js';
import { elementsOfType } from '../lonelog/fold.js';
import { flagLine, tag, field } from '../state.js';
import { pick } from './combat.js';

export const id = 'dungeon';
export const reference = 'addon-dungeon';
export const title = 'Dungeon';
export const types = ['R'];

/** Status vocabulary (dungeon §1.1). Combinable — `cleared, looted`. */
export const ROOM_STATUS = [
  'unexplored', 'active', 'cleared', 'looted', 'locked', 'trapped', 'safe', 'collapsed',
];

/* ----------------------------- line builders ----------------------------- */

/** `[R:4|active|storage room|exits S:R2, E:R5]` (dungeon §1). */
export function roomLine(idText, status, description, exits) {
  const fields = [];
  if (status) fields.push(field({ value: String(status).trim() }));
  if (description?.trim()) fields.push(field({ value: description.trim() }));
  if (exits?.trim()) fields.push(field({ key: 'exits', value: exits.trim() }));
  return tag({ type: 'R', name: String(idText).trim() }, fields);
}

/** `[R:1|+looted]` — inline status add (dungeon §1.2). */
export function statusLine(room, status) {
  return flagLine(room, status, 'add');
}

/** `[R:1|-locked]` — a status that no longer holds. */
export function clearStatusLine(room, status) {
  return flagLine(room, status, 'remove');
}

/** `[R:3|exits E:R7(secret)]` — a connection discovered mid-play (dungeon §2). */
export function exitLine(room, exits) {
  return tag(room, [field({ key: 'exits', value: String(exits).trim() })]);
}

/**
 * `[DUNGEON STATUS]` block (dungeon §3) — a fresh snapshot each session rather
 * than a patch of the old one.
 * @param {object} state
 * @returns {string[]}
 */
export function snapshotLines(state) {
  const rooms = elementsOfType(state, 'R');
  return [
    '[DUNGEON STATUS]',
    ...rooms.map((room) => {
      const status = [...room.flags.keys()];
      const exits = room.fields.get('exits');
      const fields = [
        ...status.map((s) => field({ value: s })),
        ...(exits ? [field({ key: 'exits', value: exits.value })] : []),
      ];
      return tag(room, fields);
    }),
    '[/DUNGEON STATUS]',
  ];
}

/* -------------------------------- render --------------------------------- */

export function render(host, state, ctx) {
  const rooms = elementsOfType(state, 'R');

  host.append(el('div', { class: 'addon-tools' }, [
    el('button', {
      class: 'btn btn-tiny', type: 'button',
      onclick: async () => {
        const roomId = await promptModal('Room ID (matches your map)', {
          title: 'New room', placeholder: String(rooms.length + 1),
        });
        if (!roomId?.trim()) return;
        const description = await promptModal('Brief description', {
          title: `Room ${roomId.trim()}`, placeholder: 'storage room, dusty shelves',
        });
        await ctx.commit([roomLine(roomId, 'active', description ?? '', '')]);
      },
    }, ['New room…']),
    rooms.length ? el('button', {
      class: 'btn btn-tiny', type: 'button', title: 'Write a fresh status block',
      onclick: () => ctx.commit(snapshotLines(state)),
    }, ['Status block']) : null,
  ]));

  if (!rooms.length) {
    host.append(el('p', { class: 'hint' }, [
      'No rooms tracked. Write [R:1|active|entry cave] and they appear here. '
      + 'Keep the map on paper — these tags track state, not layout.',
    ]));
    return;
  }

  host.append(el('ul', { class: 'plain-list' }, rooms.map((room) => {
    const status = [...room.flags.keys()];
    const exits = room.fields.get('exits')?.value;
    const gone = room.flags.has('collapsed');

    return el('li', { class: gone ? 'is-down' : null }, [
      el('span', { class: 'el-name' }, [`R${room.name}`]),
      el('span', { class: 'el-detail' }, [
        [status.join(', ') || 'unexplored', exits ? `exits ${exits}` : null].filter(Boolean).join(' · '),
      ]),
      el('div', { class: 'stat-steppers' }, [
        el('button', {
          class: 'btn btn-tiny', type: 'button',
          onclick: async () => {
            const next = await pick(`Room ${room.name} is…`, ROOM_STATUS.filter((s) => !room.flags.has(s)));
            if (next) await ctx.commit([statusLine(room, next)]);
          },
        }, ['+ status']),
        status.length ? el('button', {
          class: 'btn btn-tiny', type: 'button',
          onclick: async () => {
            const drop = await pick('No longer true', status);
            if (drop) await ctx.commit([clearStatusLine(room, drop)]);
          },
        }, ['− status']) : null,
        el('button', {
          class: 'btn btn-tiny', type: 'button',
          onclick: async () => {
            const value = await promptModal('Exits, e.g. N:R2, E:R5(secret)', {
              title: `Room ${room.name} exits`, value: exits ?? '',
            });
            if (value?.trim()) await ctx.commit([exitLine(room, value)]);
          },
        }, ['exits…']),
      ].filter(Boolean)),
      ctx.traceButton(room.lastLine),
    ]);
  })));
}
