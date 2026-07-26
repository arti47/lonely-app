/**
 * Spec-conformance lint (ledger T58).
 *
 * Every rule maps to a catalogued defect in `docs/spec-review.md`. Lint never
 * blocks parsing or editing — the log is the user's (CLAUDE.md §5.2). Findings
 * are advisory and carry the review section that explains them.
 */

import { serializeTag } from './tags.js';

export const SEVERITY = { ERROR: 'error', WARN: 'warn', INFO: 'info' };

const RULES = {
  L1: { severity: SEVERITY.ERROR, review: '#1', message: '`=>` used as an operator between tags. Core §3.3 reserves `=>` for consequences; use a delta tag such as `[Wealth:Gold+7]`.' },
  L2: { severity: SEVERITY.ERROR, review: '#2', message: 'Line-leading `!` is not a Lonelog symbol. Core §10.5 and the Combat Add-on forbid new core symbols; use `@(Name)` or a consequence.' },
  L3: { severity: SEVERITY.INFO, review: '#3', message: '`[E:]` and `[Clock:]` are both in use for the same X/Y semantics. Pick one per campaign.' },
  L4: { severity: SEVERITY.WARN, review: '#4', message: 'Stat says "each" but the tag declares no group count. Write `[F:Namex2|HP 5 each]` so the group size is explicit.' },
  L5: { severity: SEVERITY.WARN, review: '#5', message: 'Combat damage applied to an `[N:]` tag inside a combat block. The Combat Add-on uses `[F:]` for combatants.' },
  L6: { severity: SEVERITY.WARN, review: '#6', message: '`[Scenario:]` outside a `[BATTLE]` block. The Wargaming Add-on opens a battle with it.' },
  L7: { severity: SEVERITY.WARN, review: '#7', message: 'Multiplier used in an `[Inv:]` quantity field. The Resource Add-on wants a plain integer there.' },
  L8: { severity: SEVERITY.INFO, review: '#8', message: 'Tag whitespace is non-canonical.' },
  L9: { severity: SEVERITY.INFO, review: '#7', message: 'Both `x` and `×` multipliers appear in this log. Pick one.' },
  L10: { severity: SEVERITY.INFO, review: '#10', message: 'Narrative block uses symmetric `---`. Core §4.4 uses `\\---` / `---\\` to avoid colliding with a Markdown rule.' },
  L11: { severity: SEVERITY.INFO, review: '#10', message: '`[Timer:]` carries an X/Y value. A timer counts down from a single number; `[Track:]` is the X/Y form.' },
};

const COMBAT_BLOCKS = new Set(['COMBAT', 'BATTLE']);

/**
 * @param {object[]} entries
 * @returns {{rule:string, severity:string, line:number, message:string, review:string}[]}
 */
export function lint(entries) {
  const findings = [];
  const add = (rule, line, extra) => findings.push({
    rule, line,
    severity: RULES[rule].severity,
    message: extra ? `${RULES[rule].message} ${extra}` : RULES[rule].message,
    review: RULES[rule].review,
  });

  const blockStack = [];
  let sawE = false, sawClock = false, eLine = -1, clockLine = -1;
  let sawAsciiMult = false, sawUnicodeMult = false, multLine = -1;

  for (const e of entries) {
    if (e.kind === 'block') {
      if (e.closing) blockStack.pop();
      else blockStack.push(e.name);
    }

    const inCombat = blockStack.some((b) => COMBAT_BLOCKS.has(b));

    if (/\]\s*=>\s*\[/.test(e.raw)) add('L1', e.line);
    if (e.kind === 'prose' && /^\s*!\s*\S/.test(e.raw)) add('L2', e.line);
    if (e.kind === 'narrativeOpen' && !/^\s*\\-/.test(e.raw)) add('L10', e.line);

    if (/×\s*\d/.test(e.raw)) { sawUnicodeMult = true; if (multLine < 0) multLine = e.line; }
    if (/[A-Za-z0-9]\s*x\s*\d/.test(e.raw)) { sawAsciiMult = true; if (multLine < 0) multLine = e.line; }

    for (const tag of e.tags ?? []) {
      if (tag.type === 'E') { sawE = true; if (eLine < 0) eLine = e.line; }
      if (tag.type === 'Clock') { sawClock = true; if (clockLine < 0) clockLine = e.line; }

      if (tag.type === 'Timer' && tag.head?.kind === 'progress') add('L11', e.line);

      if ((tag.type === 'F' || tag.type === 'Unit') && tag.count == null
          && tag.fields.some((f) => /\beach\b/i.test(String(f.value ?? '')))) {
        add('L4', e.line, `(${tag.type}:${tag.name})`);
      }

      if (tag.type === 'N' && inCombat
          && tag.fields.some((f) => f.delta && /^(hp|health|wounds?)$/i.test(f.key ?? ''))) {
        add('L5', e.line, `(N:${tag.name})`);
      }

      if (tag.type === 'Scenario' && !blockStack.includes('BATTLE')) add('L6', e.line);

      if (tag.type === 'Inv') {
        const qty = tag.fields[0];
        if (qty && qty.count != null) add('L7', e.line, `(Inv:${tag.name})`);
      }

      if (!tag.multiline && tag.raw !== serializeTag(tag)) {
        add('L8', e.line, `\`${tag.raw}\` -> \`${serializeTag(tag)}\``);
      }
    }
  }

  if (sawE && sawClock) add('L3', Math.min(eLine, clockLine));
  if (sawAsciiMult && sawUnicodeMult) add('L9', multLine);

  return findings.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}

/** @param {ReturnType<lint>} findings */
export function summarise(findings) {
  const by = { error: 0, warn: 0, info: 0 };
  for (const f of findings) by[f.severity]++;
  return by;
}
