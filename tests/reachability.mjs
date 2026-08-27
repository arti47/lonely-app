/**
 * Reachability audit (CLAUDE.md §11).
 *
 * The question this answers is not "does it work" — `smoke.mjs` asks that — but
 * "can someone who has read nothing find it, and understand what they found?"
 *
 * It drives the real app and reports **every** finding in one run, so the loop
 * is: `npm run audit`, fix what it lists, run it again, until it prints nothing.
 * Once clean it runs inside `npm test`, which is what keeps it clean.
 *
 * What it checks:
 *   R1  every capability the app claims is reachable by clicking, from a cold
 *       start, without typing notation by hand
 *   R2  every control has an accessible name, and a label a stranger can read
 *   R3  a control that opens a dialog says so, and every dialog can be left
 *   R4  every empty state names a control that exists on that screen
 *   R5  no control throws, and none leaves a dialog stuck open
 *   R6  every notation construct the app can write has a control that writes it
 *
 * Probing clicks real controls, so the campaign's log is saved before each one
 * and restored after: a destructive control is safe to test exactly once.
 */

import { launch } from './browser.mjs';

const findings = [];
const finding = (rule, what, detail = '') =>
  findings.push(`${rule}  ${what}${detail ? ` — ${detail}` : ''}`);

/** A log rich enough to surface every panel and every control at once. */
const SEED = [
  '---',
  'title: Audit Campaign',
  '---',
  '',
  '## Session 1',
  '*Date: 2026-07-27 | Duration: 1h*',
  '',
  '### S1 *The docks, after dark*',
  '[PC:Alex|HP 8|Stress 1|Supply d8]',
  '[N:Jonah|friendly]',
  '[L:Harbour|fogbound]',
  '[Thread:Find the ledger|Open]',
  '[Clock:Suspicion 2/6]',
  '[Track:Escape 1/8]',
  '[Timer:Dawn 3]',
  '@ Search the crates',
  'd: Stealth d6=5 vs TN 4 -> Success',
  '=> A shape moves behind me.',
  'tbl: Mood [Tense, Melancholic, Hopeful]',
  '[COMBAT]',
  '[F:Thug|HP 6|Close|armed]',
  'Rd1',
  '@ Swing first',
  '[/COMBAT]',
  '[Inv:Torch|3]',
  '[Inv:Rope|1|frayed]',
  '[Wealth:Gold 52|Silver 8]',
  '[R:1|active|entry cave|exits N:R2]',
  '[Scenario:Hold the bridge|Deny crossing|Turn limit 8]',
  '[Force:Ironclad|Vane|3 units|Hold]',
  '[Unit:Rifles|x12|Morale 8|Fresh]',
  'Tn1',
];

/**
 * Capabilities the app claims (CLAUDE.md §1 mandatory scope, §8 phases), and
 * the visible control that offers each. A capability with no control is a
 * feature only its author can use.
 */
const CAPABILITIES = [
  ['start a campaign', 'campaigns', 'New campaign…'],
  ['open the worked example', 'campaigns-empty', 'Look at an example'],
  ['reach settings', 'campaigns', 'Settings'],
  ['start or end a session', 'log', 'Session…'],
  ['open a scene', 'log', 'Scene…'],
  ['write a line', 'log', 'Add'],
  ['name something with a tag', 'log', 'Tag…'],
  ['record dialogue', 'log', 'Said…'],
  ['record an in-fiction excerpt', 'log', 'Excerpt…'],
  ['open a structural block', 'log', 'Block…'],
  ['roll dice', 'log', '🎲 Roll'],
  ['undo the last entry', 'log', 'Undo'],
  ['see and edit the campaign header', 'log', 'Details…'],
  ['step a character stat', 'state', 'set…'],
  ['add a field to anything', 'state', '+ field…'],
  ['snapshot resources', 'state', 'Snapshot'],
  ['advance a combat round', 'state', 'Round 2'],
  ['take a combat roster', 'state', 'Roster'],
  ['note initiative', 'state', 'Initiative…'],
  ['add a room', 'state', 'New room…'],
  ['write a dungeon status block', 'state', 'Status block'],
  ['advance a wargame turn', 'state', 'Turn 2'],
  ['pick a wargame phase', 'state', 'Phase…'],
  ['write a campaign block', 'state', 'Campaign block'],
  ['add an inventory item', 'state', 'Add item…'],
  ['define a table', 'resolve', 'Define a table…'],
  ['import a roll pack', 'resolve', 'Import pack…'],
  ['read the how-to guide', 'reference', 'Expand all'],
  ['export a backup', 'settings', 'Export JSON backup'],
  ['import a backup', 'settings', 'Import JSON backup'],
  ['export markdown', 'settings', 'Export all as markdown'],
  ['import markdown', 'settings', 'Import markdown'],
  ['check for updates', 'settings', 'Check for updates'],
];

