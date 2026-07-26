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

export function go(name, params = {}) {
  let suffix = params.id ? `/${params.id}` : '';
  if (params.id && params.line != null) suffix += `/${params.line}`;
  location.hash = `#/${name}${suffix}`;
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
    return;
  }

  current = name;
  mount.dataset.screen = name;
  clear(mount);
  document.title = route.title ? `${route.title} · Lonely` : 'Lonely';

  markNav(name);

  await route.render(mount, params);
  mount.focus({ preventScroll: true });
}

function markNav(name) {
  for (const link of $$('[data-nav]')) {
    const active = link.dataset.nav === name;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
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
