/**
 * Screen renderers (CLAUDE.md §3.1).
 *
 * One function per route. Screens own layout and wiring only: notation lives in
 * `src/lonelog/`, persistence in `store.js`, and the panes themselves in
 * `logview.js`, `state.js` and `resolve.js`.
 *
 * Four of these routes have a tab (D10); `resolve` and `settings` are reached
 * from Play and Campaigns respectively, and stay real routes so the guide can
 * link straight to them.
 */

import { $, el, clear, today } from './core.js';
import { campaigns, toMarkdown, fromMarkdown, exportBackup, importBackup, fileBinding } from './store.js';
import { modal, confirmModal, promptModal, showToast, announce, dismissModal } from './ui.js';
import { sceneBundle, sessionStartBundle, sessionEndBundle } from './lifecycle.js';
import {
  renderChecklist, shouldShowChecklist, createSample, SAMPLE_TITLE,
} from './onboarding.js';
import { isSupported, checkNow, promptUpdate } from './update.js';
import * as settings from './settings.js';
import { go, rememberCampaign, forgetCampaign } from './router.js';
import { parse } from './lonelog/index.js';
import { renderLog } from './logview.js';
import { mountComposer, nextSceneNumber } from './composer.js';
import { renderState, renderStateHeader, traceButton, knownFieldKeys } from './state.js';
import { renderResolve } from './resolve.js';
import { templates as templateStore } from './store.js';
import { toPack, fromPack } from './templates.js';
import { search, grouped } from './reference.js';
import { renderGuide } from './guide.js';

export async function campaignsScreen(mount) {
  const list = await campaigns.all();

  mount.append(el('header', { class: 'screen-head' }, [
    el('h1', {}, ['Campaigns']),
    el('div', { class: 'head-tools' }, [
      // Settings has no tab of its own (D10), so this is its way in.
      el('button', {
        class: 'btn btn-small', type: 'button',
        onclick: () => go('settings'),
      }, ['Settings']),
      el('button', {
        class: 'btn btn-primary', type: 'button',
        onclick: async () => {
          const title = await promptModal('Name this campaign', { title: 'New campaign', placeholder: 'The Clearview Mystery' });
          if (title == null) return;
          const c = await campaigns.create(title.trim());
          showToast(`Created “${c.meta.title}”.`);
          go('log', { id: c.id });
        },
      }, ['New campaign…']),
    ]),
  ]));

  if (!list.length) {
    mount.append(el('p', { class: 'empty' }, [
      'No campaigns yet. Tap New campaign above — there is nothing to set up, no '
      + 'system to choose and no account. Already have a Lonelog file? Settings '
      + 'imports it.',
    ]));
    // Reading a played log is the quickest way to see what this app is for: the
    // sheet, the clock and the combat panel are already there (F8).
    mount.append(el('div', { class: 'row' }, [
      el('button', {
        class: 'btn', type: 'button', id: 'open-sample',
        onclick: async () => {
          const c = await createSample(campaigns);
          showToast('Opened an example campaign. Delete it whenever you like.');
          go('log', { id: c.id });
        },
      }, ['Look at an example']),
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
          forgetCampaign(c.id);
          if (settings.get('lastCampaign') === c.id) await settings.set('lastCampaign', null);
          showToast('Campaign deleted.');
          go('campaigns');
        },
      }, ['Delete']),
    ]);
  })));
}

/**
 * Load the campaign a screen is about, or render a dead end that still says
 * which screen you are on.
 * @param {HTMLElement} mount @param {object} params @param {string} title
 */
async function openCampaign(mount, params, title) {
  const c = params.id ? await campaigns.get(params.id) : null;
  if (!c) {
    if (params.id) forgetCampaign(params.id);
    mount.append(el('header', { class: 'screen-head' }, [el('h1', {}, [title])]));
    mount.append(el('p', { class: 'empty' }, [
      params.id
        ? 'That campaign no longer exists.'
        : `Open a campaign and its ${title.toLowerCase()} appears here.`,
    ]));
    mount.append(el('button', {
      class: 'btn btn-primary', type: 'button', onclick: () => go('campaigns'),
    }, ['Choose a campaign']));
    return null;
  }
  // The gated tabs follow whichever campaign was opened last (D10).
  rememberCampaign(c.id);
  if (settings.get('lastCampaign') !== c.id) await settings.set('lastCampaign', c.id);
  return c;
}

