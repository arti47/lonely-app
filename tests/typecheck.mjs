/**
 * JSDoc type check (CLAUDE.md §2 — types without a build step).
 *
 * TypeScript is a dev-only convenience; when it is not installed the check
 * reports a skip rather than failing, so `npm test` works on a fresh clone with
 * no install (§2 clone-and-run).
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsc = join(root, 'node_modules', '.bin', 'tsc');

if (!existsSync(tsc)) {
  console.log('# typescript not installed; skipping typecheck (npm install to enable)');
  process.exit(0);
}

const r = spawnSync(tsc, ['--noEmit', '-p', join(root, 'jsconfig.json')], { stdio: 'inherit' });
process.exit(r.status ?? 1);
