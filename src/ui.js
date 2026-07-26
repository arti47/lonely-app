/**
 * Themed UI primitives (CLAUDE.md §2). Native alert/confirm/prompt are not used
 * anywhere in the app; these are the accessible replacements — focus trap,
 * Escape to dismiss, focus restore, sized to the visual viewport.
 */

import { $, el, clear } from './core.js';

let openModal = null;

/**
 * @param {{title:string, body:Node|string, className?:string,
 *   actions?:{label:string,value:any,primary?:boolean}[]}} opts
 *   `className` lets the same accessible primitive present as a bottom sheet
 *   (the roll drawer, §8.2 F6) without a second focus-trap implementation.
 * @returns {Promise<any>} the chosen action's value, or null if dismissed
 */
export function modal({ title, body, actions = [{ label: 'Close', value: null, primary: true }], className = '' }) {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const titleId = 'modal-title';

    const buttons = actions.map((a) => el('button', {
      class: a.primary ? 'btn btn-primary' : 'btn',
      type: 'button',
      onclick: () => done(a.value),
    }, [a.label]));

    const dialog = el('div', {
      class: `modal${className ? ` ${className}` : ''}`,
      role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId,
    }, [
      el('h2', { class: 'modal-title', id: titleId }, [title]),
      el('div', { class: 'modal-body' }, [body]),
      el('div', { class: 'modal-actions' }, buttons),
    ]);
    const backdrop = el('div', { class: 'modal-backdrop' }, [dialog]);

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); done(null); return; }
      if (e.key !== 'Tab') return;
      const focusable = /** @type {HTMLElement[]} */ ([...dialog.querySelectorAll(
        'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')]);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    function done(value) {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      openModal = null;
      if (previous instanceof HTMLElement) previous.focus();
      resolve(value);
    }

    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) done(null); });
    document.addEventListener('keydown', onKey, true);
    document.body.append(backdrop);
    openModal = { done };
    // Focus the action without scrolling to it: a tall dialog — the roll drawer
    // — would otherwise open scrolled past its own contents to the button.
    (buttons.find((b) => b.classList.contains('btn-primary')) ?? buttons[0])?.focus({ preventScroll: true });
  });
}

/** @param {string} message */
export async function confirmModal(message, { title = 'Confirm', confirmLabel = 'Confirm' } = {}) {
  return (await modal({
    title, body: message,
    actions: [
      { label: 'Cancel', value: false },
      { label: confirmLabel, value: true, primary: true },
    ],
  })) === true;
}

/** @param {string} message */
export async function promptModal(message, { title = 'Enter a value', value = '', placeholder = '' } = {}) {
  const input = /** @type {HTMLInputElement} */ (
    el('input', { class: 'input', type: 'text', value, placeholder, 'aria-label': message }));
  const body = el('div', {}, [el('label', { class: 'field-label' }, [message]), input]);
  const result = await modal({
    title, body,
    actions: [{ label: 'Cancel', value: null }, { label: 'OK', value: true, primary: true }],
  });
  return result === true ? input.value : null;
}

let toastTimer = null;

/**
 * @param {string} message
 * @param {{tone?:'info'|'error', duration?:number,
 *   action?:{label:string, onClick:()=>any}}} [opts]
 *   An `action` gives the toast a button. Such a toast waits — pass
 *   `duration: 0` — because a message that offers something and then vanishes
 *   on a timer is worse than no offer at all; it gets a dismiss control instead.
 */
export function showToast(message, { tone = 'info', action = null, duration = 4000 } = {}) {
  const host = $('#toast');
  if (!host) return;
  clear(host);
  host.dataset.tone = tone;

  const dismiss = () => { host.hidden = true; };
  const body = el('div', { class: 'toast-body' }, [
    el('span', { class: 'toast-text' }, [message]),
  ]);

  if (action) {
    body.append(
      el('button', {
        class: 'toast-action', type: 'button',
        onclick: () => { dismiss(); action.onClick(); },
      }, [action.label]),
      el('button', {
        class: 'toast-dismiss', type: 'button', 'aria-label': 'Dismiss',
        onclick: dismiss,
      }, ['×']),
    );
  }

  host.append(body);
  host.hidden = false;
  clearTimeout(toastTimer);
  if (duration > 0) toastTimer = setTimeout(dismiss, duration);
}

/** Screen-reader announcement without a visual toast. */
export function announce(message) {
  const host = $('#live');
  if (host) host.textContent = message;
}

export const THEMES = ['system', 'light', 'dark'];

/** @param {string} theme */
export function applyTheme(theme) {
  const t = THEMES.includes(theme) ? theme : 'system';
  document.documentElement.dataset.theme = t;
  return t;
}

/** Close whatever modal is open, if any (used on route changes). */
export function dismissModal() {
  openModal?.done(null);
}

/**
 * A small “?” that opens a notation reference entry (CLAUDE.md §8 Phase 8 —
 * every automated surface links to its entry).
 * @param {string} entryId
 * @param {{label?:string}} [opts]
 */
export function referenceButton(entryId, opts = {}) {
  return el('button', {
    class: 'ref-btn', type: 'button',
    'aria-label': `What is ${opts.label ?? entryId}?`,
    title: 'Explain this notation',
    onclick: async () => {
      const { entryFor } = await import('./reference.js');
      const entry = entryFor(entryId);
      if (!entry) return;
      await modal({
        title: entry.title,
        body: el('div', {}, [
          el('code', { class: 'ref-syntax' }, [entry.syntax]),
          el('p', {}, [entry.summary]),
          el('pre', { class: 'log-preview' }, [entry.examples.join('\n')]),
          el('p', { class: 'hint' }, [`Spec: ${entry.spec}`]),
        ]),
      });
    },
  }, ['?']);
}
