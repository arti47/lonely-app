/**
 * Phase 0 screen renderers (CLAUDE.md §8).
 *
 * Campaigns and Settings are functional — they prove storage, export/import and
 * the engine boot path. Log, State and Resolve are placeholders that render the
 * real folded summary of the open campaign; they are filled in by Phases 2–4.
 */

import { $, el, clear, today } from './core.js';
import { campaigns, toMarkdown, fromMarkdown, exportBackup, importBackup, fileBinding } from './store.js';
import { modal, confirmModal, promptModal, showToast, announce } from './ui.js';
import * as settings from './settings.js';
import { go } from './router.js';
import { parse } from './lonelog/index.js';
import { renderLog } from './logview.js';
import { mountComposer } from './composer.js';

const PHASE_NOTE = 'Not built yet — this pane arrives in a later phase. The notation engine underneath it is complete and tested.';

export async function campaignsScreen(mount) {
  const list = await campaigns.all();

  mount.append(el('header', { class: 'screen-head' }, [
    el('h1', {}, ['Campaigns']),
    el('button', {
      class: 'btn btn-primary', type: 'button',
      onclick: async () => {
        const title = await promptModal('Name this campaign', { title: 'New campaign', placeholder: 'The Clearview Mystery' });
        if (title == null) return;
        const c = await campaigns.create(title.trim());
        showToast(`Created “${c.meta.title}”.`);
        go('log', { id: c.id });
      },
    }, ['New campaign']),
  ]));

  if (!list.length) {
    mount.append(el('p', { class: 'empty' }, [
      'No campaigns yet. Create one, or import a Lonelog markdown file from Settings.',
    ]));
    return;
  }

  mount.append(el('ul', { class: 'card-list' }, list.map((c) => {
    const { state } = parse(c.log.join('\n'));
    const bits = [
      `${c.log.length} line${c.log.length === 1 ? '' : 's'}`,
      state.scenes.length ? `${state.scenes.length} scenes` : null,
      state.addons.size ? [...state.addons].sort().join(', ') : null,
    ].filter(Boolean);

    return el('li', { class: 'card' }, [
      el('button', {
        class: 'card-main', type: 'button',
        onclick: () => go('log', { id: c.id }),
      }, [
        el('span', { class: 'card-title' }, [c.meta.title]),
        el('span', { class: 'card-meta' }, [bits.join(' · ')]),
        el('span', { class: 'card-meta' }, [`updated ${c.meta.updatedAt}`]),
      ]),
      el('button', {
        class: 'btn btn-quiet', type: 'button', 'aria-label': `Delete ${c.meta.title}`,
        onclick: async () => {
          if (!await confirmModal(`Delete “${c.meta.title}”? Its log cannot be recovered.`, { confirmLabel: 'Delete' })) return;
          await campaigns.remove(c.id);
          showToast('Campaign deleted.');
          go('campaigns');
        },
      }, ['Delete']),
    ]);
  })));
}

/** Shared header showing folded state — the persistent resource header (§1). */
function stateHeader(state) {
  const bits = [];
  if (state.marker.scene) bits.push(['Scene', state.marker.scene.id]);
  if (state.marker.round) bits.push(['Round', state.marker.round.id]);
  if (state.marker.turn) bits.push(['Turn', state.marker.turn.id]);
  bits.push(['Elements', String(state.elements.size)]);
  bits.push(['Rolls', String(state.counts.rolls)]);

  return el('div', { class: 'state-header', role: 'status' }, bits.map(([k, v]) =>
    el('span', { class: 'chip' }, [el('span', { class: 'chip-key' }, [k]), ` ${v}`])));
}

async function openCampaign(mount, params) {
  const c = params.id ? await campaigns.get(params.id) : null;
  if (!c) {
    mount.append(el('p', { class: 'empty' }, ['That campaign no longer exists.']));
    mount.append(el('button', { class: 'btn', type: 'button', onclick: () => go('campaigns') }, ['Back to campaigns']));
    return null;
  }
  return c;
}

