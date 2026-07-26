/**
 * Symbol-first composer (CLAUDE.md §8 Phase 2).
 *
 * Notation is never typed by hand unless the user wants to: a symbol is chosen,
 * then the text. Tags are built from a form whose name field autocompletes from
 * whatever the fold already knows, so `[N:Jonah]` stays one element rather than
 * three spellings of one.
 *
 * The pure helpers below are exported for tests and hold no DOM references.
 */

import { el, clear, today } from './core.js';
import { modal, promptModal, showToast, announce, referenceButton } from './ui.js';
import { serializeTag, KNOWN_TAG_TYPES, BLOCK_NAMES } from './lonelog/tags.js';
import { elementsOfType } from './lonelog/fold.js';
import { sceneBundle, sessionStartBundle, sessionEndBundle } from './lifecycle.js';

/** Line kinds the composer can emit, in bar order. */
export const SYMBOLS = [
  { kind: 'action', glyph: '@', label: 'Action', prefix: '@ ', ref: 'action' },
  { kind: 'question', glyph: '?', label: 'Oracle question', prefix: '? ', ref: 'question' },
  { kind: 'dice', glyph: 'd:', label: 'Dice or oracle roll', prefix: 'd: ', ref: 'dice' },
  { kind: 'resolution', glyph: '->', label: 'Resolution', prefix: '-> ', ref: 'resolution' },
  { kind: 'consequence', glyph: '=>', label: 'Consequence', prefix: '=> ', ref: 'consequence' },
  { kind: 'tbl', glyph: 'tbl:', label: 'Table lookup', prefix: 'tbl: ', ref: 'tbl' },
  { kind: 'gen', glyph: 'gen:', label: 'Generator', prefix: 'gen: ', ref: 'gen' },
  { kind: 'note', glyph: '( )', label: 'Meta note', prefix: '(note: ', suffix: ')', ref: 'note' },
];

/**
 * Compose one log line.
 * @param {string} kind one of SYMBOLS[].kind, or 'prose'
 * @param {string} text
 * @returns {string}
 */
export function buildLine(kind, text) {
  const body = String(text ?? '').trim();
  const sym = SYMBOLS.find((s) => s.kind === kind);
  if (!sym) return body;
  if (!body) return sym.prefix.trimEnd() + (sym.suffix ?? '');
  return `${sym.prefix}${body}${sym.suffix ?? ''}`;
}

/**
 * @param {{type:string, name:string, fields?:string[], ref?:boolean}} spec
 * @returns {string} canonical tag text
 */
export function buildTag({ type, name, fields = [], ref = false }) {
  return serializeTag({
    ref, type, name: String(name).trim(), count: null, head: null,
    fields: fields.filter((f) => String(f).trim()).map((f) => ({
      raw: f, op: 'set', key: null, value: String(f).trim(),
      count: null, delta: null, progress: null, transition: null, list: null,
    })),
  });
}

/** Next unused scene number (core §5.3.1). */
export function nextSceneNumber(state) {
  const plain = (state?.scenes ?? []).filter((s) => !s.flashback && s.montage == null);
  return plain.length ? Math.max(...plain.map((s) => s.scene)) + 1 : 1;
}

/** Next session number (core §5.2). */
export function nextSessionNumber(state) {
  const numbers = (state?.sessions ?? []).map((s) => s.number).filter(Number.isFinite);
  return numbers.length ? Math.max(...numbers) + 1 : 1;
}

/** Lines that open a session (digital markdown form, core §5.2.1). */
export function sessionLines(state, date = today()) {
  return [`## Session ${nextSessionNumber(state)}`, `*Date: ${date}*`, ''];
}

/** @param {object} state @param {string} context */
export function sceneLine(state, context) {
  const c = String(context ?? '').trim();
  return c ? `S${nextSceneNumber(state)} *${c}*` : `S${nextSceneNumber(state)}`;
}

/** Names already known for a tag type, for autocomplete. */
export function suggestNames(state, type) {
  return elementsOfType(state, type).map((e) => e.name).sort();
}

