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

// A heading may carry the notation: `### S1 *…*` is the digital form of a scene
// marker (core §5.3), and `## Session 1` of a session header (§5.2.1).
const NOTATION = /(^|\n)\s*(#{1,6}\s+)?(@|\?\s|d:|tbl:|gen:|->|=>|\[[A-Za-z#][^\]]*:|\[\/?[A-Z][A-Z ]*\]|---\s*[A-Z]|S\d|Rd\d|Tn\d|N \(|PC[ (:]|Session\s+\d|={2,}\s*(Session|Campaign))/;

/**
 * Lines that open (or continue) a plain-text example. The vendored specs are
 * PDF conversions: many of their examples are not fenced or quoted at all —
 * every digital scene heading, the dialogue in §4.4, the analog headers in §5.
 * Those were invisible to the corpus until a fidelity audit found a defect
 * living in exactly that blind spot (docs/audit.md B1).
 */
const LINE_START = new RegExp(
  '^\\s*('
  + '@|\\?\\s|d:|tbl:|gen:|->|→|=>'                       // core symbols
  + '|\\\\-{2,}|-{3,}\\s*(END\\s+)?[A-Z][A-Z ]*-{3,}'      // narrative + analog blocks
  + '|\\[\\/?[A-Z][A-Z ]*\\]'                              // digital blocks
  + '|\\[#?[A-Za-z][^\\]]*:'                                // tags
  + '|(T\\d+-)?S\\d+[a-z]?(\\.\\d+)?\\b'                    // scene markers
  + '|Rd\\d+\\b|Tn\\d+\\b'                                // round / turn markers
  + '|N \\([^)]*\\)\\s*:|PC\\s*:'                           // dialogue
  + '|\\((note|reflection|house rule|reminder|question|Init)\\s*:'  // meta notes
  + '|#{1,6}\\s+((T\\d+-)?S\\d+|Session\\b)'                 // digital headings
  + '|={2,}\\s*(Session|Campaign)\\b'                       // analog headers
  + ')',
);

/** Lines that only make sense as the body of an example already open. */
const LINE_CONTINUES = /^\s*(\d+(\s*[-–]\s*\d+)?\s*:\s+\S|[A-Za-z][\w '-]*\s*:\s+.*(->|→))/;

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

    // Plain-text example runs: unfenced, unquoted notation as the specs print it.
    if (LINE_START.test(line) && line.trim()) {
      const body = [];
      while (i < lines.length && lines[i].trim()
             && (LINE_START.test(lines[i]) || (body.length && LINE_CONTINUES.test(lines[i])))) {
        body.push(lines[i]);
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