/** The campaign header's fields, as core §5.1 names them. */
const CAMPAIGN_HEADER_FIELDS = [
  ['title', 'Title'], ['ruleset', 'Ruleset'], ['genre', 'Genre'],
  ['player', 'Player'], ['tone', 'Tone'],
];

export async function logScreen(mount, params) {
  let campaign = await openCampaign(mount, params, 'Log');
  if (!campaign) return;

  /** Last removal, kept in memory only so it can be restored once (§5.1). */
  let removed = null;
  /** Lines appended by the most recent commit, so undo takes the whole bundle. */
  let lastBatch = 1;

  const head = el('header', { class: 'screen-head' }, []);
  const header = el('div', { class: 'state-header-slot' });
  const rows = el('div', { class: 'log-scroll' });
  const lintHost = el('div', {});
  const checklistHost = el('div', { class: 'checklist-slot' });
  const composerHost = el('div', { class: 'composer' });

  mount.append(head, header, rows, lintHost, checklistHost, composerHost);

  async function persist() {
    campaign = await campaigns.put(campaign);
    if (campaign.bindings?.handle) {
      try { await fileBinding.write(campaign); }
      catch { showToast('Could not write to the bound file.', { tone: 'error' }); }
    }
  }

  /**
   * Edit the campaign header (core §5.1). It is metadata, not log content, so
   * it is stored on the campaign and written into the export's front matter —
   * nothing here appends a line (§5.1 is about state, not the header).
   */
  async function editHeader() {
    const inputs = CAMPAIGN_HEADER_FIELDS.map(([key, label]) => {
      const id = `header-${key}`;
      const input = /** @type {HTMLInputElement} */ (el('input', {
        id, class: 'input', type: 'text', value: campaign.meta[key] ?? '',
      }));
      return { key, row: el('div', { class: 'field-row' }, [el('label', { for: id }, [label]), input]), input };
    });
    const ok = await modal({
      title: 'Campaign header',
      body: el('div', { class: 'field-rows' }, inputs.map((f) => f.row)),
      actions: [{ label: 'Cancel', value: null }, { label: 'Save', value: true, primary: true }],
    });
    if (!ok) return;
    for (const { key, input } of inputs) campaign.meta[key] = input.value.trim();
    if (!campaign.meta.title) campaign.meta.title = 'Untitled campaign';
    await persist();
    refresh();
  }

  /** Append lines the way the composer does, so undo still takes the batch. */
  async function commitLines(lines) {
    removed = null;
    lastBatch = lines.length;
    campaign.log.push(...lines);
    await persist();
    refresh();
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
            const header = CAMPAIGN_HEADER_FIELDS
              .filter(([key]) => String(campaign.meta[key] ?? '').trim())
              .map(([key, label]) => `${label}: ${campaign.meta[key]}`);
            const choice = await modal({
              title: 'Log details',
              body: el('div', {}, [
                // The campaign header is a real construct (core §5.1) and it
                // ships in the export — so it has to be visible and editable
                // somewhere, not just present in storage.
                el('p', {}, [header.length ? header.join(' · ') : 'No campaign header yet.']),
                el('p', {}, [`${campaign.log.length} lines · ${entries.length} entries · ${state.elements.size} elements`]),
                el('p', {}, [`${state.scenes.length} scenes · ${state.sessions.length} sessions · ${state.counts.rolls} rolls`]),
                el('p', { class: 'hint' }, [findingCount
                  ? `${findingCount} lint finding${findingCount === 1 ? '' : 's'} — see docs/spec-review.md.`
                  : 'No lint findings.']),
                el('pre', { class: 'log-preview' }, [text.slice(0, 400) + (text.length > 400 ? '…' : '')]),
              ]),
              actions: [{ label: 'Close', value: null }, { label: 'Edit header…', value: 'edit' }],
            });
            if (choice === 'edit') await editHeader();
          },
        }, ['Details…']),
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
    header.append(renderStateHeader(state, (line) => refresh(line), {
      // Scene and session move the state this strip shows, so they live in it
      // rather than in a row of equal-weight composer tools (D12).
      onScene: async () => {
        const context = await promptModal('Scene context (where and when)', {
          title: `Scene S${nextSceneNumber(state)}`, placeholder: 'Dark alley, midnight',
        });
        if (context == null) return;
        await fire(sceneBundle(state, { context }), 'End scene', commitLines);
      },
      onSession: async () => {
        const choice = await modal({
          title: 'Session',
          body: 'Ending a session closes any open block and snapshots the add-ons your log uses.',
          actions: [
            { label: 'Cancel', value: null },
            { label: 'End session', value: 'end' },
            { label: 'Start session', value: 'start', primary: true },
          ],
        });
        if (choice === 'start') await fire(sessionStartBundle(state), 'Start session', commitLines);
        if (choice === 'end') await fire(sessionEndBundle(state), 'End session', commitLines);
      },
    }));

    clear(checklistHost);
    if (shouldShowChecklist(state, entries, campaign.view?.checklist)) {
      renderChecklist(checklistHost, state, entries, {
        onHide: async () => {
          campaign.view = { ...campaign.view, checklist: 'hidden' };
          await persist();
          refresh();
        },
      });
    }

    const level = settings.get('lintLevel');
    const shown = level === 'off' ? []
      : level === 'all' ? findings
        : findings.filter((f) => f.severity !== 'info');

    renderLog(rows, entries, {
      findings: shown,
      focusLine,
      onTruncate: async (line) => {
        removed = campaign.log.slice(line);
        campaign.log = campaign.log.slice(0, line);
        lastBatch = 1;
        await persist();
        refresh();
        showToast(`Removed ${removed.length} line${removed.length === 1 ? '' : 's'}. Use Restore to put them back.`);
      },
      onEdit: async (line, text) => {
        campaign.log[line] = text;
        await persist();
        refresh(line);
      },
    });

    clear(lintHost);
    if (shown.length) {
      const errors = shown.filter((f) => f.severity === 'error').length;
      lintHost.append(el('p', { class: `note ${errors ? 'note-warn' : ''}` }, [
        `${shown.length} spec note${shown.length === 1 ? '' : 's'}`
        + (errors ? `, ${errors} of them worth fixing` : '')
        + ' — tap a flagged line to see why.',
      ]));
    }

    mountComposer(composerHost, {
      state,
      entries,
      canUndo: campaign.log.length > 0,
      canRestore: !!removed,
      undoLabel: lastBatch > 1 ? `Undo ${lastBatch} lines` : 'Undo',
      // Rolling opens over the log rather than taking you to another screen, so
      // the line you were writing is still there when the roll lands (F6).
      onRoll: async () => {
        const host = el('div', {});
        await mountResolve(host, {
          state,
          entries,
          commit: async (lines) => { await commitLines(lines); dismissModal(); },
        });
        await modal({
          title: 'Roll',
          body: host,
          className: 'modal-sheet',
          actions: [{ label: 'Done', value: null, primary: true }],
        });
      },
      commit: commitLines,
      // Undo takes back the whole of the last commit, so a lifecycle bundle or a
      // multi-line session header comes off in one step rather than a line at a
      // time (§8 Phase 6).
      undo: async () => {
        if (!campaign.log.length) return;
        const n = Math.min(Math.max(lastBatch, 1), campaign.log.length);
        removed = campaign.log.slice(campaign.log.length - n);
        campaign.log = campaign.log.slice(0, campaign.log.length - n);
        lastBatch = 1;
        await persist();
        refresh();
        announce(`Removed ${n} line${n === 1 ? '' : 's'}.`);
      },
      restore: async () => {
        if (!removed) return;
        const n = removed.length;
        campaign.log.push(...removed);
        removed = null;
        lastBatch = n;
        await persist();
        refresh();
        showToast(`Restored ${n} line${n === 1 ? '' : 's'}.`);
      },
    });
  }

  refresh(params.line ?? null);
}