/** Block names not currently open, and the one that is (combat §1, wargaming §1). */
export function blockOptions(state) {
  const open = (state?.blockStack ?? []).map((b) => b.name);
  return {
    open,
    closable: open.length ? open[open.length - 1] : null,
    openable: [...BLOCK_NAMES].filter((n) => !open.includes(n)),
  };
}

/**
 * Mount the composer.
 * @param {HTMLElement} host
 * @param {{state:object, commit:(lines:string[])=>Promise<any>, undo:()=>Promise<any>,
 *          canUndo:boolean, canRestore?:boolean, undoLabel?:string,
 *          restore?:()=>Promise<any>}} ctx
 */
export function mountComposer(host, ctx) {
  clear(host);

  let kind = 'action';

  const explain = el('span', { class: 'composer-explain' });

  const input = /** @type {HTMLInputElement} */ (el('input', {
    class: 'input composer-input',
    type: 'text',
    id: 'composer-input',
    autocomplete: 'off',
    autocapitalize: 'sentences',
    'aria-label': 'Line text',
  }));

  const bar = el('div', { class: 'symbol-bar', role: 'group', 'aria-label': 'Line type' },
    SYMBOLS.map((s) => el('button', {
      class: 'sym', type: 'button', title: s.label, 'aria-label': s.label,
      'aria-pressed': s.kind === kind ? 'true' : 'false',
      dataset: { kind: s.kind },
      onclick: () => setKind(s.kind),
    }, [s.glyph])));

  function setKind(next) {
    kind = next;
    for (const b of bar.querySelectorAll('.sym')) {
      b.setAttribute('aria-pressed', b.getAttribute('data-kind') === kind ? 'true' : 'false');
    }
    const symbol = SYMBOLS.find((s) => s.kind === kind);
    input.placeholder = symbol?.label ?? 'Line';
    clear(explain);
    if (symbol?.ref) explain.append(referenceButton(symbol.ref, { label: symbol.label }));
    input.focus();
  }

  async function commitCurrent() {
    const text = input.value.trim();
    if (!text) return;
    await ctx.commit([buildLine(kind, text)]);
    input.value = '';
    announce(`${SYMBOLS.find((s) => s.kind === kind)?.label ?? 'Line'} added.`);
    input.focus();
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitCurrent(); }
  });

  const tools = el('div', { class: 'composer-tools' }, [
    el('button', {
      class: 'btn btn-small', type: 'button',
      onclick: async () => {
        const line = await tagDialog(ctx.state);
        if (!line) return;
        const existing = input.value.trim();
        input.value = existing ? `${existing} ${line}` : line;
        input.focus();
      },
    }, ['Tag…']),
    el('button', {
      class: 'btn btn-small', type: 'button',
      onclick: async () => {
        const context = await promptModal('Scene context (where and when)', {
          title: `Scene S${nextSceneNumber(ctx.state)}`, placeholder: 'Dark alley, midnight',
        });
        if (context == null) return;
        await fire(ctx, sceneBundle(ctx.state, { context }), 'End scene');
      },
    }, ['Scene']),
    el('button', {
      class: 'btn btn-small', type: 'button',
      onclick: async () => {
        const choice = await modal({
          title: 'Session',
          body: 'Ending a session closes any open block and snapshots the add-ons your log uses.',
          actions: [
            { label: 'Cancel', value: null },
            { label: 'End session', value: 'end' },
            { label: 'Start session', value: 'start', primary: true },
          ],
        });
        if (choice === 'start') await fire(ctx, sessionStartBundle(ctx.state), 'Start session');
        if (choice === 'end') await fire(ctx, sessionEndBundle(ctx.state), 'End session');
      },
    }, ['Session…']),
    blockButton(ctx),
    el('button', {
      class: 'btn btn-small btn-quiet', type: 'button', disabled: !ctx.canUndo, id: 'composer-undo',
      onclick: () => ctx.undo(),
    }, [ctx.undoLabel ?? 'Undo']),
    ctx.canRestore ? el('button', {
      class: 'btn btn-small btn-quiet', type: 'button', id: 'composer-restore',
      onclick: () => ctx.restore(),
    }, ['Restore']) : null,
  ]);

  host.append(
    bar,
    el('div', { class: 'composer-row' }, [
      input,
      explain,
      el('button', { class: 'btn btn-primary', type: 'button', onclick: commitCurrent }, ['Add']),
    ]),
    tools,
  );

  setKind(kind);
}

