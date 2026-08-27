/**
 * Shared headless-browser harness for the dev-only checks (CLAUDE.md §9.4).
 *
 * Boots the real app in headless Chromium over the DevTools Protocol, from a
 * static server serving the repository as-is. No installed dependencies: Node's
 * own `WebSocket`, `fetch` and `http` are enough.
 *
 * Used by `smoke.mjs` (does the app work?) and `reachability.mjs` (can a person
 * who has read nothing find it?).
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');

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

export function findChrome() {
  for (const p of CHROME_CANDIDATES) if (existsSync(p)) return p;
  return null;
}

/**
 * Serve the repository.
 * @param {{rewrite?:(pathname:string, body:Buffer)=>Buffer}} [opts]
 *   `rewrite` lets a caller publish a byte-different file — which is how the
 *   update prompt is tested against a real deploy.
 */
export function serve(opts = {}) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let p = normalize(join(root, decodeURIComponent(url.pathname)));
      if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
      if (url.pathname === '/' || url.pathname.endsWith('/')) p = join(p, 'index.html');
      let body = await readFile(p);
      if (opts.rewrite) body = opts.rewrite(url.pathname, body);
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

export class Session {
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

  /** Settle: let the app finish rendering. */
  wait(ms = 250) {
    return this.evaluate(`new Promise(r => setTimeout(r, ${ms}))`);
  }

  /** Go to a hash and wait for the render. */
  async goto(hash, ms = 350) {
    await this.evaluate(`(location.hash = ${JSON.stringify(hash)}, true)`);
    await this.wait(ms);
  }
}

/**
 * Launch Chromium against a freshly served copy of the app.
 * @param {{width?:number, height?:number, hash?:string, serve?:object}} [opts]
 * @returns {Promise<{s:Session, base:string, server:object, consoleErrors:string[],
 *   close:()=>Promise<void>}>}
 */
export async function launch(opts = {}) {
  const chrome = findChrome();
  if (!chrome) return null;

  const server = await serve(opts.serve);
  const base = `http://127.0.0.1:${server.address().port}`;
  const profile = await mkdtemp(join(tmpdir(), 'lonely-'));
  const port = 9222 + (process.pid % 500) + (opts.portOffset ?? 0);

  const proc = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--disable-dev-shm-usage', '--hide-scrollbars',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
    'about:blank',
  ], { stdio: 'ignore' });

  await waitForJson(`http://127.0.0.1:${port}/json/version`);
  const target = await (await fetch(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' },
  )).json();

  const ws = new WebSocket(target.webSocketDebuggerUrl);
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
    width: opts.width ?? 360, height: opts.height ?? 780, deviceScaleFactor: 1, mobile: true,
  });

  const loaded = s.once('Page.loadEventFired');
  await s.send('Page.navigate', { url: `${base}/index.html${opts.hash ?? '#/campaigns'}` });
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

  return {
    s,
    base,
    server,
    consoleErrors,
    async close() {
      try { ws.close(); } catch { /* already gone */ }
      proc.kill();
      server.close();
      await rm(profile, { recursive: true, force: true }).catch(() => {});
    },
  };
}
