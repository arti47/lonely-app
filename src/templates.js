/**
 * Learned roll templates and packs (CLAUDE.md §8 Phase 7, D4).
 *
 * A template is never authored up front. The app watches the `d:` lines you
 * actually write, and once the same *shape* has appeared a few times it offers
 * to save it. A pack is therefore a by-product of having played, not a
 * prerequisite for playing (D3, D4).
 *
 * Pure module: no storage, no DOM, no RNG.
 */

import { parseComparison } from './compare.js';

/** How many times a shape must appear before it is worth offering. */
export const REPEAT_THRESHOLD = 3;

const RE_DICE = /(\d*)d(\d+|F)/gi;
const RE_ROLLED = /=\s*-?\d+(?:\s*,\s*-?\d+)*/g;

/**
 * Reduce a `d:` line to its shape by abstracting the numbers that change from
 * roll to roll, keeping the ones that describe the roll.
 *
 * `Stealth d6=5 vs TN 4` and `Stealth d6=2 vs TN 4` share the shape
 * `Stealth d6=# vs TN 4`; a different target is a different shape, because it
 * is a different roll.
 *
 * @param {string} text a `d:` line body, prefix already stripped
 * @returns {string}
 */
export function shapeOf(text) {
  const body = String(text ?? '').split(/\s*(?:->|→)\s*/)[0];
  return body
    .replace(RE_ROLLED, '=#')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Find shapes worth offering as a quick roll.
 * @param {object[]} entries lexed log entries
 * @param {{min?:number, known?:Iterable<string>}} [opts]
 * @returns {{shape:string, count:number, sample:string, lastLine:number}[]}
 */
export function detectRepeats(entries, opts = {}) {
  const min = opts.min ?? REPEAT_THRESHOLD;
  const known = new Set(opts.known ?? []);
  const seen = new Map();

  for (const entry of entries) {
    if (entry.kind !== 'dice') continue;
    const shape = shapeOf(entry.text);
    if (!shape || known.has(shape)) continue;
    const record = seen.get(shape) ?? { shape, count: 0, sample: entry.text, lastLine: entry.line };
    record.count += 1;
    record.lastLine = entry.line;
    seen.set(shape, record);
  }

  return [...seen.values()]
    .filter((r) => r.count >= min)
    .sort((a, b) => b.count - a.count || a.shape.localeCompare(b.shape));
}

/**
 * Build a template from a shape the log already contains.
 * @param {string} shape
 * @param {{id?:string, count?:number}} [opts]
 */
export function templateFromShape(shape, opts = {}) {
  const comparison = parseComparison(shape);

  const inputs = [];
  RE_DICE.lastIndex = 0;
  let m;
  while ((m = RE_DICE.exec(shape)) !== null) {
    const howMany = m[1] ? Number(m[1]) : 1;
    const faces = m[2].toUpperCase() === 'F' ? 'F' : Number(m[2]);
    for (let i = 0; i < howMany; i++) inputs.push({ label: `d${m[2]}`, die: faces });
  }

  // Named additions read as modifiers the player supplies: `d20+Lockpicking`.
  const modifiers = [...shape.matchAll(/\+\s*([A-Za-z][\w' -]*)/g)]
    .map((x) => x[1].trim())
    .filter((x) => !/^\d+$/.test(x));

  const label = leadingLabel(shape);

  return {
    id: opts.id ?? `tpl-${slugOf(shape)}`,
    shape,
    label: label || shape,
    mode: inputs.length > 1 && comparison.target == null ? 'pool' : 'target',
    inputs: inputs.length ? inputs : [{ label: 'roll', die: null }],
    modifiers,
    target: comparison.target,
    targetLabel: comparison.targetLabel,
    compare: comparison.operator === '<=' ? '<=' : '>=',
    seenCount: opts.count ?? 0,
  };
}

/** The words before the first die notation — usually the skill being rolled. */
function leadingLabel(shape) {
  const idx = shape.search(/\d*d\d+|=/i);
  const head = (idx > 0 ? shape.slice(0, idx) : '').trim();
  return head.replace(/[+\-,]$/, '').trim();
}

function slugOf(s) {
  return String(s).toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'roll';
}

/**
 * Turn a saved template plus entered numbers into a spec `compare.evaluate`
 * understands. The numbers still come from the player (D2).
 * @param {object} template
 * @param {{dice?:(string|number)[], modifier?:string|number}} values
 */
export function applyTemplate(template, values = {}) {
  return {
    mode: template.mode ?? 'target',
    label: template.label,
    dice: values.dice ?? [],
    modifier: values.modifier ?? '',
    target: template.target ?? '',
    targetLabel: template.targetLabel ?? 'TN',
    compare: template.compare ?? '>=',
    threshold: template.target ?? '',
  };
}

/* --------------------------------- packs --------------------------------- */

export const PACK_KIND = 'lonely-roll-pack';

/**
 * @param {string} name
 * @param {object[]} templates
 */
export function toPack(name, templates) {
  return {
    app: 'lonely-app',
    kind: PACK_KIND,
    version: 1,
    name: String(name ?? 'Untitled pack').trim() || 'Untitled pack',
    exportedAt: new Date().toISOString(),
    templates: templates.map((t) => ({ ...t, packId: undefined })),
  };
}

/**
 * Validate and normalise an imported pack. Throws with a readable message
 * rather than importing something malformed.
 * @param {any} data
 * @returns {{name:string, templates:object[]}}
 */
export function fromPack(data) {
  if (!data || data.app !== 'lonely-app' || data.kind !== PACK_KIND) {
    throw new Error('Not a Lonely roll pack.');
  }
  if (!Array.isArray(data.templates)) throw new Error('That pack contains no templates.');

  const packId = `pack-${slugOf(data.name ?? 'pack')}`;
  const templates = data.templates
    .filter((t) => t && typeof t.shape === 'string')
    .map((t) => ({
      ...templateFromShape(t.shape, { id: t.id, count: t.seenCount }),
      ...t,
      packId,
    }));

  if (!templates.length) throw new Error('That pack contains no usable templates.');
  return { name: String(data.name ?? 'Imported pack'), templates };
}
