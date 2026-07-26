/**
 * Resolve pane (CLAUDE.md §8 Phase 4).
 *
 * You roll the dice; this pane captures the numbers, labels the outcome, and
 * appends the `d:` / `tbl:` line. **It never rolls for you** (D2) — every number
 * here comes from an input the player filled in.
 *
 * Nothing is required to use it: with no system configured you get free-form
 * roll entry, a generic yes/no oracle and whatever tables your own log defines
 * (D3).
 */

import { el, clear } from './core.js';
import { promptModal, showToast, announce } from './ui.js';
import {
  MODES, ODDS, evaluate, rollLine, resolveOracle, lookup, tableDie,
} from './compare.js';
import { tablesOf } from './lonelog/fold.js';
import { detectRepeats, templateFromShape, applyTemplate, REPEAT_THRESHOLD } from './templates.js';

/** Fields each mode asks for, beyond the dice themselves. */
const MODE_FIELDS = {
  target: ['modifier', 'target', 'compare'],
  pool: ['threshold'],
  paired: ['modifier', 'challenge'],
  keep: ['modifier', 'keep', 'keepWhich', 'target'],
  fudge: ['plus', 'minus', 'modifier', 'target'],
  bands: ['modifier', 'bands'],
};

/**
 * @param {HTMLElement} host
 * @param {object} state folded CampaignState
 * @param {{commit:(lines:string[])=>Promise<any>, entries?:object[],
 *          templates?:object[], onSaveTemplate?:(t:object)=>any,
 *          onDeleteTemplate?:(id:string)=>any,
 *          onExportPack?:()=>any, onImportPack?:()=>any}} ctx
 */
export function renderResolve(host, state, ctx) {
  clear(host);
  const roll = rollPanel(ctx);
  host.append(roll.node, quickRolls(state, ctx, roll.applyPreset), oraclePanel(ctx), tablePanel(state, ctx));
}

/* ------------------------------ roll entry ------------------------------- */

