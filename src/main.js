/** Entry point (CLAUDE.md §3.1). */

import { register, start, go, parseHash } from './router.js';
import {
  campaignsScreen, logScreen, stateScreen, resolveScreen, referenceScreen, settingsScreen,
} from './screens.js';
import * as settings from './settings.js';
import { showToast } from './ui.js';
import { $$ } from './core.js';

register('campaigns', { title: 'Campaigns', render: campaignsScreen });
register('log', { title: 'Log', render: logScreen });
register('state', { title: 'State', render: stateScreen });
register('resolve', { title: 'Resolve', render: resolveScreen });
register('reference', { title: 'Notation', render: referenceScreen });
register('settings', { title: 'Settings', render: settingsScreen });

// Nav links carry the open campaign id across tabs.
for (const link of $$('[data-nav]')) {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const { params } = parseHash();
    go(link.dataset.nav, link.dataset.keepId === 'false' ? {} : params);
  });
}

async function boot() {
  try {
    await settings.load();
  } catch {
    // A blocked or unavailable IndexedDB must not stop the app rendering.
    showToast('Preferences could not be loaded; using defaults.', { tone: 'error' });
  }
  if (!location.hash) location.hash = '#/campaigns';
  await start();
  document.body.dataset.booted = 'true';
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw?.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            showToast('Update available — reload to get it.');
          }
        });
      });
    }).catch(() => { /* offline install is best-effort */ });
  });
}

boot();
