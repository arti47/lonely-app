/**
 * Roll comparator (CLAUDE.md §8 Phase 4, ledger T3).
 *
 * **The user rolls; this module only compares.** There is no RNG here and there
 * must never be one (D2) — every function takes numbers the player entered and
 * returns what they mean, plus the canonical `d:` line to append.
 *
 * Nothing in here knows a game system. A mode describes the *shape* of a
 * comparison, not a ruleset, which is what lets the app stay system-agnostic
 * (D3).
 */

/** Comparison shapes the app can label. */
export const MODES = [
  { id: 'target', label: 'Roll vs target', hint: 'Sum the dice, add modifiers, compare to a number.' },
  { id: 'pool', label: 'Count successes', hint: 'Each die at or over the threshold is a success.' },
  { id: 'paired', label: 'Paired challenge dice', hint: 'One action total against two challenge dice.' },
  { id: 'keep', label: 'Keep highest / lowest', hint: 'Roll several, keep some, compare to a target.' },
  { id: 'fudge', label: 'Fudge / Fate ladder', hint: 'Count + and − faces, add a modifier.' },
  { id: 'bands', label: 'Degree bands', hint: 'Compare the total to ordered outcome bands.' },
];

const num = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  // An empty field is "not given", not zero — otherwise an omitted target
  // silently becomes a target of 0 and every roll succeeds.
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/* -------------------------------------------------------------------------- */
/* T3 — reading the comparison shorthand already written in a log             */
/* -------------------------------------------------------------------------- */

/**
 * Parse the comparison shorthand of core §3.2.1 out of a `d:` line body:
 * `5 vs TN 4`, `5≥4`, `2≤4 -> F`, `d20+4=17 vs AC 12 -> Hit`.
 *
 * @param {string} text the `d:` line with its prefix already removed
 * @returns {{left:number|null, operator:string|null, target:number|null,
 *            targetLabel:string|null, outcome:string|null, satisfied:boolean|null,
 *            flag:string|null}}
 */
export function parseComparison(text) {
  const s = String(text ?? '');
  const [body, ...rest] = s.split(/\s*(?:->|→)\s*/);
  const outcome = rest.length ? rest.join(' -> ').trim() : null;

  const out = {
    left: null, operator: null, target: null, targetLabel: null,
    outcome, satisfied: null, flag: null,
  };

  // Explicit success/fail flags (core §3.2.1): `d: 5≥4 S`.
  const flag = /(?:^|\s)([SF])\s*$/.exec(body);
  if (flag) out.flag = flag[1];
  const core = flag ? body.slice(0, flag.index) : body;

  // `vs TN 4`, `vs DC 15`, `vs AC 12`, `vs 4+`
  let m = /^(.*?)\s+vs\.?\s+([A-Za-z]{2,3})?\s*(-?\d+)\s*\+?\s*$/i.exec(core.trim());
  if (m) {
    out.left = leftValue(m[1]);
    out.operator = '>=';
    out.targetLabel = m[2] ? m[2].toUpperCase() : null;
    out.target = num(m[3]);
  } else {
    // `5≥4`, `2<=4`
    m = /^(.*?)(≥|≤|>=|<=)\s*(-?\d+)\s*$/.exec(core.trim());
    if (m) {
      out.left = leftValue(m[1]);
      out.operator = m[2] === '≥' ? '>=' : m[2] === '≤' ? '<=' : m[2];
      out.target = num(m[3]);
    }
  }

  if (out.left != null && out.target != null) {
    out.satisfied = out.operator === '<=' ? out.left <= out.target : out.left >= out.target;
  } else if (out.flag) {
    out.satisfied = out.flag === 'S';
  }

  return out;
}

/** The comparable number on the left of an operator: `d20+4=17` -> 17. */
function leftValue(s) {
  const text = String(s).trim();
  const eq = /=\s*(-?\d+)\s*$/.exec(text);
  if (eq) return num(eq[1]);
  const bare = /^(-?\d+)$/.exec(text);
  return bare ? num(bare[1]) : null;
}

