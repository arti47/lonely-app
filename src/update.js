/**
 * Service-worker update detection and the update prompt (CLAUDE.md §2).
 *
 * The app ships as static files; a deploy replaces them, but a page that is
 * already open — and an installed PWA, which may never navigate again — goes on
 * running the code it started with. This module notices a new worker, offers a
 * button, and applies it only when the user says so: a reload that arrives
 * unasked in the middle of a session costs the line you were typing.
 *
 * No network code lives here (§2). `registration.update()` asks the browser's
 * service-worker machinery to re-check the worker script; the fetching is the
 * worker's, which is the only network-aware file in the project.
 */

import { showToast } from './ui.js';

/** How often a long-running page asks whether it is still current. */
export const UPDATE_INTERVAL = 30 * 60 * 1000;

/** @type {ServiceWorkerRegistration|null} */
let registration = null;
/** Set only while *this* page is applying an update, so it may reload itself. */
let applying = false;
/** Whether a worker was already in control when this page loaded. */
let hadController = false;

export function isSupported() {
  return 'serviceWorker' in navigator && location.protocol !== 'file:';
}


/**
 * Register the worker and watch for new ones.
 * @returns {Promise<ServiceWorkerRegistration|null>}
 */
export async function watchForUpdates() {
  if (!isSupported()) return null;

  hadController = !!navigator.serviceWorker.controller;

  try {
    registration = await navigator.serviceWorker.register('service-worker.js');
  } catch {
    // Offline install is best-effort; the app works without a worker.
    return null;
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (applying) {
      applying = false;
      location.reload();
      return;
    }
    // Another tab took the update. This page is now running old modules against
    // a new worker, which is exactly the mismatch that made a stale build look
    // like a working one (audit A5).
    if (hadController) promptReload();
  });

  // A worker installed on a previous visit and still waiting.
  if (registration.waiting && navigator.serviceWorker.controller) promptUpdate();

  registration.addEventListener('updatefound', () => {
    const installing = registration?.installing;
    installing?.addEventListener('statechange', () => {
      if (installing.state === 'installed' && navigator.serviceWorker.controller) promptUpdate();
    });
  });

  // Nothing else would ever ask: an installed PWA can run for days without a
  // navigation, which is the only time the browser re-checks on its own.
  setInterval(() => { checkNow().catch(() => {}); }, UPDATE_INTERVAL);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkNow().catch(() => {});
  });

  return registration;
}

/**
 * Ask now whether there is a new version.
 * @returns {Promise<'ready'|'current'|'unsupported'>}
 */
export async function checkNow() {
  if (!registration) return 'unsupported';
  await registration.update();
  return registration.waiting ? 'ready' : 'current';
}

/**
 * Tell the waiting worker to take over. The page reloads when it does, via the
 * `controllerchange` handler above.
 * @returns {boolean} whether there was anything to apply
 */
export function applyUpdate() {
  const waiting = registration?.waiting;
  if (!waiting) return false;
  applying = true;
  waiting.postMessage({ type: 'SKIP_WAITING' });
  return true;
}

/** Offer the update as a button. */
export function promptUpdate() {
  showToast('A new version is ready.', {
    duration: 0,
    action: {
      label: 'Update',
      // If the waiting worker has gone by the time it is tapped, a plain reload
      // gets the same result rather than doing nothing.
      onClick: () => { if (!applyUpdate()) location.reload(); },
    },
  });
}

/** Offer a reload when another tab has already updated. */
export function promptReload() {
  showToast('Updated in another tab.', {
    duration: 0,
    action: { label: 'Reload', onClick: () => location.reload() },
  });
}
