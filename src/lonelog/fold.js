/**
 * Lonelog fold: Entry[] -> CampaignState.
 *
 * The log is the source of truth (CLAUDE.md §5.1). Nothing here reads or writes
 * storage; state is a pure function of the entries, so folding from a scene
 * checkpoint must equal folding from zero (§9.5).
 *
 * Every value carries the line index that last set it (§5.7).
 */

const ADDON_BY_TYPE = new Map([
  ['F', 'combat'], ['R', 'dungeon'],
  ['Inv', 'resources'], ['Wealth', 'resources'],
  ['Unit', 'wargaming'], ['Force', 'wargaming'], ['Scenario', 'wargaming'],
]);

const ADDON_BY_BLOCK = new Map([
  ['COMBAT', 'combat'], ['DUNGEON STATUS', 'dungeon'],
  ['RESOURCES', 'resources'], ['BATTLE', 'wargaming'], ['CAMPAIGN', 'wargaming'],
]);

/** Types whose size is a model count, so a numeric change is a casualty. */
const COUNTABLE_TYPES = new Set(['F', 'Unit']);

/** Room status vocabulary (dungeon §1.1, Quick Reference). Combinable. */
export const ROOM_STATUS = [
  'unexplored', 'active', 'cleared', 'looted', 'locked', 'trapped', 'safe', 'collapsed',
];

/**
 * Tags the specs give a *positional* field format for. A slot named here is
 * free text — reading `Exit 2+ units south` as the stat `Exit` mangles the
 * scenario's objective, and reading `entry cave` as a room status states
 * something the log never said.
 *
 * `null` leaves the slot to the general rules: a room's first field is its
 * status list (dungeon §1.1), which is flags.
 */
const POSITIONAL_SLOTS = {
  R: [null, 'desc'],                                   // dungeon §1
  Force: ['commander', 'strength', 'objective'],       // wargaming §2
  Scenario: ['objective', 'turns'],                    // wargaming §3
};

const RE_SESSION = /^(?:={2,}\s*)?Session\s+(\d+)/i;
const RE_CAMPAIGN = /^={2,}\s*Campaign Log:\s*(.+?)\s*={2,}$/i;
// The same header once its heading delimiters have been read off (core §5.1).
const RE_CAMPAIGN_TITLE = /^Campaign Log:\s*(.+?)\s*$/i;

/** @returns {object} an empty CampaignState */
export function createState() {
  return {
    meta: {},
    elements: new Map(),      // "Type:name" -> element
    scenes: [],
    sessions: [],
    blockStack: [],
    blocks: [],
    tables: new Map(),       // core §4.3.1–2 — defined inline in the log
    generators: new Map(),   // core §4.3.3
    addons: new Set(),
    marker: { scene: null, round: null, turn: null },
    counts: { entries: 0, tags: 0, rolls: 0, questions: 0, consequences: 0, lookups: 0 },
    openTable: null,
    openGenerator: null,
    pendingMeta: null,       // analog header field awaiting the value beneath it
    lastLine: -1,
  };
}

/**
 * @param {object[]} entries
 * @param {{state?:object, from?:number, to?:number}} [opts]
 * @returns {object} state
 */
export function fold(entries, opts = {}) {
  const state = opts.state ?? createState();
  const from = opts.from ?? 0;
  const to = opts.to ?? entries.length;
  for (let i = from; i < to; i++) applyEntry(state, entries[i]);
  return state;
}

/**
 * Fold, snapshotting state at every scene boundary so the UI can re-fold only
 * the tail after an edit (CLAUDE.md §5.1).
 * @param {object[]} entries
 * @returns {{state:object, checkpoints:{entryIndex:number,lineIndex:number,state:object}[]}}
 */
export function foldWithCheckpoints(entries) {
  const state = createState();
  const checkpoints = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.kind === 'marker' && e.marker?.kind === 'scene') {
      checkpoints.push({ entryIndex: i, lineIndex: e.line, state: snapshot(state) });
    }
    applyEntry(state, e);
  }
  return { state, checkpoints };
}

/** Deep copy of a state, safe to retain. */
export function snapshot(state) {
  return structuredClone(state);
}

