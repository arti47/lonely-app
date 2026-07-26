/**
 * Browser smoke test (CLAUDE.md §9.4 — "syntax is valid" is not verification).
 *
 * Boots the real app in headless Chromium over the DevTools Protocol and
 * asserts: every screen renders, zero console errors, no horizontal overflow at
 * 360px and 390px, and the notation engine folds a real log in the page.
 *
 * Uses Node's built-in WebSocket and a built-in static server, so `npm test`
 * needs no installed dependencies.
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].filter(Boolean);

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.md': 'text/markdown',
};

function findChrome() {
  for (const p of CHROME_CANDIDATES) if (existsSync(p)) return p;
  // Glob the pw-browsers dir for any chrome binary.
  return null;
}

function serve() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let p = normalize(join(root, decodeURIComponent(url.pathname)));
      if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
      if (url.pathname === '/' || url.pathname.endsWith('/')) p = join(p, 'index.html');
      const body = await readFile(p);
      res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function waitForJson(url, attempts = 100) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`DevTools endpoint never came up: ${url}`);
}

class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
      }, 20000);
    });
  }

  /** Resolve when a CDP event arrives, or reject on timeout. */
  once(method, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.ws.removeEventListener('message', onMessage);
        reject(new Error(`${method} never fired`));
      }, timeout);
      const onMessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.method !== method) return;
        clearTimeout(timer);
        this.ws.removeEventListener('message', onMessage);
        resolve(msg.params);
      };
      this.ws.addEventListener('message', onMessage);
    });
  }

  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'page threw');
    return r.result.value;
  }
}

const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) console.log(`ok   ${name}`);
  else { console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); failures.push(name); }
};

const chrome = findChrome();
if (!chrome) {
  console.log('# no chromium binary found; skipping browser smoke test');
  console.log('# set CHROME_PATH to enable it');
  process.exit(0);
}

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), 'lonely-smoke-'));
const port = 9222 + (process.pid % 500);

const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-dev-shm-usage', '--hide-scrollbars',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
  'about:blank',
], { stdio: 'ignore' });

