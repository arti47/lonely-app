/**
 * Feature flags and preferences (CLAUDE.md §7).
 *
 * Add-on panels are deliberately NOT flags here — they surface from log content
 * (D6). What lives here is the user's explicit choices, stored true/false
 * distinctly from unset so a choice always beats an inferred default.
 */

import { settings as store } from './store.js';
import { applyTheme, THEMES } from './ui.js';

const DEFAULTS = {
  theme: 'system',
  lintLevel: 'warn',      // 'off' | 'warn' | 'all'
  referenceLinks: true,   // link automated surfaces to the notation reference
};

const cache = new Map();

export async function load() {
  for (const key of Object.keys(DEFAULTS)) {
    const stored = await store.get(key, undefined);
    cache.set(key, stored === undefined || stored === null ? DEFAULTS[key] : stored);
  }
  applyTheme(get('theme'));
  return all();
}

/** @param {string} key */
export function get(key) {
  return cache.has(key) ? cache.get(key) : DEFAULTS[key];
}

/** @param {string} key @param {any} value */
export async function set(key, value) {
  cache.set(key, value);
  await store.set(key, value);
  if (key === 'theme') applyTheme(value);
  return value;
}

export function all() {
  return Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, get(k)]));
}

export { THEMES };