/* -------------------------------------------------------------------------- */
/* Evaluating a roll the user has just entered                                */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {object} RollSpec
 * Numeric fields accept the raw strings typed into the entry fields; `num()`
 * normalises them, and an empty string means "not given".
 *
 * @property {string} mode one of MODES[].id
 * @property {string} [label] what was rolled, e.g. "Stealth"
 * @property {(number|string)[]} dice the numbers showing on the dice
 * @property {number|string} [modifier]
 * @property {number|string} [target]
 * @property {string} [targetLabel] TN / DC / AC …
 * @property {string} [compare] '>=' or '<=' (target mode)
 * @property {number|string} [threshold] pool mode
 * @property {number|string} [keep] keep mode: how many dice
 * @property {string} [keepWhich] 'high' or 'low'
 * @property {(number|string)[]} [challenge] paired mode
 * @property {number|string} [plus] fudge mode: count of + faces
 * @property {number|string} [minus] fudge mode: count of − faces
 * @property {{min?:number,max?:number,label:string}[]} [bands]
 */

/**
 * Compare entered numbers and label the result.
 * @param {RollSpec} spec
 * @returns {{total:number|null, outcome:string, detail:string, notes:string[]}}
 */
export function evaluate(spec) {
  const dice = (spec.dice ?? []).map(num).filter((n) => n != null);
  const mod = num(spec.modifier) ?? 0;
  const notes = [];

  switch (spec.mode) {
    case 'pool': {
      const threshold = num(spec.threshold) ?? 0;
      const hits = dice.filter((d) => d >= threshold).length;
      matchNote(dice, notes);
      return {
        total: hits,
        outcome: hits === 0 ? 'Failure' : hits === 1 ? '1 success' : `${hits} successes`,
        detail: `${dice.join(',')} vs ${threshold}+`,
        notes,
      };
    }

    case 'paired': {
      // One action total against two challenge dice (e.g. Ironsworn).
      const challenge = (spec.challenge ?? []).map(num).filter((n) => n != null);
      const total = sum(dice) + mod;
      const beaten = challenge.filter((c) => total > c).length;
      const outcome = beaten === challenge.length ? 'Strong Hit'
        : beaten === 0 ? 'Miss' : 'Weak Hit';
      if (challenge.length === 2 && challenge[0] === challenge[1]) notes.push('Match');
      return {
        total,
        outcome,
        detail: `${[...dice, ...(mod ? [mod] : [])].join('+')}=${total} vs ${challenge.join(',')}`,
        notes,
      };
    }

    case 'keep': {
      const keep = Math.max(1, num(spec.keep) ?? 1);
      const which = spec.keepWhich === 'low' ? 'low' : 'high';
      const sorted = [...dice].sort((a, b) => (which === 'high' ? b - a : a - b));
      const kept = sorted.slice(0, keep);
      const total = sum(kept) + mod;
      matchNote(dice, notes);
      const target = num(spec.target);
      return {
        total,
        outcome: target == null ? String(total) : (total >= target ? 'Success' : 'Fail'),
        detail: `${dice.join(',')} keep ${which === 'high' ? 'highest' : 'lowest'} ${keep} = ${kept.join('+')}`
          + `${mod ? (mod > 0 ? `+${mod}` : String(mod)) : ''}=${total}`
          + (target == null ? '' : ` vs ${spec.targetLabel ?? 'TN'} ${target}`),
        notes,
      };
    }

    case 'fudge': {
      // dF ladders: count the + and − faces rather than summing pips.
      const plus = num(spec.plus) ?? 0;
      const minus = num(spec.minus) ?? 0;
      const total = plus - minus + mod;
      const target = num(spec.target);
      return {
        total,
        outcome: target == null
          ? (total > 0 ? `+${total}` : String(total))
          : (total >= target ? 'Success' : 'Fail'),
        detail: `${plus}+ / ${minus}− = ${plus - minus}${mod ? (mod > 0 ? `+${mod}` : String(mod)) : ''}`
          + `=${total > 0 ? '+' : ''}${total}`
          + (target == null ? '' : ` vs ${spec.targetLabel ?? 'TN'} ${target}`),
        notes,
      };
    }

    case 'bands': {
      const total = sum(dice) + mod;
      const band = (spec.bands ?? []).find((b) =>
        (b.min == null || total >= b.min) && (b.max == null || total <= b.max));
      matchNote(dice, notes);
      return {
        total,
        outcome: band?.label ?? String(total),
        detail: `${dice.join('+')}${mod ? (mod > 0 ? `+${mod}` : String(mod)) : ''}=${total}`,
        notes,
      };
    }

    case 'target':
    default: {
      const total = sum(dice) + mod;
      const target = num(spec.target);
      const op = spec.compare === '<=' ? '<=' : '>=';
      matchNote(dice, notes);
      if (target == null) return { total, outcome: String(total), detail: String(total), notes };
      const ok = op === '<=' ? total <= target : total >= target;
      return {
        total,
        outcome: ok ? 'Success' : 'Fail',
        detail: `${dice.join('+')}${mod ? (mod > 0 ? `+${mod}` : String(mod)) : ''}=${total}`
          + ` vs ${spec.targetLabel ?? 'TN'} ${target}`,
        notes,
      };
    }
  }
}