let ws;
try {
  await waitForJson(`http://127.0.0.1:${port}/json/version`);
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })).json();

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('devtools socket failed')), { once: true });
  });

  const s = new Session(ws);
  await s.send('Runtime.enable');
  await s.send('Log.enable');
  await s.send('Page.enable');

  const consoleErrors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      consoleErrors.push(m.params.entry.text);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(m.params.exceptionDetails.exception?.description ?? 'uncaught exception');
    }
  });

  await s.send('Emulation.setDeviceMetricsOverride', {
    width: 360, height: 780, deviceScaleFactor: 1, mobile: true,
  });

  const loaded = s.once('Page.loadEventFired');
  await s.send('Page.navigate', { url: `${base}/index.html#/campaigns` });
  await loaded;
  await s.evaluate(`new Promise((resolve, reject) => {
    const start = Date.now();
    const done = () => {
      if (document.body && document.body.dataset.booted === 'true') return resolve(true);
      if (Date.now() - start > 10000) return reject(new Error('app never set data-booted'));
      setTimeout(done, 50);
    };
    done();
  })`);

  check('app boots', await s.evaluate('document.body.dataset.booted === "true"'));
  check('nav renders four tabs', await s.evaluate('document.querySelectorAll("[data-nav]").length') === 4);
  check('campaigns screen renders', (await s.evaluate('document.querySelector("#screen h1")?.textContent')) === 'Campaigns');

  // F1: the tabs that need a campaign are not offered before there is one.
  const navBefore = await s.evaluate(`[...document.querySelectorAll('[data-nav]')]
    .filter(a => !a.hidden).map(a => a.dataset.nav)`);
  check('Play and Sheet are hidden until a campaign is open',
    navBefore.join(',') === 'campaigns,reference', JSON.stringify(navBefore));

  check('Settings is reachable from Campaigns now that it has no tab',
    await s.evaluate(`[...document.querySelectorAll('#screen .screen-head button')]
      .some(b => b.textContent === 'Settings')`));

  // Create a campaign directly through the store, then exercise every screen.
  const created = await s.evaluate(`(async () => {
    const store = await import('${base}/src/store.js');
    const c = await store.campaigns.create('Smoke Campaign');
    c.log = [
      'S1 *Dark alley, midnight*',
      '@ Sneak past the guard',
      'd: Stealth d6=5 vs TN 4 -> Success',
      '=> I slip by unnoticed. [PC:Alex|HP 8] [N:Guard|watchful]',
      '[COMBAT]',
      '[F:Thugx2|HP 6 each|Close]',
      'Rd1',
      '@ Slash at Thug A',
      '=> [F:Thugx1]',
      '[/COMBAT]',
      '[Inv:Torch|3]',
    ];
    await store.campaigns.put(c);
    return c.id;
  })()`);
  check('campaign persists to IndexedDB', typeof created === 'string' && created.length > 0);

  for (const [route, heading] of [['log', 'Smoke Campaign'], ['state', 'Sheet'], ['resolve', 'Roll'], ['settings', 'Settings']]) {
    const id = route === 'settings' ? '' : `/${created}`;
    await s.evaluate(`(location.hash = '#/${route}${id}', new Promise(r => setTimeout(r, 250)))`);
    const got = await s.evaluate('document.querySelector("#screen h1")?.textContent');
    check(`${route} screen renders`, got === heading, `saw ${JSON.stringify(got)}`);
  }

  await s.evaluate(`(location.hash = '#/state/${created}', new Promise(r => setTimeout(r, 250)))`);
  const groups = await s.evaluate('[...document.querySelectorAll("#screen .group h2")].map(h => h.textContent)');
  check('core types group under named sections and add-on types get their own panel',
    ['Character', 'People & places', 'Combat', 'Resources'].every((t) => groups.includes(t)),
    `saw ${JSON.stringify(groups)}`);

  // --- Phase 2: compose a session through the real UI ---
  await s.evaluate(`(location.hash = '#/log/${created}', new Promise(r => setTimeout(r, 250)))`);

  const rowCount = () => s.evaluate('document.querySelectorAll("#screen .log-row").length');
  const before = await rowCount();
  check('log renders one row per line', before === 11, `saw ${before}`);

  // F3: opening a row to read it must not put deletion under the focused button.
  await s.evaluate(`(document.querySelector('#screen .log-row').click(),
    new Promise(r => setTimeout(r, 250)))`);
  const rowMenu = await s.evaluate(`(() => ({
    actions: [...document.querySelectorAll('.modal-actions .btn')].map(b => b.textContent),
    primary: document.querySelector('.modal-actions .btn-primary')?.textContent,
    focused: document.activeElement?.textContent,
  }))()`);
  check('the row menu defaults to a safe action, not truncation',
    rowMenu.primary === 'Close' && rowMenu.focused === 'Close'
      && rowMenu.actions[rowMenu.actions.length - 1] === 'Delete from here…',
    JSON.stringify(rowMenu));
  await s.evaluate(`([...document.querySelectorAll('.modal-actions .btn')]
    .find(b => b.textContent === 'Close')).click()`);
  await s.evaluate('new Promise(r => setTimeout(r, 200))');
  check('closing the row menu leaves the log untouched', (await rowCount()) === before);

  // The gutter must not repeat the symbol the line already starts with.
  const rowText = await s.evaluate(`(() => {
    const row = [...document.querySelectorAll('#screen .log-row')]
      .find(r => r.dataset.kind === 'action');
    return {
      gutter: row.querySelector('.log-num')?.textContent,
      text: row.querySelector('.log-text').textContent,
      full: row.textContent,
    };
  })()`);
  check('a line is not prefixed with a duplicate of its own symbol',
    rowText.text.startsWith('@ ') && !/^@\s*@/.test(rowText.text)
      && (rowText.full.match(/@/g) || []).length === 1,
    JSON.stringify(rowText));
  check('the gutter shows the line number the State pane refers to',
    /^\d+$/.test(rowText.gutter ?? ''), JSON.stringify(rowText.gutter));

  // F2: four labelled symbols, the rest one tap away (D9).
  const symbols = await s.evaluate(`[...document.querySelectorAll('#screen .sym[data-kind]')]
    .map(b => [b.dataset.kind, b.querySelector('.sym-glyph')?.textContent, b.querySelector('.sym-word')?.textContent])`);
  check('composer opens with the four beginner symbols, each carrying its word',
    symbols.length === 4
      && symbols.every(([, glyph, word]) => glyph?.trim() && word?.trim())
      && symbols.map(([kind]) => kind).join(',') === 'action,question,dice,consequence',
    JSON.stringify(symbols));

  await s.evaluate(`(document.querySelector('#screen .sym-more').click(),
    new Promise(r => setTimeout(r, 150)))`);
  check('More reveals every symbol',
    await s.evaluate('document.querySelectorAll("#screen .sym[data-kind]").length') === 8);
  await s.evaluate(`(document.querySelector('#screen .sym-more').click(),
    new Promise(r => setTimeout(r, 150)))`);
  check('Fewer collapses back to the beginner set',
    await s.evaluate('document.querySelectorAll("#screen .sym[data-kind]").length') === 4);

  // Type into the composer and commit with Enter, as a player would.
  await s.evaluate(`(() => {
    const input = document.querySelector('#composer-input');
    input.value = 'Climb the fire escape';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  })()`);
  await s.evaluate('new Promise(r => setTimeout(r, 350))');

  const after = await rowCount();
  check('composer appends a line', after === before + 1, `${before} -> ${after}`);

  const lastLine = await s.evaluate(`(async () => {
    const store = await import('${base}/src/store.js');
    const c = await store.campaigns.get('${created}');
    return c.log[c.log.length - 1];
  })()`);
  check('committed line carries its symbol', lastLine === '@ Climb the fire escape', JSON.stringify(lastLine));

  // Undo pops it again.
  await s.evaluate(`([...document.querySelectorAll('#screen .composer-tools .btn')]
    .find(b => b.textContent === 'Undo')).click()`);
  await s.evaluate('new Promise(r => setTimeout(r, 350))');
  check('undo removes the last line', await rowCount() === before);

  const persisted = await s.evaluate(`(async () => {
    const store = await import('${base}/src/store.js');
    const c = await store.campaigns.get('${created}');
    return c.log.length;
  })()`);
  check('undo persists to storage', persisted === 11, `saw ${persisted}`);

  // Export and reimport must fold identically (First Session Logged).
  const identical = await s.evaluate(`(async () => {
    const store = await import('${base}/src/store.js');
    const { lex } = await import('${base}/src/lonelog/lexer.js');
    const { fold } = await import('${base}/src/lonelog/fold.js');
    const norm = (st) => JSON.stringify(st, (k, v) =>
      v instanceof Map ? { m: [...v.entries()] } : v instanceof Set ? { s: [...v].sort() } : v);
    const c = await store.campaigns.get('${created}');
    const md = store.toMarkdown(c);
    const back = store.fromMarkdown(md, c.meta.title);
    return norm(fold(lex(back.log.join('\\n')))) === norm(fold(lex(c.log.join('\\n'))));
  })()`);
  check('export/reimport folds identically', identical === true);

  // --- Phase 3: the State pane is a live view onto the fold ---
  await s.evaluate(`(location.hash = '#/state/${created}', new Promise(r => setTimeout(r, 300)))`);

  check('state header renders on the State pane',
    await s.evaluate('!!document.querySelector("#screen .state-header")'));
  check('character sheet is derived from [PC:] tags',
    await s.evaluate('document.querySelector("#screen .sheet-name")?.textContent') === 'Alex');
  check('PC stats render as steppable values',
    await s.evaluate('document.querySelectorAll("#screen .stat").length') >= 1);

  // Add a clock through the log, then step it from the State pane.
  await s.evaluate(`(async () => {
    const store = await import('${base}/src/store.js');
    const c = await store.campaigns.get('${created}');
    c.log.push('[Clock:Suspicion 3/6]');
    await store.campaigns.put(c);
  })()`);
  await s.evaluate(`(location.hash = '#/log/${created}', new Promise(r => setTimeout(r, 200)))`);
  await s.evaluate(`(location.hash = '#/state/${created}', new Promise(r => setTimeout(r, 300)))`);

  check('clocks render a fill meter',
    await s.evaluate('document.querySelectorAll("#screen .meter-bar").length') === 1);

  const linesBefore = await s.evaluate(`(async () => {
    const store = await import('${base}/src/store.js');
    return (await store.campaigns.get('${created}')).log.length;
  })()`);

  await s.evaluate(`(() => {
    const meter = document.querySelector('#screen .meter');
    [...meter.querySelectorAll('.btn-tiny')].find(b => b.textContent === '+').click();
  })()`);
  await s.evaluate('new Promise(r => setTimeout(r, 350))');

  const edit = await s.evaluate(`(async () => {
    const store = await import('${base}/src/store.js');
    const c = await store.campaigns.get('${created}');
    return { n: c.log.length, last: c.log[c.log.length - 1] };
  })()`);
  check('editing state appends a tag line to the log',
    edit.n === linesBefore + 1 && edit.last === '[Clock:Suspicion 4/6]', JSON.stringify(edit));
  check('the stepped meter re-renders from the fold',
    (await s.evaluate('document.querySelector("#screen .meter-head .stat-trace")?.textContent')) === '4/6');

  // Traceability: a value links back to the line that set it.
  await s.evaluate(`(() => document.querySelector('#screen .stat-trace').click())()`);
  await s.evaluate('new Promise(r => setTimeout(r, 300))');
  check('a state value traces back into the log',
    /^#\/log\//.test(await s.evaluate('location.hash'))
      && await s.evaluate('!!document.querySelector("#screen .log-row.is-focused")'),
    await s.evaluate('location.hash'));

  // --- Phase 4: the Resolve pane captures rolls but never makes them ---
  await s.evaluate(`(location.hash = '#/resolve/${created}', new Promise(r => setTimeout(r, 300)))`);

  check('resolve pane offers every comparison mode',
    await s.evaluate('document.querySelectorAll("#roll-mode option").length') === 6);
  check('resolve pane shows the oracle odds ladder',
    await s.evaluate('document.querySelectorAll("#oracle-odds option").length') === 5);
  check('the add button is disabled until a number is entered',
    await s.evaluate('document.querySelector("#roll-add").disabled') === true);

  const linesBeforeRoll = await s.evaluate(`(async () => {
    const store = await import('${base}/src/store.js');
    return (await store.campaigns.get('${created}')).log.length;
  })()`);

  // Enter a die and a target, exactly as a player would after rolling.
  await s.evaluate(`(() => {
    const set = (elm, v) => {
      elm.value = v;
      elm.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(document.querySelector('#screen .die-input'), '5');
    const fields = [...document.querySelectorAll('#screen .field .input')];
    const target = fields.find(f => f.previousElementSibling?.textContent === 'Target');
    set(target, '4');
  })()`);
  await s.evaluate('new Promise(r => setTimeout(r, 200))');

  check('the outcome is previewed before committing',
    (await s.evaluate('document.querySelector("#screen .preview-outcome")?.textContent')) === 'Success');

  await s.evaluate('document.querySelector("#roll-add").click()');
  await s.evaluate('new Promise(r => setTimeout(r, 350))');

  const rollAdded = await s.evaluate(`(async () => {
    const store = await import('${base}/src/store.js');
    const c = await store.campaigns.get('${created}');
    return { n: c.log.length, last: c.log[c.log.length - 1] };
  })()`);
  check('a roll appends a d: line carrying its comparison',
    rollAdded.n === linesBeforeRoll + 1 && /^d: .*5=5 vs TN 4 -> Success$/.test(rollAdded.last),
    JSON.stringify(rollAdded));

  // Oracle: enter the d100 the player rolled.
  await s.evaluate(`(() => {
    const inputs = [...document.querySelectorAll('#screen .field .input')];
    const roll = inputs.find(f => f.previousElementSibling?.textContent === 'Your d100');
    roll.value = '20';
    roll.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await s.evaluate('new Promise(r => setTimeout(r, 200))');
  await s.evaluate('document.querySelector("#oracle-add").click()');
  await s.evaluate('new Promise(r => setTimeout(r, 350))');

  const oracleAdded = await s.evaluate(`(async () => {
    const store = await import('${base}/src/store.js');
    const c = await store.campaigns.get('${created}');
    return c.log.slice(-2);
  })()`);
  check('the oracle appends a question and its roll',
    /^\? /.test(oracleAdded[0]) && /^d: d100=20 vs 50 -> Yes/.test(oracleAdded[1]),
    JSON.stringify(oracleAdded));

  // A table defined in the log becomes usable in the pane (T5/T6).
  await s.evaluate(`(async () => {
    const store = await import('${base}/src/store.js');
    const c = await store.campaigns.get('${created}');
    c.log.push('tbl: Mood [Tense, Melancholic, Hopeful, Uncanny]');
    await store.campaigns.put(c);
  })()`);
  await s.evaluate(`(location.hash = '#/log/${created}', new Promise(r => setTimeout(r, 200)))`);
  await s.evaluate(`(location.hash = '#/resolve/${created}', new Promise(r => setTimeout(r, 300)))`);

  check('a table defined in the log appears in the Resolve pane',
    (await s.evaluate('document.querySelector("#screen .table-row .el-name")?.textContent')) === 'Mood');

  await s.evaluate(`(() => {
    const input = document.querySelector('#screen .table-row .die-input');
    input.value = '2';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await s.evaluate('new Promise(r => setTimeout(r, 200))');
  check('the table resolves the entered roll',
    (await s.evaluate('document.querySelector("#screen .table-row .el-detail")?.textContent')) === 'Melancholic');

  await s.evaluate(`([...document.querySelectorAll('#screen .table-row .btn-tiny')]
    .find(b => b.textContent === 'Add')).click()`);
  await s.evaluate('new Promise(r => setTimeout(r, 350))');
  const tableAdded = await s.evaluate(`(async () => {
    const store = await import('${base}/src/store.js');
    const c = await store.campaigns.get('${created}');
    return c.log[c.log.length - 1];
  })()`);
  check('a table lookup appends a tbl: line',
    tableAdded === 'tbl: Mood d4=2 -> Melancholic', JSON.stringify(tableAdded));

  // --- Phase 5: add-on panels surface from log content alone ---
  await s.evaluate(`(async () => {
    const store = await import('${base}/src/store.js');
    const c = await store.campaigns.get('${created}');
    c.log.push('[R:1|active|entry cave]', '[Unit:Rifles|x12|Morale 8|Fresh]');
    await store.campaigns.put(c);
  })()`);
  await s.evaluate(`(location.hash = '#/log/${created}', new Promise(r => setTimeout(r, 200)))`);
  await s.evaluate(`(location.hash = '#/state/${created}', new Promise(r => setTimeout(r, 350)))`);

  const panels = await s.evaluate('[...document.querySelectorAll("#screen .addon")].map(p => p.dataset.addon)');
  check('every add-on with tags in the log has surfaced',
    JSON.stringify(panels) === JSON.stringify(['combat', 'resources', 'dungeon', 'wargaming']),
    JSON.stringify(panels));

  // Combat: damage a foe from the panel.
  const linesBeforeAddon = await s.evaluate(`(async () => {
    const store = await import('${base}/src/store.js');
    return (await store.campaigns.get('${created}')).log.length;
  })()`);

  await s.evaluate(`(() => {
    const panel = document.querySelector('#screen .addon[data-addon="combat"]');
    [...panel.querySelectorAll('.btn-tiny')].find(b => b.textContent === '−1').click();
  })()`);
  await s.evaluate('new Promise(r => setTimeout(r, 350))');

  const damaged = await s.evaluate(`(async () => {
    const store = await import('${base}/src/store.js');
    const c = await store.campaigns.get('${created}');
    return { n: c.log.length, last: c.log[c.log.length - 1] };
  })()`);
  check('a combat control appends a tag line',
    damaged.n === linesBeforeAddon + 1 && /^\[F:Thug\|HP-1\]$/.test(damaged.last),
    JSON.stringify(damaged));

  // Wargaming: Tn# must not be moved by the combat panel's Rd#.
  await s.evaluate(`(() => {
    const panel = document.querySelector('#screen .addon[data-addon="wargaming"]');
    [...panel.querySelectorAll('.btn-tiny')].find(b => b.textContent === 'Turn 1').click();
  })()`);
  await s.evaluate('new Promise(r => setTimeout(r, 350))');
  const turned = await s.evaluate(`(async () => {
    const store = await import('${base}/src/store.js');
    const c = await store.campaigns.get('${created}');
    return c.log[c.log.length - 1];
  })()`);
  check('the battle panel advances Tn# independently of Rd#', turned === 'Tn1', JSON.stringify(turned));

  // Resources: a snapshot block closes itself.
  await s.evaluate(`(() => {
    const panel = document.querySelector('#screen .addon[data-addon="resources"]');
    [...panel.querySelectorAll('.btn-tiny')].find(b => b.textContent === 'Snapshot').click();
  })()`);
  await s.evaluate('new Promise(r => setTimeout(r, 400))');
  const snapshot = await s.evaluate(`(async () => {
    const store = await import('${base}/src/store.js');
    const { lex } = await import('${base}/src/lonelog/lexer.js');
    const { fold } = await import('${base}/src/lonelog/fold.js');
    const c = await store.campaigns.get('${created}');
    const st = fold(lex(c.log.join('\\n')));
    return { open: st.blockStack.length, first: c.log.find(l => l === '[RESOURCES]') };
  })()`);
  check('a resource snapshot writes a balanced block',
    snapshot.open === 0 && snapshot.first === '[RESOURCES]', JSON.stringify(snapshot));

  // Hiding a panel is view state and must not touch the log.
  const beforeHide = await s.evaluate(`(async () => {
    const store = await import('${base}/src/store.js');
    return (await store.campaigns.get('${created}')).log.length;
  })()`);
  await s.evaluate(`(() => {
    const panel = document.querySelector('#screen .addon[data-addon="dungeon"]');
    [...panel.querySelectorAll('.btn-tiny')].find(b => b.textContent === 'Hide').click();
  })()`);
  await s.evaluate('new Promise(r => setTimeout(r, 350))');
  const hidden = await s.evaluate(`(async () => {
    const store = await import('${base}/src/store.js');
    const c = await store.campaigns.get('${created}');
    return { n: c.log.length, view: c.view.hiddenPanels };
  })()`);
  check('hiding a panel is view state and leaves the log untouched',
    hidden.n === beforeHide && JSON.stringify(hidden.view) === JSON.stringify(['dungeon']),
    JSON.stringify(hidden));
  check('a hidden panel still exists, collapsed',
    (await s.evaluate(`document.querySelector('#screen .addon[data-addon="dungeon"] .btn-tiny').textContent`)) === 'Show');

  // --- Phase 6: lifecycle bundles fire completely and undo in one step ---
  await s.evaluate(`(location.hash = '#/log/${created}', new Promise(r => setTimeout(r, 300)))`);

  const beforeBundle = await s.evaluate(`(async () => {
    const store = await import('${base}/src/store.js');
    return (await store.campaigns.get('${created}')).log.length;
  })()`);

  // End session -> confirmation summary -> commit the whole bundle.
  await s.evaluate(`([...document.querySelectorAll('#screen .composer-tools .btn')]
    .find(b => b.textContent === 'Session…')).click()`);
  await s.evaluate('new Promise(r => setTimeout(r, 250))');
  await s.evaluate(`([...document.querySelectorAll('.modal-actions .btn')]
    .find(b => b.textContent === 'End session')).click()`);
  await s.evaluate('new Promise(r => setTimeout(r, 250))');

  check('a heavy bundle asks for confirmation with a summary',
    await s.evaluate('document.querySelectorAll(".modal .plain-list li").length') > 0);

  await s.evaluate(`([...document.querySelectorAll('.modal-actions .btn')]
    .find(b => b.textContent === 'End session')).click()`);
  await s.evaluate('new Promise(r => setTimeout(r, 400))');

  const bundled = await s.evaluate(`(async () => {
    const store = await import('${base}/src/store.js');
    const { lex } = await import('${base}/src/lonelog/lexer.js');
    const { fold } = await import('${base}/src/lonelog/fold.js');
    const c = await store.campaigns.get('${created}');
    const st = fold(lex(c.log.join('\\n')));
    return { n: c.log.length, open: st.blockStack.length, text: c.log.join('\\n') };
  })()`);
  check('the bundle appends more than one line',
    bundled.n > beforeBundle + 1, `${beforeBundle} -> ${bundled.n}`);
  check('the bundle closes every open block', bundled.open === 0, String(bundled.open));
  check('the bundle snapshots the surfaced add-ons',
    /\[RESOURCES\]/.test(bundled.text) && /\[DUNGEON STATUS\]/.test(bundled.text)
      && /\[CAMPAIGN\]/.test(bundled.text));

  const undoLabel = await s.evaluate('document.querySelector("#composer-undo")?.textContent');
  check('undo advertises the whole bundle', /^Undo \d+ lines$/.test(undoLabel), JSON.stringify(undoLabel));

  await s.evaluate('document.querySelector("#composer-undo").click()');
  await s.evaluate('new Promise(r => setTimeout(r, 400))');
  const afterUndo = await s.evaluate(`(async () => {
    const store = await import('${base}/src/store.js');
    return (await store.campaigns.get('${created}')).log.length;
  })()`);
  check('one undo removes the whole bundle', afterUndo === beforeBundle,
    `${bundled.n} -> ${afterUndo}, expected ${beforeBundle}`);

  await s.evaluate('document.querySelector("#composer-restore").click()');
  await s.evaluate('new Promise(r => setTimeout(r, 400))');
  const afterRestore = await s.evaluate(`(async () => {
    const store = await import('${base}/src/store.js');
    return (await store.campaigns.get('${created}')).log.length;
  })()`);
  check('restore puts the bundle back', afterRestore === bundled.n,
    `${afterUndo} -> ${afterRestore}, expected ${bundled.n}`);

  // --- Phase 7: quick rolls are learned from the log, never preconfigured ---
  await s.evaluate(`(async () => {
    const store = await import('${base}/src/store.js');
    const c = await store.campaigns.get('${created}');
    c.log.push(
      'd: Stealth d6=5 vs TN 4 -> Success',
      'd: Stealth d6=2 vs TN 4 -> Fail',
      'd: Stealth d6=6 vs TN 4 -> Success',
    );
    await store.campaigns.put(c);
  })()`);
  await s.evaluate(`(location.hash = '#/log/${created}', new Promise(r => setTimeout(r, 200)))`);
  await s.evaluate(`(location.hash = '#/resolve/${created}', new Promise(r => setTimeout(r, 400)))`);

  check('a repeated roll shape is offered as a quick roll',
    await s.evaluate('document.querySelectorAll("[data-panel=\'quick-rolls\'] .suggestion").length') === 1);

  await s.evaluate(`([...document.querySelectorAll("[data-panel='quick-rolls'] .btn-tiny")]
    .find(b => b.textContent === 'Save as quick roll')).click()`);
  await s.evaluate('new Promise(r => setTimeout(r, 400))');

  const savedRolls = await s.evaluate(`(async () => {
    const store = await import('${base}/src/store.js');
    const all = await store.templates.all();
    return all.map(t => [t.label, t.shape]);
  })()`);
  check('saving stores the learned template',
    savedRolls.length === 1 && savedRolls[0][0] === 'Stealth'
      && savedRolls[0][1] === 'Stealth d6=# vs TN 4',
    JSON.stringify(savedRolls));

  check('the suggestion is withdrawn once saved',
    await s.evaluate('document.querySelectorAll("[data-panel=\'quick-rolls\'] .suggestion").length') === 0);

  // Tapping the quick roll presets the form but leaves the dice empty (D2).
  await s.evaluate(`([...document.querySelectorAll("[data-panel='quick-rolls'] .btn-tiny")]
    .find(b => b.textContent === 'Stealth')).click()`);
  await s.evaluate('new Promise(r => setTimeout(r, 250))');

  const preset = await s.evaluate(`(() => {
    const fields = [...document.querySelectorAll('#screen .field .input')];
    const label = fields.find(f => f.previousElementSibling?.textContent === 'Label');
    const target = fields.find(f => f.previousElementSibling?.textContent === 'Target');
    return {
      label: label.value,
      target: target.value,
      dice: [...document.querySelectorAll('#screen .dice-row .die-input')].map(d => d.value),
      addDisabled: document.querySelector('#roll-add').disabled,
    };
  })()`);
  check('a quick roll presets label and target but not the dice',
    preset.label === 'Stealth' && preset.target === '4'
      && preset.dice.length === 1 && preset.dice[0] === '' && preset.addDisabled === true,
    JSON.stringify(preset));

  // --- Phase 8: searchable reference, and lint that explains itself ---
  await s.evaluate(`(location.hash = '#/reference', new Promise(r => setTimeout(r, 350)))`);
  check('help screen renders',
    (await s.evaluate('document.querySelector("#screen h1")?.textContent')) === 'Help');

  // The Guide is the default view for a newcomer.
  check('the guide is shown first and walks through the app',
    await s.evaluate('document.querySelectorAll("#screen .guide-step").length') >= 10,
    String(await s.evaluate('document.querySelectorAll("#screen .guide-step").length')));

  const firstStep = await s.evaluate('document.querySelector("#screen .guide-title")?.textContent');
  check('the guide starts by making a campaign', firstStep === 'Start a campaign', JSON.stringify(firstStep));

  // A step deep-links to the screen it describes.
  await s.evaluate(`([...document.querySelectorAll('#screen .guide-step .btn')]
    .find(b => b.textContent === 'Open Play')).click()`);
  await s.evaluate('new Promise(r => setTimeout(r, 300))');
  check('a guide step opens the screen it describes',
    /^#\/log\//.test(await s.evaluate('location.hash')), await s.evaluate('location.hash'));

  // Switch to the Reference and it is remembered.
  await s.evaluate(`(location.hash = '#/reference', new Promise(r => setTimeout(r, 300)))`);
  await s.evaluate(`document.querySelector('[data-view="reference"]').click()`);
  await s.evaluate('new Promise(r => setTimeout(r, 300))');
  check('switching to the reference shows the searchable list',
    await s.evaluate('!!document.querySelector("#ref-search")'));

  await s.evaluate(`(location.hash = '#/campaigns', new Promise(r => setTimeout(r, 250)))`);
  await s.evaluate(`(location.hash = '#/reference', new Promise(r => setTimeout(r, 350)))`);
  check('the chosen view is remembered',
    await s.evaluate('!!document.querySelector("#ref-search")')
      && await s.evaluate('document.querySelectorAll("#screen .guide-step").length') === 0);

  const allEntries = await s.evaluate('document.querySelectorAll("#screen .ref-list li").length');
  check('the reference lists every entry', allEntries > 20, String(allEntries));

  check('entries start collapsed',
    await s.evaluate('document.querySelectorAll("#screen .ref-entry[open]").length') === 0);

  await s.evaluate(`document.querySelector('#screen .ref-entry > summary').click()`);
  await s.evaluate('new Promise(r => setTimeout(r, 200))');
  check('clicking an entry expands just that one',
    await s.evaluate('document.querySelectorAll("#screen .ref-entry[open]").length') === 1);

  await s.evaluate(`document.querySelector('#ref-toggle').click()`);
  await s.evaluate('new Promise(r => setTimeout(r, 250))');
  const expanded = await s.evaluate('document.querySelectorAll("#screen .ref-entry[open]").length');
  check('expand all opens every entry', expanded === allEntries, `${expanded}/${allEntries}`);

  await s.evaluate(`document.querySelector('#ref-toggle').click()`);
  await s.evaluate('new Promise(r => setTimeout(r, 250))');
  check('collapse all closes them again',
    await s.evaluate('document.querySelectorAll("#screen .ref-entry[open]").length') === 0);

  await s.evaluate(`(() => {
    const box = document.querySelector('#ref-search');
    box.value = 'clock';
    box.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await s.evaluate('new Promise(r => setTimeout(r, 200))');
  const narrowed = await s.evaluate('document.querySelectorAll("#screen .ref-list li").length');
  check('searching narrows the reference', narrowed > 0 && narrowed < allEntries,
    `${allEntries} -> ${narrowed}`);
  check('search results open so the answer is visible',
    await s.evaluate('document.querySelectorAll("#screen .ref-entry[open]").length') === narrowed);

  // A composer symbol explains the notation it writes.
  await s.evaluate(`(location.hash = '#/log/${created}', new Promise(r => setTimeout(r, 350)))`);
  check('the composer links to the reference entry for the selected symbol',
    await s.evaluate('!!document.querySelector("#screen .composer-explain .ref-btn")'));

  await s.evaluate('document.querySelector("#screen .composer-explain .ref-btn").click()');
  await s.evaluate('new Promise(r => setTimeout(r, 250))');
  check('the reference opens from the composer',
    (await s.evaluate('document.querySelector(".modal-title")?.textContent')) === 'Action');
  await s.evaluate(`document.querySelector('.modal-actions .btn').click()`);
  await s.evaluate('new Promise(r => setTimeout(r, 200))');

  // Lint is advisory: a violation is flagged, never blocked.
  await s.evaluate(`(async () => {
    const store = await import('${base}/src/store.js');
    const c = await store.campaigns.get('${created}');
    c.log.push('[Wealth:Gold 50gc+7gc] => [Wealth:Gold 57gc]');
    await store.campaigns.put(c);
  })()`);
  await s.evaluate(`(location.hash = '#/state/${created}', new Promise(r => setTimeout(r, 200)))`);
  await s.evaluate(`(location.hash = '#/log/${created}', new Promise(r => setTimeout(r, 400)))`);

  check('a spec violation is flagged on its line but still written',
    await s.evaluate('document.querySelectorAll("#screen .log-row.has-error").length') === 1);

  await s.evaluate(`document.querySelector('#screen .log-row.has-error').click()`);
  await s.evaluate('new Promise(r => setTimeout(r, 250))');
  check('the flag explains itself and links to the reference',
    await s.evaluate('!!document.querySelector(".modal .lint-summary .ref-btn")'));
  await s.evaluate(`([...document.querySelectorAll('.modal-actions .btn')]
    .find(b => b.textContent === 'Close')).click()`);
  await s.evaluate('new Promise(r => setTimeout(r, 200))');

  // --- Every nav tab reaches its own screen when clicked ---
  const tabs = await s.evaluate(`(async () => {
    const seen = [];
    for (const tab of ['campaigns', 'log', 'state', 'reference']) {
      document.querySelector('[data-nav="' + tab + '"]').click();
      await new Promise(r => setTimeout(r, 300));
      seen.push([tab, location.hash.split('/')[1], document.querySelector('#screen h1')?.textContent]);
    }
    return seen;
  })()`);
  check('each tab routes to its own screen',
    tabs.every(([tab, route]) => route === tab)
      && new Set(tabs.map((x) => x[2])).size === tabs.length,
    JSON.stringify(tabs));

  // F1: Play carries the campaign across a detour through the campaign list.
  const kept = await s.evaluate(`(async () => {
    document.querySelector('[data-nav="campaigns"]').click();
    await new Promise(r => setTimeout(r, 250));
    document.querySelector('[data-nav="log"]').click();
    await new Promise(r => setTimeout(r, 300));
    return location.hash;
  })()`);
  check('Play returns to the campaign you were playing', kept === `#/log/${created}`, kept);

  // F1: a route with no tab of its own lights the tab that owns it.
  await s.evaluate(`(location.hash = '#/resolve/${created}', new Promise(r => setTimeout(r, 300)))`);
  check('rolling marks Play as the current tab',
    await s.evaluate(`document.querySelector('[data-nav][aria-current="page"]')?.dataset.nav`) === 'log');
  await s.evaluate(`(location.hash = '#/settings', new Promise(r => setTimeout(r, 300)))`);
  check('settings marks Campaigns as the current tab',
    await s.evaluate(`document.querySelector('[data-nav][aria-current="page"]')?.dataset.nav`) === 'campaigns');

  // An unknown route must announce itself rather than impersonating a screen.
  await s.evaluate(`(location.hash = '#/nosuchscreen', new Promise(r => setTimeout(r, 300)))`);
  check('an unknown route says so instead of falling back',
    (await s.evaluate('document.querySelector("#screen h1")?.textContent')) === 'Screen not found'
      && await s.evaluate('document.querySelectorAll("[data-nav][aria-current]").length') === 0);

  // --- Hardening: accessibility sweep across every screen ---
  const a11y = await s.evaluate(`(async () => {
    const routes = [
      ['campaigns', ''], ['log', '/${created}'], ['state', '/${created}'],
      ['resolve', '/${created}'], ['reference', ''], ['settings', ''],
      ['log', ''], ['state', ''], ['resolve', ''],
    ];
    const problems = [];
    const name = (elm) => (
      elm.getAttribute('aria-label')
      || (elm.getAttribute('aria-labelledby') && document.getElementById(elm.getAttribute('aria-labelledby'))?.textContent)
      || (elm.id && document.querySelector('label[for="' + elm.id + '"]')?.textContent)
      || elm.closest('label')?.textContent
      || elm.title
      || elm.textContent
    );

    for (const [route, id] of routes) {
      location.hash = '#/' + route + id;
      await new Promise(r => setTimeout(r, 260));
      const screen = document.querySelector('#screen');

      const h1s = screen.querySelectorAll('h1');
      if (h1s.length !== 1) problems.push(route + ': ' + h1s.length + ' h1');

      for (const control of screen.querySelectorAll('button, a[href], input, select, textarea')) {
        if (!String(name(control) ?? '').trim()) {
          problems.push(route + ': unnamed ' + control.tagName.toLowerCase()
            + ' .' + (control.className || '?'));
        }
      }

      const current = document.querySelectorAll('[data-nav][aria-current="page"]');
      if (current.length !== 1) problems.push(route + ': ' + current.length + ' aria-current');
    }
    return problems;
  })()`);
  check('every control on every screen has an accessible name', a11y.length === 0,
    a11y.slice(0, 4).join(' | '));

  const landmarks = await s.evaluate(`(() => ({
    live: document.querySelectorAll('[aria-live]').length,
    nav: !!document.querySelector('nav[aria-label]'),
    skip: !!document.querySelector('.skip-link'),
    lang: document.documentElement.lang,
  }))()`);
  check('the shell provides live regions, a labelled nav, a skip link and a language',
    landmarks.live >= 2 && landmarks.nav && landmarks.skip && landmarks.lang === 'en',
    JSON.stringify(landmarks));

  // Modals must trap focus and restore it (CLAUDE.md §2).
  await s.evaluate(`(location.hash = '#/log/${created}', new Promise(r => setTimeout(r, 300)))`);
  const modalA11y = await s.evaluate(`(async () => {
    const opener = document.querySelector('#screen .composer-explain .ref-btn');
    opener.focus();
    opener.click();
    await new Promise(r => setTimeout(r, 250));
    const dialog = document.querySelector('.modal');
    const inside = dialog.contains(document.activeElement);
    const labelled = !!dialog.getAttribute('aria-labelledby')
      && dialog.getAttribute('aria-modal') === 'true'
      && dialog.getAttribute('role') === 'dialog';
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(r => setTimeout(r, 250));
    return {
      inside, labelled,
      closed: !document.querySelector('.modal'),
      restored: document.activeElement === opener,
    };
  })()`);
  check('a modal is labelled, traps focus, closes on Escape and restores focus',
    modalA11y.inside && modalA11y.labelled && modalA11y.closed && modalA11y.restored,
    JSON.stringify(modalA11y));

  for (const width of [360, 390]) {
    await s.send('Emulation.setDeviceMetricsOverride', { width, height: 780, deviceScaleFactor: 1, mobile: true });
    for (const route of ['campaigns', 'log', 'state', 'resolve', 'reference', 'settings']) {
      const id = ['campaigns', 'settings', 'reference'].includes(route) ? '' : `/${created}`;
      await s.evaluate(`(location.hash = '#/${route}${id}', new Promise(r => setTimeout(r, 200)))`);
      const overflow = await s.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth');
      check(`no horizontal overflow at ${width}px on ${route}`, overflow <= 0, `overflow ${overflow}px`);
    }
  }

  check('zero console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
} finally {
  try { ws?.close(); } catch { /* already closed */ }
  proc.kill('SIGKILL');
  server.close();
  // Chromium keeps flushing its profile briefly after the kill signal.
  for (let i = 0; i < 10; i++) {
    try { await rm(profile, { recursive: true, force: true }); break; }
    catch { await new Promise((r) => setTimeout(r, 100)); }
  }
}

if (failures.length) {
  console.error(`\n${failures.length} browser check(s) failed`);
  process.exit(1);
}
console.log('\nbrowser smoke: all checks passed');