function blockButton(ctx) {
  const { closable, openable } = blockOptions(ctx.state);
  if (closable) {
    return el('button', {
      class: 'btn btn-small', type: 'button',
      onclick: () => ctx.commit([`[/${closable}]`]),
    }, [`End ${titleCase(closable)}`]);
  }
  return el('button', {
    class: 'btn btn-small', type: 'button',
    onclick: async () => {
      const pick = await modal({
        title: 'Open a block',
        body: 'Blocks mark a shift into denser notation and close again when the mode ends.',
        actions: [
          { label: 'Cancel', value: null },
          ...openable.map((name) => ({ label: titleCase(name), value: name })),
        ],
      });
      if (pick) await ctx.commit([`[${pick}]`]);
    },
  }, ['Block…']);
}

function titleCase(s) {
  return s.toLowerCase().replace(/(^|\s)\w/g, (c) => c.toUpperCase());
}

/** Build a tag through a form rather than by typing brackets. */
async function tagDialog(state) {
  const types = [...new Set(KNOWN_TAG_TYPES.values())];
  let chosenType = 'N';

  const typeSelect = /** @type {HTMLSelectElement} */ (
    el('select', { class: 'input', id: 'tag-type' },
      types.map((t) => el('option', { value: t, selected: t === chosenType }, [t]))));

  const listId = 'tag-name-options';
  const datalist = el('datalist', { id: listId });
  const nameInput = /** @type {HTMLInputElement} */ (el('input', {
    class: 'input', type: 'text', id: 'tag-name', list: listId, autocomplete: 'off',
  }));
  const fieldsInput = /** @type {HTMLInputElement} */ (el('input', {
    class: 'input', type: 'text', id: 'tag-fields',
    placeholder: 'wounded | HP 8   (separate fields with |)',
  }));

  function refreshNames() {
    clear(datalist);
    for (const name of suggestNames(state, typeSelect.value)) {
      datalist.append(el('option', { value: name }));
    }
  }
  typeSelect.addEventListener('change', refreshNames);
  refreshNames();

  const body = el('div', { class: 'form' }, [
    el('label', { class: 'field-label', for: 'tag-type' }, ['Type']), typeSelect,
    el('label', { class: 'field-label', for: 'tag-name' }, ['Name']), nameInput, datalist,
    el('label', { class: 'field-label', for: 'tag-fields' }, ['Fields']), fieldsInput,
    el('p', { class: 'hint' }, ['Existing names autocomplete, so an element stays one element.']),
  ]);

  const ok = await modal({
    title: 'Add a tag',
    body,
    actions: [{ label: 'Cancel', value: null }, { label: 'Insert', value: true, primary: true }],
  });

  if (ok !== true) return null;
  const name = nameInput.value.trim();
  if (!name) { showToast('A tag needs a name.', { tone: 'error' }); return null; }

  return buildTag({
    type: typeSelect.value,
    name,
    fields: fieldsInput.value.split('|'),
  });
}

/**
 * Commit a lifecycle bundle, confirming first when it does more than drop a
 * single marker (CLAUDE.md §8 Phase 6).
 * @param {object} ctx
 * @param {import('./lifecycle.js').Bundle} bundle
 * @param {string} title
 */
async function fire(ctx, bundle, title) {
  if (!bundle.lines.length) {
    showToast(bundle.summary[0] ?? 'Nothing to do.');
    return;
  }
  if (bundle.heavy) {
    const ok = await modal({
      title,
      body: el('div', {}, [
        el('ul', { class: 'plain-list' }, bundle.summary.map((s) => el('li', {}, [s]))),
        el('p', { class: 'hint' }, [
          `${bundle.lines.length} line${bundle.lines.length === 1 ? '' : 's'} will be appended. `
          + 'Undo removes the whole bundle.',
        ]),
      ]),
      actions: [{ label: 'Cancel', value: false }, { label: title, value: true, primary: true }],
    });
    if (ok !== true) return;
  }
  await ctx.commit(bundle.lines);
}