/**
 * Notation this app writes for you. Each must have a control — the whole point
 * is that nobody has to learn the brackets to use the thing (§1, D9).
 */
const WRITABLE_NOTATION = [
  ['@ action', 'log', '@'],
  ['? oracle question', 'log', '?'],
  ['d: roll', 'log', 'd:'],
  ['=> consequence', 'log', '=>'],
  ['-> resolution', 'log', '->'],
  ['tbl: table', 'log', 'tbl:'],
  ['gen: generator', 'log', 'gen:'],
  ['( ) meta note', 'log', '( )'],
];

/** Symbols and shorthand a stranger cannot be expected to read unaided. */
const JARGON = /\[|\]|=>|->|\btbl:|\bgen:|\bRd\d|\bTn\d|\bd:|\bPC\b|\bNPC\b|x\d/;

/** Labels that are a glyph or an abbreviation, so must carry a spoken name. */
const NEEDS_SPOKEN_NAME = /^[^A-Za-z0-9]*$|^[−+×✓]|^-?\d|^[a-z]{1,3}$/;

const app = await launch({ hash: '#/campaigns' });
if (!app) {
  console.log('# no chromium binary found; skipping reachability audit');
  console.log('# set CHROME_PATH to enable it');
  process.exit(0);
}

const { s, base, consoleErrors, close } = app;

