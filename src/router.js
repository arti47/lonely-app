/**
 * Hash routing and bottom-nav state (CLAUDE.md §3.1).
 *
 * Routes are registered by main.js; gated tabs are hidden here rather than by
 * the screens themselves.
 */

import { $, $$, el, clear } from './core.js';
import { dismissModal } from './ui.js';

/** @type {Map<string, {title:string, render:(mount:HTMLElement, params:object)=>any, nav?:boolean}>} */
const routes = new Map();
let current = null;

/**
 * Routes with no tab of their own, and the tab that owns them (D10). Rolling is
 * part of playing and Settings is part of managing campaigns, so those routes
 * light their parent tab rather than leaving the nav with nothing marked.
 */
const TAB_FOR = new Map([['resolve', 'log'], ['settings', 'campaigns']]);

/** Tabs that need a campaign to point at (§7). */
const GATED = new Set(['log', 'state']);

/**
 * The campaign the gated tabs point at. Remembered so stepping back to the
 * campaign list does not strand you with the tabs gone — you came from
 * somewhere, and Play should still take you back there.
 */
let lastCampaign = null;

/** @param {string|null} id */
export function rememberCampaign(id) {
  lastCampaign = id || null;
}

/** @param {string|null} id forget only this campaign, e.g. when it is deleted */
export function forgetCampaign(id) {
  if (!id || lastCampaign === id) lastCampaign = null;
}

export function currentCampaign() {
  return lastCampaign;
}

export function register(name, route) {
  routes.set(name, route);
}

export function parseHash(hash = location.hash) {
  const raw = hash.replace(/^#\/?/, '');
  const [name, ...rest] = raw.split('/');
  const line = rest[1] != null && rest[1] !== '' ? Number(rest[1]) : null;
  return {
    name: name || 'campaigns',
    params: { id: rest[0] ?? null, line: Number.isFinite(line) ? line : null },
  };
}

/** The hash a `go()` with these arguments would produce. */
export function hashFor(name, params = {}) {
  let suffix = params.id ? `/${params.id}` : '';
  if (params.id && params.line != null) suffix += `/${params.line}`;
  return `#/${name}${suffix}`;
}

/**
 * Navigate, or re-render if we are already there.
 *
 * Setting `location.hash` to its current value fires no `hashchange`, so a
 * screen that acted on its own data and then sent you "back" to itself — delete
 * a campaign from the campaign list — left the stale render on screen until you
 * visited another tab and came back.
 */
export function go(name, params = {}) {
  const next = hashFor(name, params);
  if (location.hash === next) { render(); return; }
  location.hash = next;
}

export async function render() {
  dismissModal();
  const { name, params } = parseHash();
  const route = routes.get(name);
  const mount = $('#screen');
  if (!mount) return;

  // Falling back to another screen here would make an unknown route look like a
  // working one — which is exactly what a stale cached build did after a new tab
  // was added. Say it plainly instead.
  if (!route) {
    current = name;
    mount.dataset.screen = 'unknown';
    clear(mount);
    document.title = 'Not found · Lonely';
    mount.append(unknownScreen(name));
    mount.focus({ preventScroll: true });
    markNav(null);
    gateNav(null);
    return;
  }

  current = name;
  mount.dataset.screen = name;
  clear(mount);
  document.title = route.title ? `${route.title} · Lonely` : 'Lonely';

  if (params.id) rememberCampaign(params.id);
  markNav(name);
  gateNav(name);

  await route.render(mount, params);
  mount.focus({ preventScroll: true });
}

function markNav(name) {
  const tab = name == null ? null : TAB_FOR.get(name) ?? name;
  for (const link of $$('[data-nav]')) {
    const active = link.dataset.nav === tab;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

/**
 * Hide the tabs that have nowhere to go (§7, D10). The active tab is never
 * hidden — a tab marked current that is not on screen is worse than a tab with
 * a dead end behind it.
 * @param {string|null} name the route being rendered
 */
function gateNav(name) {
  const tab = name == null ? null : TAB_FOR.get(name) ?? name;
  for (const gated of GATED) {
    setNavVisible(gated, !!lastCampaign || gated === tab);
  }
}

/** @param {string} name */
function unknownScreen(name) {
  const wrap = el('div', {}, [
    el('header', { class: 'screen-head' }, [el('h1', {}, ['Screen not found'])]),
    el('p', { class: 'empty' }, [
      `This build has no “${name}” screen. If the app was open while it updated, `
      + 'reloading should fix it.',
    ]),
    el('div', { class: 'row' }, [
      el('button', {
        class: 'btn btn-primary', type: 'button',
        onclick: () => location.reload(),
      }, ['Reload']),
      el('button', {
        class: 'btn', type: 'button',
        onclick: () => go('campaigns'),
      }, ['Back to campaigns']),
    ]),
  ]);
  return wrap;
}

/** Show or hide a nav tab (CLAUDE.md §7). */
export function setNavVisible(name, visible) {
  const link = $(`[data-nav="${name}"]`);
  if (link) link.hidden = !visible;
}

export function currentRoute() {
  return current;
}

export function start() {
  window.addEventListener('hashchange', render);
  return render();
}
