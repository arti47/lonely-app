/**
 * Dev tool: harvest notation examples from the vendored specs into
 * tests/corpus/ (ledger prerequisite — CLAUDE.md §9.5 round-trip corpus).
 *
 * Two example shapes appear in the specs:
 *   - fenced code blocks (```)
 *   - runs of blockquoted inline code (`> \`@ Pick the lock\``)
 *
 * Run: node tests/extract-corpus.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const specDir = join(root, 'docs', 'spec');
const outDir = join(root, 'tests', 'corpus');

const NOTATION = /(^|\n)\s*(@|\?\s|d:|tbl:|gen:|->|=>|\[[A-Za-z#][^\]]*:|\[\/?[A-Z][A-Z ]*\]|---\s*[A-Z]|S\d|Rd\d|Tn\d|N \(|PC[ (:])/;

function harvest(md) {
  const lines = md.split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*```/.test(line)) {
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) { body.push(lines[i]); i++; }
      i++;
      if (body.length) out.push(body.join('\n'));
      continue;
    }

    if (/^>\s*`.*`\s*$/.test(line)) {
      const body = [];
      while (i < lines.length && /^>\s*`.*`\s*$/.test(lines[i])) {
        body.push(lines[i].replace(/^>\s*`/, '').replace(/`\s*$/, ''));
        i++;
      }
      if (body.length) out.push(body.join('\n'));
      continue;
    }

    i++;
  }
  return out;
}

mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) rmSync(join(outDir, f));

const manifest = [];
let total = 0;

for (const file of readdirSync(specDir).sort()) {
  if (!file.endsWith('.md')) continue;
  const md = readFileSync(join(specDir, file), 'utf8');
  const snippets = harvest(md).filter((s) => s.trim() && NOTATION.test(s));

  snippets.forEach((snippet, n) => {
    const name = `${file.replace(/\.md$/, '')}-${String(n + 1).padStart(3, '0')}.lonelog`;
    writeFileSync(join(outDir, name), snippet.endsWith('\n') ? snippet : snippet + '\n');
    manifest.push({ file: name, source: `docs/spec/${file}`, lines: snippet.split('\n').length });
    total++;
  });
}

writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`extracted ${total} snippets from ${new Set(manifest.map((m) => m.source)).size} specs`);