/** Doubles/triples are meaningful in several systems; surface them, never act. */
function matchNote(dice, notes) {
  if (dice.length < 2) return;
  const counts = new Map();
  for (const d of dice) counts.set(d, (counts.get(d) ?? 0) + 1);
  const repeated = [...counts.entries()].filter(([, n]) => n > 1);
  if (repeated.length) notes.push(`Match: ${repeated.map(([v, n]) => `${n}×${v}`).join(', ')}`);
}

/**
 * Build the `d:` line for an evaluated roll (core §3.2).
 * @param {RollSpec} spec
 * @param {ReturnType<evaluate>} result
 * @returns {string}
 */
export function rollLine(spec, result) {
  const label = String(spec.label ?? '').trim();
  const notes = result.notes.length ? `, ${result.notes.join(', ')}` : '';
  return `d: ${label ? `${label} ` : ''}${result.detail} -> ${result.outcome}${notes}`;
}

/* -------------------------------------------------------------------------- */
/* Oracle                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A generic yes/no oracle ladder.
 *
 * **House aid** (CLAUDE.md §9.8): the app ships no publisher's oracle. These are
 * plain d100 thresholds so the tool is usable with nothing configured; anyone
 * using a specific oracle should read its own table and enter the answer.
 */
export const ODDS = [
  { id: 'certain', label: 'Almost certain', threshold: 90 },
  { id: 'likely', label: 'Likely', threshold: 75 },
  { id: 'even', label: 'Even odds', threshold: 50 },
  { id: 'unlikely', label: 'Unlikely', threshold: 25 },
  { id: 'remote', label: 'Almost impossible', threshold: 10 },
];

/**
 * Resolve a yes/no question from a rolled d100.
 *
 * Extremes read as "and" results — the far ends of the range intensify the
 * answer, which is the shape every yes/no oracle shares (core §3.2.2).
 *
 * @param {string} oddsId
 * @param {number} roll 1–100
 * @returns {{answer:string, threshold:number, line:(question:string)=>string[]}}
 */
export function resolveOracle(oddsId, roll) {
  const odds = ODDS.find((o) => o.id === oddsId) ?? ODDS[2];
  const n = num(roll) ?? 0;
  const yes = n <= odds.threshold;

  let answer;
  if (yes && n <= Math.max(1, Math.round(odds.threshold * 0.2))) answer = 'Yes, and...';
  else if (yes && n > odds.threshold - Math.round(odds.threshold * 0.2)) answer = 'Yes, but...';
  else if (yes) answer = 'Yes';
  else if (n >= 100 - Math.round((100 - odds.threshold) * 0.2)) answer = 'No, and...';
  else if (n < odds.threshold + Math.round((100 - odds.threshold) * 0.2)) answer = 'No, but...';
  else answer = 'No';

  return {
    answer,
    threshold: odds.threshold,
    line: (question) => [
      `? ${String(question).trim()} (${odds.label})`,
      `d: d100=${n} vs ${odds.threshold} -> ${answer}`,
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Table lookup                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Look a rolled number up in a table folded out of the log (core §4.3.1–2).
 * @param {object} table from `state.tables`
 * @param {number} roll
 * @returns {{result:string|null, line:string|null}}
 */
export function lookup(table, roll) {
  const n = num(roll);
  if (!table || n == null) return { result: null, line: null };

  if (table.entries?.length) {
    const hit = table.entries.find((e) => n >= e.min && n <= e.max);
    const result = hit ? hit.result : null;
    return {
      result,
      line: result == null ? null : `tbl: ${table.name} ${table.die ?? 'd?'}=${n} -> ${result}`,
    };
  }

  if (table.options?.length) {
    const index = Math.min(Math.max(n, 1), table.options.length) - 1;
    const result = table.options[index];
    return { result, line: `tbl: ${table.name} d${table.options.length}=${n} -> ${result}` };
  }

  return { result: null, line: null };
}

/** The die a table implies, for the entry prompt. */
export function tableDie(table) {
  if (!table) return null;
  if (table.die) return table.die;
  if (table.options?.length) return `d${table.options.length}`;
  if (table.entries?.length) return `d${Math.max(...table.entries.map((e) => e.max))}`;
  return null;
}
