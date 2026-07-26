/** Entry point (CLAUDE.md §3.1). */

import { register, start, go, parseHash, rememberCampaign, currentCampaign } from './router.js';
import {
  campaignsScreen, logScreen, stateScreen, resolveScreen, referenceScreen, settingsScreen,
} from './screens.js';
import * as settings from './settings.js';
import { showToast } from './ui.js';
import { $$ } from './core.js';
import { campaigns } from './store.js';
import { landingRoute } from './onboarding.js';
import { watchForUpdates } from './update.js';

/** Storage may be blocked; a landing decision must not stop the app booting. */
async function countCampaigns() {
  try { return (await campaigns.all()).length; } catch { return 0; }
}

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

  // A first-ever launch opens the guide rather than an empty list (F9). An
  // explicit hash is a deep link and always wins.
  const landing = landingRoute({
    seenGuide: !!settings.get('seenGuide'),
    campaignCount: await countCampaigns(),
    hasHash: !!location.hash,
  });
  if (landing === 'reference') await settings.set('seenGuide', true);
  if (landing) location.hash = `#/${landing}`;
  await start();
  document.body.dataset.booted = 'true';

  // After the app is usable: a new deploy is offered as a button, never taken
  // in the middle of a session (§2).
  watchForUpdates();
}

boot();
