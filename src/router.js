/**
 * Hash routing and bottom-nav state (CLAUDE.md §3.1).
 *
 * Routes are registered by main.js; gated tabs are hidden here rather than by
 * the screens themselves.
 */

import { $, $$, clear } from './core.js';
import { dismissModal } from './ui.js';

/** @type {Map<string, {title:string, render:(mount:HTMLElement, params:object)=>any, nav?:boolean}>} */
const routes = new Map();
let current = null;

export function register(name, route) {
  routes.set(name, route);
}

export function parseHash(hash = location.hash) {
  const raw = hash.replace(/^#\/?/, '');
  const [name, ...rest] = raw.split('/');
  return { name: name || 'campaigns', params: { id: rest[0] ?? null } };
}

export function go(name, params = {}) {
  const suffix = params.id ? `/${params.id}` : '';
  location.hash = `#/${name}${suffix}`;
}

export async function render() {
  dismissModal();
  const { name, params } = parseHash();
  const route = routes.get(name) ?? routes.get('campaigns');
  const mount = $('#screen');
  if (!mount || !route) return;

  current = name;
  mount.dataset.screen = name;
  clear(mount);
  document.title = route.title ? `${route.title} · Lonely` : 'Lonely';

  for (const link of $$('[data-nav]')) {
    const active = link.dataset.nav === name;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  await route.render(mount, params);
  mount.focus({ preventScroll: true });
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