function rollPanel(ctx) {
  let mode = 'target';
  let dice = [''];
  let keepWhich = 'high';
  let compare = '>=';

  const values = { modifier: '', target: '', threshold: '', keep: '1', plus: '', minus: '', challenge: ['', ''] };
  const label = numberish('text', 'What are you rolling?', 'Stealth');
  const body = el('div', { class: 'resolve-body' });
  const preview = el('div', { class: 'preview', role: 'status', 'aria-live': 'polite' });

  const modeSelect = /** @type {HTMLSelectElement} */ (el('select', {
    class: 'input', id: 'roll-mode',
    onchange: () => { mode = modeSelect.value; draw(); },
  }, MODES.map((m) => el('option', { value: m.id, selected: m.id === mode }, [m.label]))));

  function spec() {
    return {
      mode,
      label: label.value,
      dice: dice.map((d) => d),
      modifier: values.modifier,
      target: values.target,
      threshold: values.threshold,
      keep: values.keep,
      keepWhich,
      compare,
      challenge: values.challenge,
      plus: values.plus,
      minus: values.minus,
      bands: DEFAULT_BANDS,
    };
  }

  function ready() {
    if (mode === 'fudge') return values.plus !== '' || values.minus !== '';
    return dice.some((d) => String(d).trim() !== '');
  }

  function draw() {
    clear(body);
    const fields = MODE_FIELDS[mode] ?? [];

    body.append(el('p', { class: 'hint' }, [MODES.find((m) => m.id === mode)?.hint ?? '']));

    if (mode !== 'fudge') body.append(diceRow());

    const row = el('div', { class: 'field-row' });
    if (fields.includes('plus')) row.append(field('Plus faces', numeric('plus')));
    if (fields.includes('minus')) row.append(field('Minus faces', numeric('minus')));
    if (fields.includes('modifier')) row.append(field('Modifier', numeric('modifier')));
    if (fields.includes('threshold')) row.append(field('Success on', numeric('threshold')));
    if (fields.includes('keep')) row.append(field('Keep how many', numeric('keep')));
    if (fields.includes('keepWhich')) row.append(field('Keep', keepSelect()));
    if (fields.includes('target')) row.append(field('Target', numeric('target')));
    if (fields.includes('compare')) row.append(field('Succeeds on', compareSelect()));
    if (fields.includes('challenge')) {
      row.append(field('Challenge 1', challengeInput(0)), field('Challenge 2', challengeInput(1)));
    }
    if (row.childElementCount) body.append(row);

    if (fields.includes('bands')) {
      body.append(el('p', { class: 'hint' }, [
        `House aid: bands are ${DEFAULT_BANDS.map((b) => b.label).join(' / ')} at 10+ / 7–9 / 6−.`,
      ]));
    }

    update();
  }

  function update() {
    clear(preview);
    if (!ready()) {
      preview.append(el('span', { class: 'hint' }, ['Enter what you rolled.']));
      addButton.disabled = true;
      return;
    }
    const s = spec();
    const result = evaluate(s);
    addButton.disabled = false;
    preview.append(
      el('span', { class: 'preview-outcome' }, [result.outcome]),
      el('code', { class: 'preview-line' }, [rollLine(s, result)]),
    );
  }

  function diceRow() {
    const row = el('div', { class: 'dice-row' });
    dice.forEach((value, i) => {
      const input = /** @type {HTMLInputElement} */ (el('input', {
        class: 'input die-input', type: 'text', inputmode: 'numeric', value,
        'aria-label': `Die ${i + 1}`,
        oninput: () => { dice[i] = input.value; update(); },
      }));
      row.append(input);
    });
    row.append(
      el('button', {
        class: 'btn btn-tiny', type: 'button', 'aria-label': 'Add a die',
        onclick: () => { dice.push(''); draw(); },
      }, ['+ die']),
      el('button', {
        class: 'btn btn-tiny', type: 'button', 'aria-label': 'Remove a die',
        disabled: dice.length <= 1,
        onclick: () => { dice.pop(); draw(); },
      }, ['−']),
    );
    return row;
  }

  function numeric(key) {
    const input = /** @type {HTMLInputElement} */ (el('input', {
      class: 'input', type: 'text', inputmode: 'numeric', value: values[key],
      oninput: () => { values[key] = input.value; update(); },
    }));
    return input;
  }

  function challengeInput(i) {
    const input = /** @type {HTMLInputElement} */ (el('input', {
      class: 'input', type: 'text', inputmode: 'numeric', value: values.challenge[i],
      oninput: () => { values.challenge[i] = input.value; update(); },
    }));
    return input;
  }

  function keepSelect() {
    const sel = /** @type {HTMLSelectElement} */ (el('select', {
      class: 'input', onchange: () => { keepWhich = sel.value; update(); },
    }, [
      el('option', { value: 'high', selected: keepWhich === 'high' }, ['highest']),
      el('option', { value: 'low', selected: keepWhich === 'low' }, ['lowest']),
    ]));
    return sel;
  }

  function compareSelect() {
    const sel = /** @type {HTMLSelectElement} */ (el('select', {
      class: 'input', onchange: () => { compare = sel.value; update(); },
    }, [
      el('option', { value: '>=', selected: compare === '>=' }, ['roll at or over']),
      el('option', { value: '<=', selected: compare === '<=' }, ['roll at or under']),
    ]));
    return sel;
  }

  const addButton = /** @type {HTMLButtonElement} */ (el('button', {
    class: 'btn btn-primary', type: 'button', id: 'roll-add', disabled: true,
    onclick: async () => {
      const s = spec();
      await ctx.commit([rollLine(s, evaluate(s))]);
      dice = dice.map(() => '');
      values.challenge = ['', ''];
      values.plus = ''; values.minus = '';
      announce('Roll added to the log.');
      draw();
    },
  }, ['Add to log']));

  label.addEventListener('input', update);
  draw();

  /**
   * Fill the form from a saved template. The dice stay empty — the player still
   * rolls them (D2).
   * @param {object} template
   */
  function applyPreset(template) {
    const preset = applyTemplate(template, {});
    mode = preset.mode;
    modeSelect.value = mode;
    label.value = preset.label ?? '';
    values.target = preset.target == null ? '' : String(preset.target);
    values.threshold = preset.threshold == null ? '' : String(preset.threshold);
    values.modifier = '';
    compare = preset.compare ?? '>=';
    dice = (template.inputs ?? [{}]).map(() => '');
    draw();
    /** @type {HTMLElement|null} */ (body.querySelector('.die-input'))?.focus();
  }

  const node = el('section', { class: 'group' }, [
    el('h2', {}, ['Roll']),
    el('div', { class: 'field-row' }, [
      field('Roll mode', modeSelect, 'roll-mode'),
      field('Label', label),
    ]),
    body,
    preview,
    el('div', { class: 'row' }, [addButton]),
  ]);

  return { node, applyPreset };
}

