/**
 * Architectural invariants that must hold for the life of the project
 * (CLAUDE.md §2, §5, §9.5). These are cheap and catch regressions that code
 * review would not.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const srcFiles = walk(srcDir).filter((f) => f.endsWith('.js'));

test('D2: no RNG anywhere in src/', () => {
  const offenders = srcFiles.filter((f) => {
    const code = readFileSync(f, 'utf8').replace(/^\s*\*.*$/gm, '');
    return /Math\s*\.\s*random|crypto\s*\.\s*getRandomValues|crypto\s*\.\s*randomUUID/.test(code);
  });
  assert.deepEqual(offenders.map((f) => relative(root, f)), [],
    'the user rolls the dice; the app must never generate them');
});

test('§3.1: the notation engine imports nothing outside itself', () => {
  const engine = srcFiles.filter((f) => f.includes(join('src', 'lonelog')));
  assert.ok(engine.length >= 5);
  for (const f of engine) {
    const code = readFileSync(f, 'utf8');
    for (const m of code.matchAll(/^import\s+[^;]*?from\s+'([^']+)'/gm)) {
      assert.ok(
        m[1].startsWith('./') || m[1].startsWith('node:'),
        `${relative(root, f)} imports ${m[1]} — the engine must stay portable`,
      );
    }
  }
});

test('§2: no network calls outside the service worker', () => {
  const offenders = srcFiles.filter((f) => {
    const code = readFileSync(f, 'utf8').replace(/^\s*\*.*$/gm, '');
    return /\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon|new WebSocket/.test(code);
  });
  assert.deepEqual(offenders.map((f) => relative(root, f)), [],
    'the app has no backend; only service-worker.js is network-aware');
});

test('§2: no native alert/confirm/prompt', () => {
  const offenders = srcFiles.filter((f) => {
    const code = readFileSync(f, 'utf8').replace(/^\s*\*.*$/gm, '');
    return /(^|[^.\w])(alert|confirm|prompt)\s*\(/.test(code) && !f.endsWith('ui.js');
  });
  assert.deepEqual(offenders.map((f) => relative(root, f)), []);
});

test('§3: every shipped module is in the service-worker app shell', () => {
  const sw = readFileSync(join(root, 'service-worker.js'), 'utf8');
  const missing = srcFiles
    .map((f) => relative(root, f).split('\\').join('/'))
    .filter((rel) => !sw.includes(rel));
  assert.deepEqual(missing, [], 'add the module to APP_SHELL and bump CACHE_VERSION');
});

test('the app is servable from a subpath (GitHub Pages project site)', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  const sw = readFileSync(join(root, 'service-worker.js'), 'utf8');

  // A root-absolute reference would 404 under https://user.github.io/<repo>/.
  const absolute = [...html.matchAll(/(?:href|src)="(\/[^/][^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(absolute, [], 'index.html must use relative references only');

  assert.ok(!manifest.start_url.startsWith('/'), 'manifest start_url must be relative');
  assert.ok(!manifest.scope.startsWith('/'), 'manifest scope must be relative');

  const shell = /const APP_SHELL = \[([\s\S]*?)\];/.exec(sw)?.[1] ?? '';
  const rooted = [...shell.matchAll(/'(\/[^']*)'/g)].map((m) => m[1]);
  assert.deepEqual(rooted, [], 'every app-shell entry must be relative to the scope');
});