function applyEntry(state, e) {
  if (!e) return;
  state.counts.entries++;
  state.lastLine = e.line;

  // An analog header field may put its value on the line beneath it (core §5.1,
  // §5.2.2). Anything that is not that value ends the wait.
  const pending = state.pendingMeta;
  state.pendingMeta = null;
  if (pending && e.kind === 'prose' && (e.text ?? '').trim()) {
    setMeta(state, pending, e.text.trim(), e.line);
    return;
  }

  switch (e.kind) {
    case 'frontmatter':
      // Front matter is metadata, but core §5.1 writes a real `[PC:]` tag into
      // it — so its tags establish elements like any other line.
      if (!e.delimiter) readFrontmatter(state, e.raw);
      break;
    case 'metaField': {
      if (e.text) setMeta(state, e, e.text, e.line);
      else state.pendingMeta = e;
      return;
    }
    case 'heading': {
      // `## Session 1` and `=== Session 1 ===` are the same construct, and the
      // lexer now says so — the fold reads one branch for both (T25, T27).
      const m = RE_SESSION.exec(e.title ?? '');
      if (m) {
        state.sessions.push({ number: Number(m[1]), title: sessionTitle(e.title), line: e.line });
        return;
      }
      const c = RE_CAMPAIGN_TITLE.exec(e.title ?? '');
      if (c) state.meta.title = { value: c[1], line: e.line };
      return;
    }
    case 'tbl': {
      applyTable(state, e);
      break;
    }
    case 'tableEntry': {
      const table = state.openTable && state.tables.get(state.openTable);
      if (table) table.entries.push({ min: e.min, max: e.max, result: e.result, line: e.line });
      return;
    }
    case 'gen': {
      if (e.generator?.name) {
        state.openGenerator = e.generator.name.toLowerCase();
        if (!state.generators.has(state.openGenerator)) {
          state.generators.set(state.openGenerator, { name: e.generator.name, axes: [], line: e.line });
        } else {
          // A generator rolled again replaces its previous axis results.
          state.generators.get(state.openGenerator).axes = [];
        }
      }
      state.openTable = null;
      break;
    }
    case 'genAxis': {
      const gen = state.openGenerator && state.generators.get(state.openGenerator);
      if (gen) gen.axes.push({ axis: e.axis, roll: e.roll, result: e.result, line: e.line });
      return;
    }
    case 'sessionMeta': {
      // Attaches to the session it sits under (core §5.2.1).
      const session = state.sessions[state.sessions.length - 1];
      if (session) session.meta = { ...(session.meta ?? {}), ...e.meta };
      return;
    }
    case 'block': {
      const addon = ADDON_BY_BLOCK.get(e.name);
      if (addon) state.addons.add(addon);
      if (e.closing) {
        const open = state.blockStack.pop();
        if (open) { open.endLine = e.line; state.blocks.push(open); }
      } else {
        state.blockStack.push({ name: e.name, form: e.form, startLine: e.line, endLine: null });
      }
      return;
    }
    case 'marker':
      applyMarker(state, e);
      break;
    case 'dice': state.counts.rolls++; break;
    case 'question': state.counts.questions++; break;
    case 'consequence': state.counts.consequences++; break;
    case 'prose': {
      const c = RE_CAMPAIGN.exec(e.text ?? '');
      if (c) { state.meta.title = { value: c[1], line: e.line }; return; }
      const s = RE_SESSION.exec(e.text ?? '');
      if (s) state.sessions.push({ number: Number(s[1]), title: sessionTitle(e.text), line: e.line });
      break;
    }
    default: break;
  }

  for (const tag of e.tags ?? []) applyTag(state, tag, e.line);
}

