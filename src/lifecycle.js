/**
 * Scene / session boundary engine (CLAUDE.md §8 Phase 6).
 *
 * The app owns boundary events: ending a session closes whatever blocks are
 * still open and writes a snapshot for every add-on the log has surfaced, in one
 * bundle. A bundle is a plain list of lines, so undo is truncation of exactly
 * that many lines (§5.1) — there is no separate transaction to roll back.
 *
 * Pure: every function here takes folded state and returns lines plus a summary
 * to show before committing. Nothing writes.
 */

import { today } from './core.js';
import { surfaced } from './addons/index.js';
import { nextSceneNumber, nextSessionNumber, sceneLine, sessionLines } from './composer.js';

/**
 * @typedef {{lines:string[], summary:string[], heavy:boolean}} Bundle
 * `heavy` marks a bundle that does more than drop a single marker, and so is
 * worth confirming before it lands.
 */

/** Blocks that should not be left hanging across a boundary. */
function closeOpenBlocks(state) {
  return [...(state.blockStack ?? [])]
    .reverse()
    .map((block) => ({ line: `[/${block.name}]`, name: block.name }));
}

/**
 * End the current scene and open the next (core §5.3).
 *
 * A block opened inside a scene header is closed by the next scene marker on its
 * own (combat §1.1), so only explicitly opened blocks are closed here.
 *
 * @param {object} state
 * @param {{context?:string}} [opts]
 * @returns {Bundle}
 */
export function sceneBundle(state, opts = {}) {
  const lines = [];
  const summary = [];

  for (const block of closeOpenBlocks(state)) {
    if (state.blockStack.find((b) => b.name === block.name)?.implicit) continue;
    lines.push(block.line);
    summary.push(`Close the open ${block.name} block`);
  }

  const next = sceneLine(state, opts.context ?? '');
  lines.push(next);
  summary.push(`Open scene S${nextSceneNumber(state)}`);

  return { lines, summary, heavy: lines.length > 1 };
}

/**
 * Open a session (core §5.2.1).
 * @param {object} state
 * @param {{date?:string}} [opts]
 * @returns {Bundle}
 */
export function sessionStartBundle(state, opts = {}) {
  const date = opts.date ?? today();
  return {
    lines: sessionLines(state, date),
    summary: [`Open Session ${nextSessionNumber(state)}, dated ${date}`],
    heavy: false,
  };
}

/**
 * End a session: close every open block, then snapshot each add-on the log has
 * surfaced — `[RESOURCES]`, `[DUNGEON STATUS]`, `[CAMPAIGN]` (resources §5,
 * dungeon §3, wargaming §4).
 *
 * Combat has no status block in its spec, so none is invented for it (§9.8).
 *
 * @param {object} state
 * @returns {Bundle}
 */
export function sessionEndBundle(state) {
  const lines = [];
  const summary = [];

  for (const block of closeOpenBlocks(state)) {
    lines.push(block.line);
    summary.push(`Close the open ${block.name} block`);
  }

  for (const addon of surfaced(state)) {
    // Combat defines no status block in its spec, so it exposes no snapshot.
    const build = /** @type {{snapshotLines?:(s:object)=>string[]}} */ (addon).snapshotLines;
    if (typeof build !== 'function') continue;
    const snapshot = build(state);
    // A block with nothing between its delimiters is noise, not a record.
    if (snapshot.length <= 2) continue;
    lines.push(...snapshot);
    summary.push(`Snapshot ${addon.title.toLowerCase()} (${snapshot.length - 2} lines)`);
  }

  if (!summary.length) summary.push('Nothing open and nothing to snapshot');

  return { lines, summary, heavy: lines.length > 0 };
}

/**
 * What a bundle would do, as one readable string for the confirmation.
 * @param {Bundle} bundle
 */
export function describe(bundle) {
  return bundle.summary.join(' · ');
}
