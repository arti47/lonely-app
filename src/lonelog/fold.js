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

const RE_SESSION = /^(?:={2,}\s*)?Session\s+(\d+)/i;
const RE_CAMPAIGN = /^={2,}\s*Campaign Log:\s*(.+?)\s*={2,}$/i;

/** @returns {object} an empty CampaignState */
export function createState() {
  return {
    meta: {},
    elements: new Map(),      // "Type:name" -> element
    scenes: [],
    sessions: [],
    blockStack: [],
    blocks: [],
    addons: new Set(),
    marker: { scene: null, round: null, turn: null },
    counts: { entries: 0, tags: 0, rolls: 0, questions: 0, consequences: 0 },
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

  switch (e.kind) {
    case 'frontmatter':
      if (!e.delimiter) readFrontmatter(state, e.raw);
      return;
    case 'heading': {
      const m = RE_SESSION.exec(e.title ?? '');
      if (m) state.sessions.push({ number: Number(m[1]), title: e.title, line: e.line });
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
      if (s) state.sessions.push({ number: Number(s[1]), title: e.text, line: e.line });
      break;
    }
    default: break;
  }

  for (const tag of e.tags ?? []) applyTag(state, tag, e.line);
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

function sceneContext(rest = '') {
  const m = /\*([^*]+)\*/.exec(rest);
  return m ? m[1].trim() : (rest.trim() || null);
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

  const key = elementKey(tag.type, tag.name);
  let el = state.elements.get(key);
  if (!el) {
    el = {
      type: tag.type, name: tag.name, count: null,
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
  for (const f of tag.fields) applyField(el, f, line);
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
      el.value = { value: head.to, line };
      break;
    case 'delta': {
      const base = numeric(el.value?.value) ?? 0;
      el.value = { value: String(head.sign === '+' ? base + head.amount : base - head.amount), line };
      break;
    }
    default: break;
  }
}

function applyField(el, f, line) {
  if (f.op === 'add' && !f.key) { el.flags.set(f.value, line); return; }
  if (f.op === 'remove' && !f.key) { el.flags.delete(f.value); return; }

  if (f.count != null && !f.key) { el.count = { value: f.count, line }; return; }

  if (!f.key) {
    // A bare number in the first field is the element's quantity, not a flag —
    // `[Inv:Torch|4]` then `[Inv:Torch-1]` has to land on the same value
    // (resources §1.2).
    if (/^-?\d+$/.test(String(f.value).trim())) { el.value = { value: String(f.value).trim(), line }; return; }
    if (f.transition) {
      if (/^-?\d+$/.test(f.transition.from) && /^-?\d+$/.test(f.transition.to)) {
        el.value = { value: f.transition.to, line };
        return;
      }
      el.flags.delete(f.transition.from);
      el.flags.set(f.transition.to, line);
      return;
    }
    if (f.progress) { el.progress = { current: f.progress.current, total: f.progress.total, line }; return; }
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
