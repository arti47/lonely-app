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
import { modal, showToast, announce, referenceButton } from './ui.js';
import { serializeTag, BLOCK_NAMES } from './lonelog/tags.js';
import { groupedTagTypes, tagTypeLabel } from './reference.js';
import { elementsOfType } from './lonelog/fold.js';

/**
 * Line kinds the composer can emit, in bar order.
 *
 * `word` is what the button says under its glyph (D9). The glyph alone put the
 * meaning in a `title` attribute, which a phone never shows — and `->` versus
 * `=>` is exactly the distinction a new user cannot guess. `basic` marks the
 * four that carry a whole session on their own; the rest are one tap away.
 */
export const SYMBOLS = [
  { kind: 'action', glyph: '@', word: 'Did', label: 'Action', prompt: 'What did you do?', prefix: '@ ', ref: 'action', basic: true },
  { kind: 'question', glyph: '?', word: 'Asked', label: 'Oracle question', prompt: 'What are you asking the world?', prefix: '? ', ref: 'question', basic: true },
  { kind: 'dice', glyph: 'd:', word: 'Rolled', label: 'Dice or oracle roll', prompt: 'What did you roll?', prefix: 'd: ', ref: 'dice', basic: true },
  { kind: 'consequence', glyph: '=>', word: 'So', label: 'Consequence', prompt: 'What changed because of it?', prefix: '=> ', ref: 'consequence', basic: true },
  { kind: 'resolution', glyph: '->', word: 'Result', label: 'Resolution', prompt: 'How did it turn out?', prefix: '-> ', ref: 'resolution' },
  { kind: 'tbl', glyph: 'tbl:', word: 'Table', label: 'Table lookup', prompt: 'Which table, and what came up?', prefix: 'tbl: ', ref: 'tbl' },
  { kind: 'gen', glyph: 'gen:', word: 'Generate', label: 'Generator', prompt: 'What did the generator give you?', prefix: 'gen: ', ref: 'gen' },
  { kind: 'note', glyph: '( )', word: 'Note', label: 'Meta note', prompt: 'A note to yourself', prefix: '(note: ', suffix: ')', ref: 'note' },
];

/** The four shown before the bar is expanded (D9). */
export const BASIC_SYMBOLS = SYMBOLS.filter((s) => s.basic);

/**
 * Whether this log already uses a symbol outside the beginner four. If it does,
 * the bar opens expanded — hiding symbols the user has plainly already met would
 * be teaching them nothing and losing them a control.
 * @param {object[]} entries lexed log entries
 */
export function usesAdvancedSymbols(entries = []) {
  const advanced = new Set(SYMBOLS.filter((s) => !s.basic).map((s) => s.kind));
  return entries.some((e) => advanced.has(e.kind));
}

/**
 * Whether the symbol bar is expanded. View state for the life of the page, not
 * a preference — the composer is re-mounted on every commit, so it cannot live
 * in the closure, and it is not worth a schema field (§7 does not apply).
 */
let expanded = false;

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
 *          restore?:()=>Promise<any>, entries?:object[], onRoll?:()=>any}} ctx
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

  // A log that already uses the advanced symbols opens expanded (D9).
  if (usesAdvancedSymbols(ctx.entries ?? [])) expanded = true;

  const bar = el('div', { class: 'symbol-bar', role: 'group', 'aria-label': 'Line type' });

  const moreButton = el('button', {
    class: 'sym sym-more', type: 'button',
    onclick: () => {
      expanded = !expanded;
      // Collapsing while an advanced kind is selected would leave the bar with
      // nothing pressed and the input still expecting that kind.
      if (!expanded && !SYMBOLS.find((s) => s.kind === kind)?.basic) kind = 'action';
      drawBar();
      setKind(kind);
    },
  });

  function drawBar() {
    clear(bar);
    const shown = expanded ? SYMBOLS : BASIC_SYMBOLS;
    for (const s of shown) {
      bar.append(el('button', {
        class: 'sym', type: 'button', title: s.label, 'aria-label': s.label,
        'aria-pressed': s.kind === kind ? 'true' : 'false',
        dataset: { kind: s.kind },
        onclick: () => setKind(s.kind),
      }, [
        el('span', { class: 'sym-glyph', 'aria-hidden': 'true' }, [s.glyph]),
        el('span', { class: 'sym-word', 'aria-hidden': 'true' }, [s.word]),
      ]));
    }
    clear(moreButton);
    moreButton.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    moreButton.setAttribute('aria-label', expanded ? 'Show fewer line types' : 'Show more line types');
    moreButton.append(
      el('span', { class: 'sym-glyph', 'aria-hidden': 'true' }, [expanded ? '−' : '⋯']),
      el('span', { class: 'sym-word', 'aria-hidden': 'true' }, [expanded ? 'Fewer' : 'More']),
    );
    bar.append(moreButton);
  }

  function setKind(next) {
    kind = next;
    for (const b of bar.querySelectorAll('.sym[data-kind]')) {
      b.setAttribute('aria-pressed', b.getAttribute('data-kind') === kind ? 'true' : 'false');
    }
    const symbol = SYMBOLS.find((s) => s.kind === kind);
    input.placeholder = symbol?.prompt ?? symbol?.label ?? 'Line';
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
    ctx.onRoll ? el('button', {
      class: 'btn btn-small', type: 'button', id: 'composer-roll',
      onclick: () => ctx.onRoll(),
    }, ['🎲 Roll']) : null,
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

  drawBar();
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
  const chosenType = 'N';

  // Full words, grouped by where the type comes from: a list of bare codes is a
  // quiz. The notation itself is still shown, because it is what gets written.
  const typeSelect = /** @type {HTMLSelectElement} */ (
    el('select', { class: 'input', id: 'tag-type' },
      groupedTagTypes().map(([group, entries]) => el('optgroup', { label: group },
        entries.map((entry) => el('option', {
          value: entry.type, selected: entry.type === chosenType,
        }, [tagTypeLabel(entry)]))))));

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
