/**
 * Persistence (CLAUDE.md §6). IndexedDB only — no backend, no network.
 *
 * `log` is the sole authoritative field on a campaign. `checkpoints` are a
 * derivable cache and `view` is presentation state; neither may ever change what
 * a fold produces (§5.1, D6).
 */

import { SCHEMA_VERSION, nextId, today } from './core.js';

const DB_NAME = 'lonely';
const DB_VERSION = 1;
const STORES = { campaigns: 'campaigns', templates: 'templates', tables: 'tables', settings: 'settings' };

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.campaigns)) db.createObjectStore(STORES.campaigns, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.templates)) db.createObjectStore(STORES.templates, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.tables)) db.createObjectStore(STORES.tables, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.settings)) db.createObjectStore(STORES.settings, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

/**
 * Back-fill defaults so an older record never crashes a newer build
 * (CLAUDE.md §6).
 * @param {object} c
 */
export function normalizeCampaign(c) {
  return {
    id: c.id ?? nextId('campaign'),
    schema: SCHEMA_VERSION,
    meta: {
      title: 'Untitled campaign',
      ruleset: '', genre: '', player: '', tone: '',
      createdAt: today(), updatedAt: today(),
      ...(c.meta ?? {}),
    },
    log: Array.isArray(c.log) ? c.log : [],
    bindings: { path: null, lastSavedHash: null, handle: null, ...(c.bindings ?? {}) },
    view: { hiddenPanels: [], composerMode: 'symbols', ...(c.view ?? {}) },
  };
}

export const campaigns = {
  async all() {
    const rows = await tx(STORES.campaigns, 'readonly', (s) => s.getAll());
    return (rows ?? []).map(normalizeCampaign)
      .sort((a, b) => String(b.meta.updatedAt).localeCompare(String(a.meta.updatedAt)));
  },
  async get(id) {
    const row = await tx(STORES.campaigns, 'readonly', (s) => s.get(id));
    return row ? normalizeCampaign(row) : null;
  },
  async put(campaign) {
    const c = normalizeCampaign(campaign);
    c.meta.updatedAt = today();
    await tx(STORES.campaigns, 'readwrite', (s) => s.put(c));
    return c;
  },
  async create(title) {
    return campaigns.put(normalizeCampaign({ meta: { title: title || 'Untitled campaign' } }));
  },
  async remove(id) {
    await tx(STORES.campaigns, 'readwrite', (s) => s.delete(id));
  },
};

export const settings = {
  async get(key, fallback = null) {
    const row = await tx(STORES.settings, 'readonly', (s) => s.get(key));
    return row ? row.value : fallback;
  },
  async set(key, value) {
    await tx(STORES.settings, 'readwrite', (s) => s.put({ key, value }));
    return value;
  },
};

/**
 * The campaign as Lonelog markdown — the artifact the user owns (CLAUDE.md §1).
 * @param {object} campaign
 */
export function toMarkdown(campaign) {
  const c = normalizeCampaign(campaign);
  const front = ['title', 'ruleset', 'genre', 'player', 'tone']
    .filter((k) => c.meta[k])
    .map((k) => `${k}: ${c.meta[k]}`);
  const head = front.length
    ? ['---', ...front, `start_date: ${c.meta.createdAt}`, `last_update: ${c.meta.updatedAt}`, '---', '']
    : [];
  return [...head, ...c.log].join('\n') + '\n';
}

/**
 * Import markdown as a campaign log. Every line is kept verbatim, including
 * lines this app does not understand (CLAUDE.md §5.2).
 * @param {string} text
 * @param {string} [title]
 */
export function fromMarkdown(text, title) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();

  const meta = {};
  let body = lines;
  if (lines[0]?.trim() === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) {
      for (const line of lines.slice(1, end)) {
        const m = /^\s*([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
        if (m) meta[m[1]] = m[2].trim();
      }
      body = lines.slice(end + 1);
      while (body[0] === '') body.shift();
    }
  }

  return normalizeCampaign({
    meta: {
      title: title || meta.title || 'Imported campaign',
      ruleset: meta.ruleset ?? '', genre: meta.genre ?? '',
      player: meta.player ?? '', tone: meta.tone ?? '',
      createdAt: meta.start_date || today(),
    },
    log: body,
  });
}

/** Full backup of everything the app holds (CLAUDE.md §1 mandatory scope). */
export async function exportBackup() {
  return {
    app: 'lonely-app',
    schema: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    campaigns: await campaigns.all(),
    templates: (await tx(STORES.templates, 'readonly', (s) => s.getAll())) ?? [],
    tables: (await tx(STORES.tables, 'readonly', (s) => s.getAll())) ?? [],
  };
}

/**
 * Bind a campaign to a real `.md` file on disk (CLAUDE.md §2). Where the File
 * System Access API is missing the app falls back to download/upload, so this is
 * an enhancement and never a requirement.
 */
export const fileBinding = {
  supported() {
    return typeof globalThis.showSaveFilePicker === 'function';
  },

  /** @param {object} campaign */
  async bind(campaign) {
    if (!fileBinding.supported()) throw new Error('This browser cannot bind to a file.');
    const handle = await globalThis.showSaveFilePicker({
      suggestedName: `${campaign.meta.title || 'campaign'}.md`,
      types: [{ description: 'Lonelog markdown', accept: { 'text/markdown': ['.md'] } }],
    });
    campaign.bindings = { ...campaign.bindings, handle, path: handle.name };
    await campaigns.put(campaign);
    await fileBinding.write(campaign);
    return handle.name;
  },

  /** @param {object} campaign @returns {Promise<boolean>} whether a write happened */
  async write(campaign) {
    const handle = campaign.bindings?.handle;
    if (!handle) return false;
    const mode = { mode: 'readwrite' };
    let granted = await handle.queryPermission?.(mode);
    if (granted !== 'granted') granted = await handle.requestPermission?.(mode);
    if (granted !== 'granted') return false;
    const writable = await handle.createWritable();
    await writable.write(toMarkdown(campaign));
    await writable.close();
    return true;
  },

  /** @param {object} campaign */
  async unbind(campaign) {
    campaign.bindings = { path: null, lastSavedHash: null };
    await campaigns.put(campaign);
  },
};

/** @param {object} backup */
export async function importBackup(backup) {
  if (!backup || backup.app !== 'lonely-app') throw new Error('Not a Lonely backup file.');
  let imported = 0;
  for (const c of backup.campaigns ?? []) { await campaigns.put(c); imported++; }
  for (const t of backup.templates ?? []) await tx(STORES.templates, 'readwrite', (s) => s.put(t));
  for (const t of backup.tables ?? []) await tx(STORES.tables, 'readwrite', (s) => s.put(t));
  return imported;
}
