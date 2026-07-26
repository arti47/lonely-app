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
import { renderState, renderStateHeader } from './state.js';

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
    header.append(renderStateHeader(state, (line) => refresh(line)));

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

  refresh(params.line ?? null);
}

export async function stateScreen(mount, params) {
  let campaign = await openCampaign(mount, params);
  if (!campaign) return;

  const head = el('header', { class: 'screen-head' }, [el('h1', {}, ['State'])]);
  const header = el('div', { class: 'state-header-slot' });
  const body = el('div', { class: 'state-body' });
  mount.append(head, header, body);

  function refresh() {
    const { state } = parse(campaign.log.join('\n'));
    clear(header);
    header.append(renderStateHeader(state, trace));
    renderState(body, state, {
      trace,
      // Editing state appends a tag line; it never mutates state (§5.1).
      commit: async (lines) => {
        campaign.log.push(...lines);
        campaign = await campaigns.put(campaign);
        if (campaign.bindings?.handle) {
          try { await fileBinding.write(campaign); } catch { /* reported on the log screen */ }
        }
        announce(`Appended ${lines.length} line${lines.length === 1 ? '' : 's'} to the log.`);
        refresh();
      },
    });
  }

  function trace(line) {
    go('log', { id: campaign.id, line });
  }

  refresh();
}

export async function resolveScreen(mount, params) {
  const c = await openCampaign(mount, params);
  if (!c) return;
  const { state } = parse(c.log.join('\n'));
  mount.append(el('header', { class: 'screen-head' }, [el('h1', {}, ['Resolve'])]));
  mount.append(renderStateHeader(state, (line) => go('log', { id: c.id, line })));
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
