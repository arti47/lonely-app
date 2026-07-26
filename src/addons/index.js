/**
 * Add-on surfaces (CLAUDE.md §8 Phase 5).
 *
 * Each surface declares the tag types it owns and renders a panel. Which ones
 * appear is decided by the fold, never by a setting (D6) — `state.addons` is
 * populated as the relevant tags, markers and blocks are read from the log.
 *
 * Order is the roadmap's build order and the order panels appear in.
 */

import * as combat from './combat.js';
import * as resources from './resources.js';
import * as dungeon from './dungeon.js';
import * as wargaming from './wargaming.js';

export const ADDONS = [combat, resources, dungeon, wargaming];

/** @param {object} state @returns {typeof ADDONS} the surfaces this log has earned */
export function surfaced(state) {
  return ADDONS.filter((a) => state.addons?.has(a.id));
}

/** Every tag type owned by some add-on surface. */
export const OWNED_TYPES = new Set(ADDONS.flatMap((a) => a.types));
