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
  check('nav renders all five tabs', await s.evaluate('document.querySelectorAll("[data-nav]").length') === 5);
  check('campaigns screen renders', (await s.evaluate('document.querySelector("#screen h1")?.textContent')) === 'Campaigns');

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

  for (const [route, heading] of [['log', 'Smoke Campaign'], ['state', 'State'], ['resolve', 'Resolve'], ['settings', 'Settings']]) {
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

  check('composer mounts with every symbol', await s.evaluate('document.querySelectorAll("#screen .sym").length') === 8);

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

  for (const width of [360, 390]) {
    await s.send('Emulation.setDeviceMetricsOverride', { width, height: 780, deviceScaleFactor: 1, mobile: true });
    for (const route of ['campaigns', 'log', 'state', 'resolve', 'settings']) {
      const id = route === 'campaigns' || route === 'settings' ? '' : `/${created}`;
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