try {
  /* ---------------------------------------------------------------- setup */

  const id = await s.evaluate(`(async () => {
    const store = await import('${base}/src/store.js');
    for (const c of await store.campaigns.all()) await store.campaigns.remove(c.id);
    const c = await store.campaigns.create('Audit Campaign');
    c.log = ${JSON.stringify(SEED)};
    await store.campaigns.put(c);
    return c.id;
  })()`);

  const HASHES = {
    'campaigns-empty': '#/campaigns',
    campaigns: '#/campaigns',
    log: `#/log/${id}`,
    state: `#/state/${id}`,
    resolve: `#/resolve/${id}`,
    reference: '#/reference',
    settings: '#/settings',
  };

  /** Labels of every control on a screen, dialogs excluded. */
  const controlsOn = async (screen) => {
    if (screen === 'campaigns-empty') {
      await s.evaluate(`(async () => {
        const store = await import('${base}/src/store.js');
        for (const c of await store.campaigns.all()) await store.campaigns.remove(c.id);
      })()`);
      await s.goto('#/reference');
      await s.goto('#/campaigns', 450);
    } else {
      await restoreSeed();
      await s.goto(HASHES[screen], 450);
    }
    return s.evaluate(`[...document.querySelectorAll('#screen button, #screen a[href], .nav a')]
      .map(b => (b.textContent || '').trim()).filter(Boolean)`);
  };

  const restoreSeed = async () => {
    await s.evaluate(`(async () => {
      const store = await import('${base}/src/store.js');
      let c = await store.campaigns.get('${id}');
      if (!c) { c = await store.campaigns.create('Audit Campaign'); }
      c.id = '${id}';
      c.log = ${JSON.stringify(SEED)};
      c.view = { hiddenPanels: [], composerMode: 'symbols', checklist: 'auto' };
      await store.campaigns.put(c);
    })()`);
  };

  /* ------------------------------------------------- R1 · capabilities */

  const screenControls = {};
  for (const screen of Object.keys(HASHES)) {
    screenControls[screen] = await controlsOn(screen);
  }

  for (const [what, screen, label] of CAPABILITIES) {
    const labels = screenControls[screen] ?? [];
    const found = labels.some((l) => l === label || l.includes(label));
    if (!found) finding('R1', `no control to ${what}`, `expected “${label}” on ${screen}`);
  }

  /* --------------------------------------------- R6 · writable notation */

  await s.goto(HASHES.log, 400);
  const symbolWords = await s.evaluate(`(async () => {
    const shown = () => [...document.querySelectorAll('#screen .sym[data-kind]')];
    if (shown().length < 8) {
      document.querySelector('.sym-more')?.click();
      await new Promise(r => setTimeout(r, 250));
    }
    return shown().map(b => ({
      glyph: b.querySelector('.sym-glyph')?.textContent?.trim(),
      word: b.querySelector('.sym-word')?.textContent?.trim(),
    }));
  })()`);

  for (const [what, , glyph] of WRITABLE_NOTATION) {
    const match = symbolWords.find((sw) => sw.glyph === glyph);
    if (!match) finding('R6', `no control writes ${what}`, `no button for “${glyph}”`);
    else if (!match.word) finding('R6', `the ${what} button is a bare symbol`, glyph);
  }

  /* --------------------------------- R2 · every control reads as English */

  // A symbol button is the notation *with* its word beside it, which is the
  // whole of D9; it is exempt, and R6 above checks the word is really there.
  const symbolLabels = new Set(symbolWords.map((sw) => `${sw.glyph}${sw.word}`));
  for (const [screen, labels] of Object.entries(screenControls)) {
    for (const label of new Set(labels)) {
      if (symbolLabels.has(label)) continue;
      if (JARGON.test(label)) {
        finding('R2', `“${label}” on ${screen} is notation a stranger cannot read`);
      }
    }
  }

  const unnamed = await s.evaluate(`(async () => {
    const problems = [];
    const routes = ${JSON.stringify(Object.entries(HASHES).filter(([k]) => k !== 'campaigns-empty'))};
    const name = (e) => (
      e.getAttribute('aria-label')
      || (e.id && document.querySelector('label[for="' + e.id + '"]')?.textContent)
      || e.closest('label')?.textContent
      || e.title
      || e.textContent
    );
    for (const [, hash] of routes) {
      location.hash = hash;
      await new Promise(r => setTimeout(r, 320));
      for (const c of document.querySelectorAll('#screen button, #screen input, #screen select, #screen a[href]')) {
        const spoken = String(name(c) ?? '').trim();
        const visible = (c.textContent || '').trim();
        if (!spoken) problems.push([hash, 'unnamed', c.className]);
        // A glyph-only or abbreviated label must be spoken in full somewhere.
        else if (visible && ${NEEDS_SPOKEN_NAME}.test(visible)
                 && !c.getAttribute('aria-label') && !c.title) {
          problems.push([hash, 'glyph with no spoken name', visible]);
        }
      }
    }
    return problems;
  })()`);
  for (const [hash, why, detail] of unnamed) finding('R2', `${why} on ${hash}`, detail);

  /* ------------------------------- R4 · empty states name a real control */

  const EMPTY_STATES = [
    ['#/campaigns', 'New campaign…'],
    [`#/log/${id}`, '@ Did'],
    [`#/state/${id}`, 'Tag…'],
  ];
  await s.evaluate(`(async () => {
    const store = await import('${base}/src/store.js');
    const c = await store.campaigns.get('${id}');
    c.log = [];
    await store.campaigns.put(c);
  })()`);
  for (const [hash, mustName] of EMPTY_STATES) {
    const empty = await s.evaluate(`(location.hash = ${JSON.stringify(hash)},
      new Promise(r => setTimeout(r, 400))).then(() => ({
        text: [...document.querySelectorAll('#screen .empty')].map(e => e.textContent).join(' '),
        controls: [...document.querySelectorAll('#screen button')].map(b => b.textContent.trim()),
      }))`);
    if (!empty.text.trim()) {
      if (hash !== '#/campaigns') finding('R4', `${hash} has no empty state at all`);
      continue;
    }
    if (!empty.text.includes(mustName)) {
      finding('R4', `the empty state on ${hash} never names “${mustName}”`, empty.text.slice(0, 90));
    }
  }
  await restoreSeed();

  /* ---------------------- R3 / R5 · probe every control, restoring state */

  const PROBE_SCREENS = ['log', 'state', 'resolve', 'settings', 'reference', 'campaigns'];
  for (const screen of PROBE_SCREENS) {
    await restoreSeed();
    await s.goto(HASHES[screen], 400);

    const count = await s.evaluate("document.querySelectorAll('#screen button').length");
    for (let i = 0; i < count; i++) {
      const probe = await s.evaluate(`(async () => {
        const buttons = [...document.querySelectorAll('#screen button')];
        const button = buttons[${i}];
        if (!button || button.disabled) return { skipped: true };
        const label = (button.textContent || '').trim();
        // A file picker would block the run on a native dialog.
        if (/Import|Export|Bind to file|Save to file/i.test(label)) return { skipped: true, label };
        let threw = null;
        try { button.click(); } catch (e) { threw = String(e && e.message || e); }
        await new Promise(r => setTimeout(r, 260));
        const modal = document.querySelector('.modal');
        const named = (e) => (
          e.getAttribute('aria-label')
          || (e.id && document.querySelector('label[for="' + e.id + '"]')?.textContent)
          || e.closest('label')?.textContent
          || e.title
          || e.textContent
        );
        const inside = modal ? {
          controls: modal.querySelectorAll('button, input, select, textarea').length,
          hasPrimary: !!modal.querySelector('.modal-actions .btn-primary'),
          unnamed: [...modal.querySelectorAll('button, input, select, textarea')]
            .filter(e => !String(named(e) ?? '').trim())
            .map(e => e.tagName.toLowerCase() + '.' + (e.className || '?')),
          emptySelects: [...modal.querySelectorAll('select')]
            .filter(sel => sel.options.length === 0)
            .map(sel => sel.id || sel.className || 'select'),
        } : null;
        const info = {
          label,
          threw,
          inside,
          openedDialog: !!modal,
          dialogLabelled: modal ? (modal.getAttribute('aria-modal') === 'true'
            && !!modal.getAttribute('aria-labelledby')) : null,
          closable: modal ? [...modal.querySelectorAll('.modal-actions .btn')]
            .some(b => /cancel|close|done/i.test(b.textContent)) : null,
        };
        if (modal) {
          const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
          document.dispatchEvent(escape);
          await new Promise(r => setTimeout(r, 200));
          info.escapes = !document.querySelector('.modal');
          if (!info.escapes) {
            const out = [...document.querySelectorAll('.modal-actions .btn')]
              .find(b => /cancel|close|done/i.test(b.textContent));
            out?.click();
            await new Promise(r => setTimeout(r, 200));
          }
        }
        return info;
      })()`);

      if (probe.skipped) continue;
      if (probe.threw) finding('R5', `“${probe.label}” on ${screen} threw`, probe.threw);

      if (probe.openedDialog && probe.inside) {
        // R9: the dialog's own contents. Most of what the app can do lives
        // behind a dialog, and until now nothing looked inside one.
        for (const trouble of probe.inside.unnamed) {
          finding('R9', `a control in the “${probe.label}” dialog has no name`, trouble);
        }
        for (const trouble of probe.inside.emptySelects) {
          finding('R9', `a chooser in the “${probe.label}” dialog offers nothing`, trouble);
        }
        if (probe.inside.controls === 0) {
          finding('R9', `the “${probe.label}” dialog has no controls at all`);
        }
        if (!probe.inside.hasPrimary) {
          finding('R9', `the “${probe.label}” dialog has no primary action`);
        }
      }

      if (probe.openedDialog) {
        if (!probe.dialogLabelled) finding('R3', `the dialog from “${probe.label}” is not labelled`);
        if (!probe.closable) finding('R3', `the dialog from “${probe.label}” offers no way out`);
        if (probe.escapes === false) finding('R3', `the dialog from “${probe.label}” ignores Escape`);
        const wordy = /[A-Za-z]{2,}/.test(probe.label);
        if (wordy && !/…$|^Delete$/.test(probe.label)) {
          finding('R3', `“${probe.label}” on ${screen} opens a dialog without saying so`,
            'end the label with … so a tap is not a surprise');
        }
      }

      // Whatever it did, the screen must still be there.
      const alive = await s.evaluate(`!!document.querySelector('#screen h1, #screen .screen-head')`);
      if (!alive) finding('R5', `“${probe.label}” on ${screen} left no screen behind`);
      await restoreSeed();
      await s.goto(HASHES[screen], 320);
    }
  }

  /* ------------- R7 · the cold start: first launch to a logged line ------- */

  // Wipe everything the app remembers, then reload: this is someone opening it
  // for the first time, having read nothing.
  await s.evaluate(`(async () => {
    const store = await import('${base}/src/store.js');
    for (const c of await store.campaigns.all()) await store.campaigns.remove(c.id);
    await store.settings.set('seenGuide', false);
    await store.settings.set('lastCampaign', null);
    await store.settings.set('notationView', 'guide');
  })()`);
  await s.send('Page.navigate', { url: `${base}/index.html` });
  await s.evaluate(`new Promise((resolve, reject) => {
    const start = Date.now();
    const done = () => {
      if (document.body && document.body.dataset.booted === 'true') return resolve(true);
      if (Date.now() - start > 10000) return reject(new Error('never booted'));
      setTimeout(done, 50);
    };
    done();
  })`);
  await s.wait(400);

  const landing = await s.evaluate('location.hash');
  if (landing !== '#/reference') {
    finding('R7', 'a first launch does not land on the guide', landing);
  }

  const journey = await s.evaluate(`(async () => {
    const steps = [];
    const step = (name, ok, detail = '') => steps.push({ name, ok, detail });
    const click = async (label, scope = document) => {
      const b = [...scope.querySelectorAll('button')].find(x => x.textContent.trim() === label);
      if (!b) return false;
      b.click();
      await new Promise(r => setTimeout(r, 400));
      return true;
    };

    step('the guide offers a way to start', await click('Start my first campaign'));
    step('that lands on the campaign list', location.hash === '#/campaigns', location.hash);

    step('the empty list offers a new campaign', await click('New campaign…'));
    const nameField = document.querySelector('.modal input');
    step('it asks for a name', !!nameField);
    if (nameField) {
      nameField.value = 'First Game';
      nameField.dispatchEvent(new Event('input', { bubbles: true }));
      const ok = [...document.querySelectorAll('.modal-actions .btn')]
        .find(b => /ok|create|save|add/i.test(b.textContent));
      (ok ?? document.querySelector('.modal-actions .btn-primary'))?.click();
      await new Promise(r => setTimeout(r, 600));
    }
    step('naming it opens the play screen', location.hash.startsWith('#/log/'), location.hash);

    step('the play screen says what to do first',
      !!document.querySelector('#screen .checklist'),
      'no getting-started checklist');
    step('the first line type is already chosen',
      document.querySelector('#screen .sym[aria-pressed="true"]')?.textContent?.includes('Did') ?? false);

    const input = document.querySelector('#composer-input');
    const placeholder = input?.placeholder ?? '';
    step('the composer asks a question rather than showing notation',
      placeholder.endsWith('?') && !placeholder.includes('[') && !placeholder.includes('@'),
      placeholder);
    if (input) {
      input.value = 'Push open the door';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await click('Add');
    }
    step('the line lands in the log',
      document.querySelectorAll('#screen .log-row').length === 1,
      String(document.querySelectorAll('#screen .log-row').length));

    const before = document.querySelectorAll('#screen .log-row').length;
    step('rolling is reachable from play', await click('🎲 Roll'));
    const die = document.querySelector('.modal-sheet .die-input');
    step('the roll panel asks for the number you rolled', !!die);
    if (die) {
      die.value = '5';
      die.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
    }
    // A bare number is not a result. The pane must say what is missing rather
    // than leaving a dead button (core §3.2.1).
    const add = document.querySelector('.modal-sheet #roll-add');
    const hint = document.querySelector('.modal-sheet .preview')?.textContent ?? '';
    step('a roll with nothing to compare says what is missing',
      add?.disabled === true && /target|meant/i.test(hint), hint);

    const outcome = document.querySelector('.modal-sheet #roll-outcome');
    step('and offers somewhere to say what it meant', !!outcome);
    if (outcome) {
      outcome.value = 'It swings open';
      outcome.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
      document.querySelector('.modal-sheet #roll-add')?.click();
      await new Promise(r => setTimeout(r, 600));
    }
    step('the roll then lands in the log and closes the panel',
      !document.querySelector('.modal-sheet')
        && document.querySelectorAll('#screen .log-row').length === before + 1,
      String(document.querySelectorAll('#screen .log-row').length));

    return steps;
  })()`);

  for (const step of journey) {
    if (!step.ok) finding('R7', step.name, step.detail);
  }

  /* --------------------- R8 · every surfaced panel can explain itself ----- */

  await restoreSeed();
  await s.goto(HASHES.state, 500);
  const panels = await s.evaluate(`[...document.querySelectorAll('#screen .addon')].map(p => ({
    id: p.dataset.addon,
    explains: !!p.querySelector('.ref-btn'),
    heading: p.querySelector('h2')?.textContent,
  }))`);
  if (!panels.length) finding('R8', 'the seeded log surfaced no add-on panel at all');
  for (const panel of panels) {
    if (!panel.explains) finding('R8', `the ${panel.id} panel offers no link to what its notation means`);
  }

  if (consoleErrors.length) finding('R5', 'console errors during the audit', consoleErrors.join(' | '));
} finally {
  await close();
}

if (findings.length) {
  console.log(`\n${findings.length} reachability finding(s):\n`);
  for (const f of findings) console.log(`  ${f}`);
  console.log('\nfix these, then run `npm run audit` again.');
  process.exit(1);
}

console.log('reachability audit: nothing unreachable, nothing unlabelled');
