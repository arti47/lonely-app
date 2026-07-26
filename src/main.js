/** Entry point (CLAUDE.md §3.1). */

import { register, start, go, parseHash, rememberCampaign, currentCampaign } from './router.js';
import {
  campaignsScreen, logScreen, stateScreen, resolveScreen, referenceScreen, settingsScreen,
} from './screens.js';
import * as settings from './settings.js';
import { showToast } from './ui.js';
import { $$ } from './core.js';

register('campaigns', { title: 'Campaigns', render: campaignsScreen });
register('log', { title: 'Play', render: logScreen });
register('state', { title: 'Sheet', render: stateScreen });
register('resolve', { title: 'Roll', render: resolveScreen });
register('reference', { title: 'Help', render: referenceScreen });
register('settings', { title: 'Settings', render: settingsScreen });

// Nav links carry the open campaign across tabs — the one in the URL if there
// is one, otherwise the last one opened, so Play still leads back to the game
// you were playing after a detour through the campaign list (D10).
for (const link of $$('[data-nav]')) {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const { params } = parseHash();
    if (link.dataset.keepId === 'false') { go(link.dataset.nav, {}); return; }
    go(link.dataset.nav, { id: params.id ?? currentCampaign() });
  });
}

async function boot() {
  try {
    await settings.load();
  } catch {
    // A blocked or unavailable IndexedDB must not stop the app rendering.
    showToast('Preferences could not be loaded; using defaults.', { tone: 'error' });
  }
  rememberCampaign(settings.get('lastCampaign'));
  if (!location.hash) location.hash = '#/campaigns';
  await start();
  document.body.dataset.booted = 'true';
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    const hadController = !!navigator.serviceWorker.controller;

    // A worker that takes over after the page loaded means the running modules
    // are the old ones — the page must be reloaded, or a newly added screen
    // simply will not exist in the code that is running.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) showToast('Updated — reload to finish.');
    });

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