/** Record inline table definitions, option sets and lookups (core §4.3). */
function applyTable(state, e) {
  const spec = e.table;
  state.openGenerator = null;
  if (!spec) { state.openTable = null; return; }

  // `tbl: d100=42 -> "A broken sword"` names no table but is still a lookup.
  if (spec.kind === 'lookup') state.counts.lookups = (state.counts.lookups ?? 0) + 1;

  if (!spec.name) { state.openTable = null; return; }

  const key = spec.name.toLowerCase();

  if (spec.kind === 'definition') {
    state.tables.set(key, { name: spec.name, die: spec.die, entries: [], options: [], line: e.line });
    state.openTable = key;
    return;
  }

  if (spec.kind === 'options') {
    state.tables.set(key, {
      name: spec.name, die: null, entries: [], options: [...spec.options], line: e.line,
    });
    state.openTable = null;
    return;
  }

  state.openTable = null;
  if (spec.kind === 'lookup') {
    const table = state.tables.get(key);
    if (table && spec.die && !table.die) table.die = spec.die;
  }
}

function applyMarker(state, e) {
  const m = e.marker;
  if (m.kind === 'scene') {
    // A block opened in a scene header runs until the next scene (combat §1.1).
    while (state.blockStack.length && state.blockStack[state.blockStack.length - 1].implicit) {
      const open = state.blockStack.pop();
      open.endLine = e.line;
      state.blocks.push(open);
    }
    state.marker.scene = m;
    state.marker.round = null;
    state.marker.turn = null;
    state.scenes.push({ ...m, line: e.line, context: sceneContext(e.rest) });

    if (e.opensBlock) {
      const addon = ADDON_BY_BLOCK.get(e.opensBlock);
      if (addon) state.addons.add(addon);
      state.blockStack.push({
        name: e.opensBlock, form: 'digital', startLine: e.line, endLine: null, implicit: true,
      });
    }
  } else if (m.kind === 'round') {
    state.marker.round = m;
    state.addons.add('combat');
  } else if (m.kind === 'turn') {
    state.marker.turn = m;
    state.addons.add('wargaming');
  }
}

/**
 * The session's name without the decoration of whichever form wrote it — the
 * digital `## Session 1` and the analog `=== Session 1 ===` are the same
 * session (core §5.2.1 vs §5.2.2), so they must fold to the same title.
 * @param {string} raw
 */
function sessionTitle(raw = '') {
  return String(raw).replace(/^\s*=+\s*/, '').replace(/\s*=+\s*$/, '').trim();
}

function sceneContext(rest = '') {
  const m = /\*([^*]+)\*/.exec(rest);
  return m ? m[1].trim() : (rest.trim() || null);
}

/**
 * File an analog header field where its own header keeps it: the campaign's
 * fields on the campaign, the session's on the session it sits under. This is
 * what makes the analog header fold like the digital one it mirrors (T24–T27).
 */
function setMeta(state, entry, value, line) {
  const key = entry.metaKey.trim().toLowerCase();
  const session = state.sessions[state.sessions.length - 1];
  const toSession = session && (entry.scope === 'session' || (entry.scope === 'either' && session));
  if (toSession) {
    session.meta = { ...(session.meta ?? {}), [key]: value };
    return;
  }
  state.meta[key] = { value, line };
}