export async function stateScreen(mount, params) {
  let campaign = await openCampaign(mount, params, 'State');
  if (!campaign) return;

  const head = el('header', { class: 'screen-head' }, [el('h1', {}, ['Sheet'])]);
  const header = el('div', { class: 'state-header-slot' });
  const body = el('div', { class: 'state-body' });
  mount.append(head, header, body);

  function refresh() {
    const { state } = parse(campaign.log.join('\n'));
    clear(header);
    header.append(renderStateHeader(state, trace));
    renderState(body, state, {
      trace,
      knownKeys: knownFieldKeys(state),
      traceButton: (line) => traceButton(line, { trace }),
      hidden: new Set(campaign.view?.hiddenPanels ?? []),
      // Hiding a panel is presentation, stored in `view` — it must never touch
      // the log (§7).
      toggleHidden: async (addonId) => {
        const hiddenPanels = new Set(campaign.view?.hiddenPanels ?? []);
        if (hiddenPanels.has(addonId)) hiddenPanels.delete(addonId);
        else hiddenPanels.add(addonId);
        campaign.view = { ...campaign.view, hiddenPanels: [...hiddenPanels] };
        campaign = await campaigns.put(campaign);
        refresh();
      },
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
  let campaign = await openCampaign(mount, params, 'Roll');
  if (!campaign) return;

  const head = el('header', { class: 'screen-head' }, [el('h1', {}, ['Roll'])]);
  const header = el('div', { class: 'state-header-slot' });
  const body = el('div', {});
  mount.append(head, header, body);

  async function refresh() {
    const { state, entries } = parse(campaign.log.join('\n'));
    clear(header);
    header.append(renderStateHeader(state, (line) => go('log', { id: campaign.id, line })));

    await mountResolve(body, {
      state,
      entries,
      commit: async (lines) => {
        campaign.log.push(...lines);
        campaign = await campaigns.put(campaign);
        if (campaign.bindings?.handle) {
          try { await fileBinding.write(campaign); } catch { /* reported on the log screen */ }
        }
        showToast(`Added ${lines.length} line${lines.length === 1 ? '' : 's'} to the log.`);
        refresh();
      },
    });
  }

  await refresh();
}

/**
 * Mount the roll pane. Shared by the Roll screen and the drawer over the log
 * (F6) so both offer the same quick rolls, packs and tables.
 *
 * @param {HTMLElement} host
 * @param {{state:object, entries:object[], commit:(lines:string[])=>Promise<any>}} ctx
 */
async function mountResolve(host, ctx) {
  let saved = await templateStore.all();

  function draw() {
    renderResolve(host, ctx.state, {
      entries: ctx.entries,
      templates: saved,
      commit: ctx.commit,
      onSaveTemplate: async (template) => {
        await templateStore.put(template);
        saved = await templateStore.all();
        showToast(`Saved “${template.label}” as a quick roll.`);
        draw();
      },
      onDeleteTemplate: async (id) => {
        await templateStore.remove(id);
        saved = await templateStore.all();
        draw();
      },
      onExportPack: async () => {
        const name = await promptModal('Pack name', {
          title: 'Export roll pack', placeholder: 'My house rolls',
        });
        if (!name?.trim()) return;
        download(`${name.trim()}.lonelypack.json`,
          JSON.stringify(toPack(name.trim(), saved), null, 2), 'application/json');
      },
      onImportPack: () => pickFile('.json', async (text) => {
        try {
          const pack = fromPack(JSON.parse(text));
          for (const template of pack.templates) await templateStore.put(template);
          saved = await templateStore.all();
          showToast(`Imported ${pack.templates.length} roll${pack.templates.length === 1 ? '' : 's'} from “${pack.name}”.`);
          draw();
        } catch (err) {
          showToast(err.message, { tone: 'error' });
        }
      }),
    });
  }

  draw();
}

/**
 * Commit a lifecycle bundle, confirming first when it does more than drop a
 * single marker (CLAUDE.md §8 Phase 6).
 * @param {import('./lifecycle.js').Bundle} bundle
 * @param {string} title
 * @param {(lines:string[])=>Promise<any>} commit
 */
async function fire(bundle, title, commit) {
  if (!bundle.lines.length) {
    showToast(bundle.summary[0] ?? 'Nothing to do.');
    return;
  }
  if (bundle.heavy) {
    const ok = await modal({
      title,
      body: el('div', {}, [
        el('ul', { class: 'plain-list' }, bundle.summary.map((line) => el('li', {}, [line]))),
        el('p', { class: 'hint' }, [
          `${bundle.lines.length} line${bundle.lines.length === 1 ? '' : 's'} will be appended. `
          + 'Undo removes the whole bundle.',
        ]),
      ]),
      actions: [{ label: 'Cancel', value: false }, { label: title, value: true, primary: true }],
    });
    if (ok !== true) return;
  }
  await commit(bundle.lines);
}

export async function referenceScreen(mount) {
  const list = await campaigns.all();
  let view = settings.get('notationView') === 'reference' ? 'reference' : 'guide';

  const panel = el('div', {});

  const tabs = el('div', { class: 'view-switch', role: 'group', 'aria-label': 'Help view' },
    [['guide', 'Guide'], ['reference', 'Notation']].map(([id, label]) => el('button', {
      class: 'btn btn-small', type: 'button', dataset: { view: id },
      'aria-pressed': view === id ? 'true' : 'false',
      onclick: async () => {
        view = id;
        await settings.set('notationView', id);
        draw();
      },
    }, [label])));

  function draw() {
    for (const button of tabs.querySelectorAll('[data-view]')) {
      button.setAttribute('aria-pressed', button.getAttribute('data-view') === view ? 'true' : 'false');
    }
    clear(panel);
    if (view === 'guide') {
      renderGuide(panel, {
        hasCampaign: list.length > 0,
        go: (route) => go(route, route === 'campaigns' || route === 'settings' ? {} : { id: list[0]?.id }),
      });
    } else {
      renderReference(panel);
    }
  }

  mount.append(
    el('header', { class: 'screen-head' }, [el('h1', {}, ['Help']), tabs]),
    panel,
  );
  draw();
}

function renderReference(mount) {
  const results = el('div', {});
  let expandAll = false;

  const box = /** @type {HTMLInputElement} */ (el('input', {
    class: 'input', type: 'search', id: 'ref-search', autocomplete: 'off',
    placeholder: 'Search — clock, damage, inventory, flashback…',
    'aria-label': 'Search the notation reference',
    oninput: () => draw(box.value),
  }));

  const toggle = el('button', {
    class: 'btn btn-small', type: 'button', id: 'ref-toggle',
    onclick: () => { expandAll = !expandAll; draw(box.value); },
  }, ['Expand all']);

  function draw(query = '') {
    clear(results);
    const found = search(query);
    const searching = query.trim() !== '';

    toggle.textContent = expandAll ? 'Collapse all' : 'Expand all';
    toggle.setAttribute('aria-pressed', expandAll ? 'true' : 'false');

    if (!found.length) {
      results.append(el('p', { class: 'empty' }, [`Nothing matches “${query}”.`]));
      return;
    }

    for (const [group, entries] of grouped(found)) {
      results.append(el('section', { class: 'group' }, [
        el('h2', {}, [group]),
        el('ul', { class: 'plain-list ref-list' }, entries.map((entry) => el('li', {}, [
          // A search that already narrowed to a few entries should show them;
          // browsing the whole list should not be a wall of text.
          el('details', { class: 'ref-entry', open: expandAll || searching }, [
            el('summary', { class: 'ref-head' }, [
              el('span', { class: 'el-name' }, [entry.title]),
              el('code', { class: 'ref-syntax' }, [entry.syntax]),
            ]),
            el('div', { class: 'ref-body' }, [
              el('p', { class: 'el-detail' }, [entry.summary]),
              el('pre', { class: 'log-preview' }, [entry.examples.join('\n')]),
              el('p', { class: 'hint' }, [`Spec: ${entry.spec}`]),
            ]),
          ]),
        ]))),
      ]));
    }
  }

  mount.append(el('div', { class: 'group ref-controls' }, [box, toggle]), results);
  draw('');
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

  const lintSelect = el('select', {
    class: 'input', id: 'lint-select',
    onchange: async (e) => {
      await settings.set('lintLevel', e.target.value);
      announce(`Spec warnings set to ${e.target.value}.`);
    },
  }, [
    ['warn', 'warnings and errors'],
    ['all', 'everything, including style'],
    ['off', 'off'],
  ].map(([value, label]) => el('option', { value, selected: settings.get('lintLevel') === value }, [label])));

  mount.append(el('section', { class: 'group' }, [
    el('h2', {}, ['Spec warnings']),
    el('div', { class: 'row' }, [
      el('label', { class: 'field-label', for: 'lint-select' }, ['Show']),
      lintSelect,
    ]),
    el('p', { class: 'hint' }, [
      'Warnings are advisory and never block writing. Your log is yours.',
    ]),
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

  if (isSupported()) {
    mount.append(el('section', { class: 'group' }, [
      el('h2', {}, ['App version']),
      el('div', { class: 'row' }, [
        el('button', {
          class: 'btn', type: 'button', id: 'check-updates',
          onclick: async () => {
            const result = await checkNow();
            if (result === 'ready') promptUpdate();
            else showToast('You are on the latest version.');
          },
        }, ['Check for updates']),
      ]),
      el('p', { class: 'hint' }, [
        'The app checks by itself while it is open. When a new version is ready '
        + 'you get a button — it never reloads mid-session.',
      ]),
    ]));
  }

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
