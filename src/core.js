/**
 * Foundational constants and DOM helpers. Imports nothing (CLAUDE.md §3.1).
 *
 * No RNG lives here or anywhere in src/ — the user rolls the dice (§1.1 D2).
 */

export const APP_NAME = 'Lonely';
export const SCHEMA_VERSION = 1;

/** @param {string} sel @param {ParentNode} [scope] @returns {HTMLElement|null} */
export const $ = (sel, scope = document) => /** @type {HTMLElement|null} */ (scope.querySelector(sel));
/** @param {string} sel @param {ParentNode} [scope] @returns {HTMLElement[]} */
export const $$ = (sel, scope = document) =>
  /** @type {HTMLElement[]} */ ([...scope.querySelectorAll(sel)]);

/**
 * Create an element. Children may be nodes or strings; strings are inserted as
 * text, never parsed as HTML.
 * @param {string} tag
 * @param {Record<string, any>} [attrs]
 * @param {(Node|string)[]} [children]
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/** Remove all children. */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Stable, collision-resistant id with no RNG: time + a monotonic counter. */
let seq = 0;
export function nextId(prefix = 'id') {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`;
}

/** @param {string} s */
export function slug(s) {
  return String(s).toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'untitled';
}

/** Debounce trailing-edge. */
export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Format an ISO date as YYYY-MM-DD. */
export function today(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