function readFrontmatter(state, raw) {
  const m = /^\s*([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(raw);
  if (m) state.meta[m[1]] = { value: m[2].trim(), line: -1 };
}

/** Stable registry key. Element identity is type + case-insensitive name. */
export function elementKey(type, name) {
  return `${type}:${String(name).trim().toLowerCase()}`;
}

function applyTag(state, tag, line) {
  state.counts.tags++;
  const addon = ADDON_BY_TYPE.get(tag.type);
  if (addon) state.addons.add(addon);

  const { name, extra } = compactHead(state, tag);
  const key = elementKey(tag.type, name);
  let el = state.elements.get(key);
  if (!el) {
    el = {
      type: tag.type, name, count: null,
      fields: new Map(), flags: new Map(),
      progress: null, value: null,
      firstLine: line, lastLine: line, refs: [], history: [],
    };
    state.elements.set(key, el);
  }

  el.history.push({ line, raw: tag.raw });

  // A reference tag asserts nothing about state (core §4.1.6).
  if (tag.ref) { el.refs.push(line); return; }

  el.lastLine = line;
  if (tag.count != null) el.count = { value: tag.count, line };

  applyHead(el, tag.head, line);
  if (extra) applyField(el, extra, line, -1);
  tag.fields.forEach((f, index) => applyField(el, f, line, index));
}

const RE_HEAD_DELTA = /^(.*\S)\s+([A-Za-z][\w'-]*)\s*([+-])\s*(\d+)$/;
const RE_HEAD_STAT = /^([A-Za-z][\w'-]*)\s+(-?\d+(?:\s*\/\s*\d+)?)$/;

/**
 * The compact forms the specs write when a pipe would be noise: `[N: Jordan
 * HP-4]` and, in a round roster, `[PC:HP 3]` for the character whose name goes
 * without saying (combat §5.2, §7). Read literally, both make an element named
 * after its own stat — a phantom NPC called "Jordan HP-4", a phantom PC called
 * "HP 3" — and the real character never changes.
 *
 * A bare trailing number stays part of the name for every other type, which is
 * what keeps `[F:Pirate 1]` and `[Inv:Slot 1]` distinct (audit A1).
 *
 * @returns {{name:string, extra:object|null}}
 */
function compactHead(state, tag) {
  const plain = tag.head == null && tag.count == null && !tag.ref;
  if (!plain) return { name: tag.name, extra: null };

  const delta = RE_HEAD_DELTA.exec(tag.name);
  if (delta) {
    return {
      name: delta[1].trim(),
      extra: { raw: `${delta[2]}${delta[3]}${delta[4]}`, op: 'set', key: delta[2], value: null,
        count: null, delta: { sign: delta[3], amount: Number(delta[4]) },
        progress: null, transition: null, list: null },
    };
  }

  // Only the PC may go unnamed: it is the one character a solo log never has to
  // introduce, and it is never one of a numbered group.
  if (tag.type !== 'PC') return { name: tag.name, extra: null };
  const stat = RE_HEAD_STAT.exec(tag.name);
  if (!stat) return { name: tag.name, extra: null };
  // A character the log has already introduced under that exact name is that
  // character, whatever it looks like.
  if (state.elements.has(elementKey('PC', tag.name))) return { name: tag.name, extra: null };

  const pcs = [...state.elements.values()].filter((e) => e.type === 'PC');
  return {
    name: pcs.length === 1 ? pcs[0].name : 'PC',
    extra: { raw: tag.name, op: 'set', key: stat[1], value: stat[2].replace(/\s+/g, ''),
      count: null, delta: null, progress: null, transition: null, list: null },
  };
}

function applyHead(el, head, line) {
  if (!head) return;
  switch (head.kind) {
    case 'progress':
      el.progress = { current: head.current, total: head.total, line };
      break;
    case 'value':
      el.value = { value: head.value, line };
      break;
    case 'transition':
      // `[F:Skeleton 2->1]` is the group losing one, not a separate value
      // (combat §3.2), so keep the count and the value from diverging.
      if (COUNTABLE_TYPES.has(el.type) && /^\d+$/.test(head.to)) {
        el.count = { value: Number(head.to), line };
      } else {
        el.value = { value: head.to, line };
      }
      break;
    case 'delta': {
      const base = numeric(el.value?.value) ?? 0;
      el.value = { value: String(head.sign === '+' ? base + head.amount : base - head.amount), line };
      break;
    }
    default: break;
  }
}

function applyField(el, f, line, index = 0) {
  // Room status is one field that may list several states — `cleared, looted`
  // (dungeon §1.1) — so it splits into flags that can be tested individually.
  if (el.type === 'R' && index === 0 && !f.key && f.op === 'set'
      && !f.transition && typeof f.value === 'string' && f.value.includes(',')) {
    for (const part of f.value.split(',').map((s) => s.trim()).filter(Boolean)) {
      el.flags.set(part, line);
    }
    return;
  }

  const slot = positionalSlot(el, f, index);
  if (slot) { el.fields.set(slot, { value: f.raw.trim(), line }); return; }

  if (f.op === 'add' && !f.key) { el.flags.set(f.value, line); return; }
  if (f.op === 'remove' && !f.key) {
    // `-Stress` reads as "this no longer applies". Core §4.1.1 shows the form
    // removing a flag; a named stat is the same idea, so whichever the element
    // actually holds under that name is what goes. A field wins when both
    // exist, because a stat is the more specific thing to have named.
    if (el.fields.has(f.value)) el.fields.delete(f.value);
    else el.flags.delete(f.value);
    return;
  }

  if (f.count != null && !f.key) { el.count = { value: f.count, line }; return; }

  if (!f.key) {
    // A bare number in the first field is the element's quantity, not a flag —
    // `[Inv:Torch|4]` then `[Inv:Torch-1]` has to land on the same value
    // (resources §1.2).
    if (/^-?\d+$/.test(String(f.value).trim())) { el.value = { value: String(f.value).trim(), line }; return; }
    // `[Clock:Suspicion|3/6]` — the tag builder writes the fill as a field, and
    // a reader may too. It is the meter, not a flag named "3/6".
    if (f.progress) { el.progress = { current: f.progress.current, total: f.progress.total, line }; return; }
    const bare = /^(\d+)\s*\/\s*(\d+)$/.exec(String(f.value ?? '').trim());
    if (bare) {
      el.progress = { current: Number(bare[1]), total: Number(bare[2]), line };
      return;
    }
    if (f.transition) {
      if (/^-?\d+$/.test(f.transition.from) && /^-?\d+$/.test(f.transition.to)) {
        el.value = { value: f.transition.to, line };
        return;
      }
      el.flags.delete(f.transition.from);
      el.flags.set(f.transition.to, line);
      return;
    }
    if (f.value !== '') el.flags.set(f.value, line);
    return;
  }

  if (f.op === 'remove') { el.fields.delete(f.key); return; }

  if (f.transition) { el.fields.set(f.key, { value: f.transition.to, line }); return; }
  if (f.progress) {
    el.fields.set(f.key, { value: `${f.progress.current}/${f.progress.total}`, line, progress: { ...f.progress } });
    return;
  }
  if (f.delta) {
    const prev = el.fields.get(f.key);
    const applied = applyDelta(prev, f.delta);
    el.fields.set(f.key, { ...applied, line });
    return;
  }
  if (f.list) { el.fields.set(f.key, { value: f.list.join(', '), line, list: [...f.list] }); return; }
  el.fields.set(f.key, { value: f.value, line });
}

/**
 * The name of the documented slot this field occupies, or `null` when the
 * general field rules apply. Only a plain field can fill a slot — a delta, a
 * transition or an add/remove is an *update*, and updates are not positional.
 */
function positionalSlot(el, f, index) {
  const name = POSITIONAL_SLOTS[el.type]?.[index];
  if (!name) return null;
  if (f.op !== 'set' || f.transition || f.delta || f.count != null || f.exits) return null;
  const raw = String(f.raw ?? '').trim();
  if (!raw) return null;
  // `[R:1|cleared|looted]` is two statuses, not a room described as "looted".
  if (el.type === 'R' && raw.split(',').every((p) => ROOM_STATUS.includes(p.trim().toLowerCase()))) {
    return null;
  }
  return name;
}

/** `HP-2` against `HP 12/15` moves the current value, not the maximum. */
function applyDelta(prev, delta) {
  const step = delta.sign === '+' ? delta.amount : -delta.amount;
  if (prev?.progress) {
    const current = prev.progress.current + step;
    return { value: `${current}/${prev.progress.total}`, progress: { current, total: prev.progress.total } };
  }
  const base = numeric(prev?.value);
  if (base == null) return { value: prev?.value ?? String(step), pending: step };
  return { value: String(base + step) };
}

function numeric(v) {
  if (v == null) return null;
  const m = /^(-?\d+(?:\.\d+)?)/.exec(String(v).trim());
  return m ? Number(m[1]) : null;
}

/**
 * Look a table up by name, case-insensitively (core §4.3.1).
 * @param {object} state @param {string} name
 */
export function getTable(state, name) {
  return state.tables.get(String(name).trim().toLowerCase()) ?? null;
}

/** @param {object} state */
export function tablesOf(state) {
  return [...state.tables.values()];
}

/**
 * Read a folded element back out.
 * @param {object} state
 * @param {string} type
 * @param {string} name
 */
export function getElement(state, type, name) {
  return state.elements.get(elementKey(type, name)) ?? null;
}

/** All elements of a type, in first-seen order. */
export function elementsOfType(state, type) {
  return [...state.elements.values()].filter((el) => el.type === type);
}
