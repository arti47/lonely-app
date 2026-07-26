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
  check('folded state lists tracked element types', ['PC', 'N', 'F', 'Inv'].every((t) => groups.includes(t)),
    `saw ${JSON.stringify(groups)}`);

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