export async function logScreen(mount, params) {
  let campaign = await openCampaign(mount, params);
  if (!campaign) return;

  /** Last truncation, kept in memory only so it can be undone once. */
  let removed = null;

  const head = el('header', { class: 'screen-head' }, []);
  const header = el('div', { class: 'state-header-slot' });
  const rows = el('div', { class: 'log-scroll' });
  const composerHost = el('div', { class: 'composer' });

  mount.append(head, header, rows, composerHost);

  async function persist() {
    campaign = await campaigns.put(campaign);
    if (campaign.bindings?.handle) {
      try { await fileBinding.write(campaign); }
      catch { showToast('Could not write to the bound file.', { tone: 'error' }); }
    }
  }

  function refresh(focusLine = null) {
    const { entries, state, findings } = parse(campaign.log.join('\n'));

    clear(head);
    head.append(
      el('h1', {}, [campaign.meta.title]),
      el('div', { class: 'head-tools' }, [
        el('button', {
          class: 'btn btn-small', type: 'button',
          onclick: async () => {
            const text = campaign.log.join('\n');
            const findingCount = findings.length;
            await modal({
              title: 'Log details',
              body: el('div', {}, [
                el('p', {}, [`${campaign.log.length} lines · ${entries.length} entries · ${state.elements.size} elements`]),
                el('p', {}, [`${state.scenes.length} scenes · ${state.sessions.length} sessions · ${state.counts.rolls} rolls`]),
                el('p', { class: 'hint' }, [findingCount
                  ? `${findingCount} lint finding${findingCount === 1 ? '' : 's'} — see docs/spec-review.md.`
                  : 'No lint findings.']),
                el('pre', { class: 'log-preview' }, [text.slice(0, 400) + (text.length > 400 ? '…' : '')]),
              ]),
            });
          },
        }, ['Details']),
        fileBinding.supported()
          ? el('button', {
            class: 'btn btn-small', type: 'button',
            onclick: async () => {
              try {
                const name = campaign.bindings?.handle
                  ? (await fileBinding.write(campaign), campaign.bindings.path)
                  : await fileBinding.bind(campaign);
                showToast(`Saved to ${name}.`);
                refresh();
              } catch (err) {
                if (err?.name !== 'AbortError') showToast(err.message, { tone: 'error' });
              }
            },
          }, [campaign.bindings?.handle ? 'Save to file' : 'Bind to file…'])
          : null,
      ]),
    );

    clear(header);
    header.append(stateHeader(state));

    renderLog(rows, entries, {
      findings,
      focusLine,
      onTruncate: async (line) => {
        removed = campaign.log.slice(line);
        campaign.log = campaign.log.slice(0, line);
        await persist();
        refresh();
        showToast(`Removed ${removed.length} line${removed.length === 1 ? '' : 's'}. Use Undo to restore.`);
      },
      onEdit: async (line, text) => {
        campaign.log[line] = text;
        await persist();
        refresh(line);
      },
    });

    mountComposer(composerHost, {
      state,
      canUndo: campaign.log.length > 0 || !!removed,
      commit: async (lines) => {
        removed = null;
        campaign.log.push(...lines);
        await persist();
        refresh();
      },
      undo: async () => {
        if (removed) {
          campaign.log.push(...removed);
          const n = removed.length;
          removed = null;
          await persist();
          refresh();
          showToast(`Restored ${n} line${n === 1 ? '' : 's'}.`);
          return;
        }
        if (!campaign.log.length) return;
        campaign.log.pop();
        await persist();
        refresh();
        announce('Last line removed.');
      },
    });
  }

  refresh();
}

export async function stateScreen(mount, params) {
  const c = await openCampaign(mount, params);
  if (!c) return;
  const { state } = parse(c.log.join('\n'));

  mount.append(el('header', { class: 'screen-head' }, [el('h1', {}, ['State'])]));
  mount.append(stateHeader(state));

  const byType = new Map();
  for (const element of state.elements.values()) {
    if (!byType.has(element.type)) byType.set(element.type, []);
    byType.get(element.type).push(element);
  }

  if (!byType.size) {
    mount.append(el('p', { class: 'empty' }, ['Nothing tracked yet. State appears as tags appear in the log.']));
  }

  for (const [type, items] of [...byType].sort()) {
    mount.append(el('section', { class: 'group' }, [
      el('h2', {}, [type]),
      el('ul', { class: 'plain-list' }, items.map((item) => {
        const parts = [];
        if (item.count) parts.push(`x${item.count.value}`);
        if (item.value) parts.push(item.value.value);
        if (item.progress) parts.push(`${item.progress.current}/${item.progress.total}`);
        for (const [k, v] of item.fields) parts.push(`${k} ${v.value}`);
        for (const f of item.flags.keys()) parts.push(f);
        return el('li', {}, [
          el('span', { class: 'el-name' }, [item.name]),
          el('span', { class: 'el-detail' }, [parts.join(' · ')]),
          el('span', { class: 'el-line' }, [`line ${item.lastLine + 1}`]),
        ]);
      })),
    ]));
  }

  mount.append(el('p', { class: 'note' }, [PHASE_NOTE]));
}