/* ------------------------------ quick rolls ------------------------------ */

function quickRolls(state, ctx, applyPreset) {
  const saved = ctx.templates ?? [];
  const suggestions = detectRepeats(ctx.entries ?? [], { known: saved.map((t) => t.shape) });
  const section = el('section', { class: 'group', dataset: { panel: 'quick-rolls' } }, [
    el('h2', {}, ['Quick rolls']),
  ]);

  // A repeated shape is offered, never saved behind the player's back (D4).
  for (const repeat of suggestions.slice(0, 3)) {
    section.append(el('div', { class: 'suggestion' }, [
      el('span', { class: 'el-detail' }, [
        `You've rolled ${repeat.shape} ${repeat.count} times.`,
      ]),
      el('button', {
        class: 'btn btn-tiny', type: 'button',
        onclick: () => ctx.onSaveTemplate(templateFromShape(repeat.shape, { count: repeat.count })),
      }, ['Save as quick roll']),
    ]));
  }

  if (!saved.length) {
    section.append(el('p', { class: 'hint' }, [
      suggestions.length
        ? 'Saving one turns it into a one-tap roll. Nothing is saved unless you ask.'
        : `Roll the same shape ${REPEAT_THRESHOLD} times and the app offers to save it. `
          + 'Nothing needs setting up first.',
    ]));
  } else {
    section.append(el('ul', { class: 'plain-list' }, saved.map((template) => el('li', {}, [
      el('button', {
        class: 'btn btn-tiny', type: 'button',
        onclick: () => applyPreset(template),
      }, [template.label]),
      el('span', { class: 'el-detail' }, [template.shape]),
      el('button', {
        class: 'btn btn-tiny', type: 'button',
        onclick: async () => {
          const next = await promptModal('Name this quick roll', {
            title: template.label, value: template.label,
          });
          if (next?.trim()) await ctx.onSaveTemplate({ ...template, label: next.trim() });
        },
      }, ['rename']),
      el('button', {
        class: 'btn btn-tiny btn-quiet', type: 'button',
        onclick: () => ctx.onDeleteTemplate(template.id),
      }, ['remove']),
    ]))));
  }

  section.append(el('div', { class: 'addon-tools' }, [
    saved.length ? el('button', {
      class: 'btn btn-tiny', type: 'button',
      onclick: () => ctx.onExportPack(),
    }, ['Export pack…']) : null,
    el('button', {
      class: 'btn btn-tiny', type: 'button',
      onclick: () => ctx.onImportPack(),
    }, ['Import pack…']),
  ].filter(Boolean)));

  return section;
}

const DEFAULT_BANDS = [
  { min: 10, label: 'Strong Hit' },
  { min: 7, max: 9, label: 'Weak Hit' },
  { max: 6, label: 'Miss' },
];

/* -------------------------------- oracle --------------------------------- */

function oraclePanel(ctx) {
  const question = numberish('text', 'Question for the oracle', 'Does the guard notice me?');
  const roll = /** @type {HTMLInputElement} */ (el('input', {
    class: 'input', type: 'text', inputmode: 'numeric', 'aria-label': 'Your d100 roll',
    oninput: () => update(),
  }));
  const preview = el('div', { class: 'preview', role: 'status', 'aria-live': 'polite' });

  const oddsSelect = /** @type {HTMLSelectElement} */ (el('select', {
    class: 'input', id: 'oracle-odds', onchange: () => update(),
  }, ODDS.map((o) => el('option', { value: o.id, selected: o.id === 'even' }, [o.label]))));

  const add = /** @type {HTMLButtonElement} */ (el('button', {
    class: 'btn btn-primary', type: 'button', id: 'oracle-add', disabled: true,
    onclick: async () => {
      const answered = resolveOracle(oddsSelect.value, Number(roll.value));
      await ctx.commit(answered.line(question.value || 'Oracle question'));
      roll.value = '';
      announce(`Oracle answered ${answered.answer}`);
      update();
    },
  }, ['Add to log']));

  function update() {
    clear(preview);
    const n = Number(roll.value);
    if (!roll.value.trim() || !Number.isFinite(n)) {
      preview.append(el('span', { class: 'hint' }, ['Roll a d100 and enter it.']));
      add.disabled = true;
      return;
    }
    const answered = resolveOracle(oddsSelect.value, n);
    add.disabled = false;
    preview.append(
      el('span', { class: 'preview-outcome' }, [answered.answer]),
      el('code', { class: 'preview-line' }, [`d100=${n} vs ${answered.threshold}`]),
    );
  }

  question.addEventListener('input', update);
  update();

  return el('section', { class: 'group' }, [
    el('h2', {}, ['Oracle']),
    field('Question', question),
    el('div', { class: 'field-row' }, [
      field('Odds', oddsSelect, 'oracle-odds'),
      field('Your d100', roll),
    ]),
    preview,
    el('div', { class: 'row' }, [add]),
    el('p', { class: 'hint' }, [
      'House aid: a plain d100 ladder so the app is usable with nothing set up. '
      + 'If your game has its own oracle, read that table and enter the answer instead.',
    ]),
  ]);
}

/* -------------------------------- tables --------------------------------- */

function tablePanel(state, ctx) {
  const tables = tablesOf(state);

  const define = el('button', {
    class: 'btn btn-small', type: 'button',
    onclick: async () => {
      const name = await promptModal('Table name', { title: 'Define a table', placeholder: 'Forest Encounter' });
      if (!name?.trim()) return;
      const entries = await promptModal(
        'Results, one per line or separated by commas', {
          title: name.trim(),
          placeholder: 'Nothing, Animal tracks, Abandoned camp, Traveler',
        },
      );
      if (!entries?.trim()) return;
      const options = entries.split(/[,\n]/).map((o) => o.trim()).filter(Boolean);
      // Filtered option-set form (core §4.3.2) — self-contained in the log.
      await ctx.commit([`tbl: ${name.trim()} [${options.join(', ')}]`]);
      showToast(`Defined “${name.trim()}” with ${options.length} options.`);
    },
  }, ['Define a table…']);

  if (!tables.length) {
    return el('section', { class: 'group' }, [
      el('h2', {}, ['Tables']),
      el('p', { class: 'empty' }, [
        'No tables yet. Define one and it lives in your log, so the log stays readable on its own.',
      ]),
      el('div', { class: 'row' }, [define]),
    ]);
  }

  return el('section', { class: 'group' }, [
    el('h2', {}, ['Tables']),
    el('ul', { class: 'plain-list' }, tables.map((table) => tableRow(table, ctx))),
    el('div', { class: 'row' }, [define]),
  ]);
}

function tableRow(table, ctx) {
  const die = tableDie(table);
  const size = table.options?.length || table.entries?.length || 0;

  const roll = /** @type {HTMLInputElement} */ (el('input', {
    class: 'input die-input', type: 'text', inputmode: 'numeric',
    'aria-label': `Your ${die ?? 'die'} roll for ${table.name}`,
    oninput: () => update(),
  }));
  const out = el('span', { class: 'el-detail' }, [`${size} results${die ? ` · ${die}` : ''}`]);

  const add = /** @type {HTMLButtonElement} */ (el('button', {
    class: 'btn btn-tiny', type: 'button', disabled: true,
    onclick: async () => {
      const hit = lookup(table, Number(roll.value));
      if (!hit.line) return;
      await ctx.commit([hit.line]);
      roll.value = '';
      announce(`Looked up ${hit.result}`);
      update();
    },
  }, ['Add']));

  function update() {
    const n = Number(roll.value);
    const hit = roll.value.trim() && Number.isFinite(n) ? lookup(table, n) : { result: null };
    clear(out);
    out.append(hit.result ?? `${size} results${die ? ` · ${die}` : ''}`);
    add.disabled = !hit.result;
  }

  return el('li', { class: 'table-row' }, [
    el('span', { class: 'el-name' }, [table.name]),
    out,
    roll,
    add,
  ]);
}

/* ------------------------------- helpers --------------------------------- */

function field(labelText, control, forId) {
  return el('div', { class: 'field' }, [
    el('label', { class: 'field-label', for: forId ?? null }, [labelText]),
    control,
  ]);
}

function numberish(type, ariaLabel, placeholder) {
  return /** @type {HTMLInputElement} */ (el('input', {
    class: 'input', type, placeholder, 'aria-label': ariaLabel, autocomplete: 'off',
  }));
}