export async function resolveScreen(mount, params) {
  const c = await openCampaign(mount, params);
  if (!c) return;
  mount.append(el('header', { class: 'screen-head' }, [el('h1', {}, ['Resolve'])]));
  mount.append(el('p', { class: 'note' }, [
    'You roll the dice; this pane will capture the numbers and label the outcome. It never rolls for you. ' + PHASE_NOTE,
  ]));
}

export async function settingsScreen(mount) {
  mount.append(el('header', { class: 'screen-head' }, [el('h1', {}, ['Settings'])]));

  const themeSelect = el('select', {
    class: 'input', id: 'theme-select',
    onchange: async (e) => {
      await settings.set('theme', e.target.value);
      announce(`Theme set to ${e.target.value}.`);
    },
  }, settings.THEMES.map((t) => el('option', { value: t, selected: settings.get('theme') === t }, [t])));

  mount.append(el('section', { class: 'group' }, [
    el('h2', {}, ['Appearance']),
    el('div', { class: 'row' }, [
      el('label', { class: 'field-label', for: 'theme-select' }, ['Theme']),
      themeSelect,
    ]),
    el('p', { class: 'hint' }, ['“system” follows your device’s light or dark setting.']),
  ]));

  mount.append(el('section', { class: 'group' }, [
    el('h2', {}, ['Backup']),
    el('div', { class: 'row' }, [
      el('button', {
        class: 'btn', type: 'button',
        onclick: async () => {
          const data = await exportBackup();
          download(`lonely-backup-${today()}.json`, JSON.stringify(data, null, 2), 'application/json');
        },
      }, ['Export JSON backup']),
      el('button', {
        class: 'btn', type: 'button',
        onclick: () => pickFile('.json', async (text) => {
          try {
            const n = await importBackup(JSON.parse(text));
            showToast(`Imported ${n} campaign${n === 1 ? '' : 's'}.`);
            go('campaigns');
          } catch (err) {
            showToast(err.message, { tone: 'error' });
          }
        }),
      }, ['Import JSON backup']),
    ]),
    el('p', { class: 'hint' }, ['Everything stays on this device. There is no server and no account.']),
  ]));

  const list = await campaigns.all();
  mount.append(el('section', { class: 'group' }, [
    el('h2', {}, ['Lonelog markdown']),
    el('div', { class: 'row' }, [
      el('button', {
        class: 'btn', type: 'button', disabled: !list.length,
        onclick: async () => {
          for (const c of list) download(`${c.meta.title}.md`, toMarkdown(c), 'text/markdown');
        },
      }, ['Export all as markdown']),
      el('button', {
        class: 'btn', type: 'button',
        onclick: () => pickFile('.md,.markdown,.txt', async (text, name) => {
          const c = await campaigns.put(fromMarkdown(text, name.replace(/\.[^.]+$/, '')));
          showToast(`Imported “${c.meta.title}” (${c.log.length} lines).`);
          go('log', { id: c.id });
        }),
      }, ['Import markdown']),
    ]),
    el('p', { class: 'hint' }, [
      'Import keeps every line verbatim, including lines this app does not recognise.',
    ]),
  ]));

  mount.append(el('section', { class: 'group' }, [
    el('h2', {}, ['About']),
    el('p', {}, ['Lonely is a play assistant and session logger for solo RPGs. It works with any system and requires no setup.']),
    el('p', { class: 'hint' }, [
      'Built on Lonelog by Roberto Bisceglie, licensed CC BY-SA 4.0. Your session logs are your own work.',
    ]),
  ]));
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function pickFile(accept, onLoad) {
  const input = /** @type {HTMLInputElement} */ (el('input', { type: 'file', accept, hidden: true }));
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    file.text().then((text) => onLoad(text, file.name)).finally(() => input.remove());
  });
  document.body.append(input);
  input.click();
}
