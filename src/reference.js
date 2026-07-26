/**
 * Searchable notation reference (CLAUDE.md §8 Phase 8).
 *
 * Every entry is a paraphrase written for this app, with a citation back to the
 * vendored spec (§10 — never reproduce spec prose). Examples are the minimum
 * needed to show the shape.
 *
 * `entryFor(id)` is what automated surfaces link to, so a control can always
 * explain the notation it is about to write.
 */

/**
 * @typedef {{id:string, title:string, group:string, syntax:string,
 *   summary:string, spec:string, examples:string[], keywords?:string[]}} Entry
 */

/** @type {Entry[]} */
export const ENTRIES = [
  // --- core symbols ---
  {
    id: 'action', title: 'Action', group: 'Core symbols', syntax: '@ Action',
    summary: 'Something you do. `@(Name)` attributes the action to another actor — a companion, an ally, an enemy.',
    spec: 'core §3.1, §3.1.1',
    examples: ['@ Pick the lock', '@(Jonah) Keeps watch at the door'],
    keywords: ['do', 'actor', 'pc'],
  },
  {
    id: 'question', title: 'Oracle question', group: 'Core symbols', syntax: '? Question',
    summary: 'A question put to the world rather than to the rules. Answer it with a roll, a table, or `->` alone.',
    spec: 'core §3.1',
    examples: ['? Is anyone inside?', '? Does the rope hold?'],
    keywords: ['oracle', 'ask'],
  },
  {
    id: 'dice', title: 'Roll', group: 'Core symbols', syntax: 'd: roll -> outcome',
    summary: 'Any resolution by dice or rule, for mechanics and oracles alike. Record what you rolled and what it meant.',
    spec: 'core §3.2.1, §3.2.2',
    examples: ['d: Stealth d6=5 vs TN 4 -> Success', 'd: d100=60 vs 35 -> No'],
    keywords: ['roll', 'mechanics', 'check'],
  },
  {
    id: 'resolution', title: 'Resolution', group: 'Core symbols', syntax: '-> result',
    summary: 'The outcome of a roll or question. Used alone when the dice detail is not worth recording.',
    spec: 'core §3.2.2',
    examples: ['-> Yes, but... (d6=4)', '-> Strong Hit'],
    keywords: ['outcome', 'answer', 'arrow'],
  },
  {
    id: 'consequence', title: 'Consequence', group: 'Core symbols', syntax: '=> consequence',
    summary: 'What the fiction does next. Consequences only — never a dice outcome, and never an equals sign between tags.',
    spec: 'core §3.3, Appendix C',
    examples: ['=> The door opens, but the hinges squeal.', '=> [N:Guard|+alert]'],
    keywords: ['result', 'narrative', 'then'],
  },

  // --- adjacent line markers ---
  {
    id: 'tbl', title: 'Table lookup', group: 'Tables & generators', syntax: 'tbl: Name d6=5 -> Result',
    summary: 'A roll on a named table. Define the table in the log and it stays readable without the book.',
    spec: 'core §4.3, §4.3.1',
    examples: ['tbl: d100=42 -> "A broken sword"', 'tbl: Forest Encounter d6=5 -> Traveler on the road'],
    keywords: ['table', 'roll on'],
  },
  {
    id: 'tbl-define', title: 'Inline table', group: 'Tables & generators', syntax: 'tbl: Name (d6)',
    summary: 'Define a table in place: the header names it and gives its die, then one indented line per result. Ranges are allowed.',
    spec: 'core §4.3.1',
    examples: ['tbl: Forest Encounter (d6)', '  1-2: Nothing — eerie silence', '  3: Animal tracks, fresh'],
    keywords: ['define', 'custom table'],
  },
  {
    id: 'tbl-options', title: 'Filtered options', group: 'Tables & generators', syntax: 'tbl: Name [A, B, C]',
    summary: 'A curated list rather than a numbered table. Records what was available, not only what was picked.',
    spec: 'core §4.3.2',
    examples: ['tbl: Mood [Tense, Melancholic, Hopeful, Uncanny]', 'tbl: Mood d4=2 -> Melancholic'],
    keywords: ['options', 'list', 'filtered'],
  },
  {
    id: 'gen', title: 'Generator', group: 'Tables & generators', syntax: 'gen: Name',
    summary: 'A compound result. Put it on one line, or list one indented axis per line to show your working.',
    spec: 'core §4.3, §4.3.3',
    examples: ['gen: NPC -> Merchant / Secretive / Escape', 'gen: NPC (custom)', '  Role: d6=3 -> Merchant'],
    keywords: ['generator', 'npc', 'axes'],
  },
  {
    id: 'note', title: 'Meta note', group: 'Narrative', syntax: '(note: ...)',
    summary: 'An aside to yourself, outside the fiction: a house rule, a reminder, a reflection.',
    spec: 'core §4.5',
    examples: ['(note: testing an alternate stealth rule)', '(Init: Captain 18, Alex 15)'],
    keywords: ['comment', 'aside', 'house rule'],
  },
  {
    id: 'dialogue', title: 'Dialogue', group: 'Narrative', syntax: 'N (Name): "..."',
    summary: 'Spoken lines worth keeping. `PC:` for you, `N (Name):` for anyone else.',
    spec: 'core §4.4',
    examples: ['N (Guard): "Who\'s there?"', 'PC (Alex): "He\'ll be back."'],
    keywords: ['speech', 'talk', 'said'],
  },
  {
    id: 'narrative-block', title: 'In-fiction block', group: 'Narrative', syntax: '\\--- ... ---\\',
    summary: 'A longer passage of in-world text — a letter, a diary page. The delimiters are asymmetric so they never read as a Markdown rule.',
    spec: 'core §4.4',
    examples: ['\\--- The diary reads:', 'Day 47: The tides no longer obey the moon.', '---\\'],
    keywords: ['document', 'excerpt', 'prose'],
  },

  // --- tags ---
  {
    id: 'tag-pc', title: 'Character', group: 'Tags', syntax: '[PC:Name|stats]',
    summary: 'Your character. Whatever stats you write become the sheet — there is nothing to configure first.',
    spec: 'core §4.1.5',
    examples: ['[PC:Alex|HP 8|Stress 0]', '[PC:Alex|HP-2]', '[PC:Kael|Supply d8->d6]'],
    keywords: ['character', 'sheet', 'stats', 'hp'],
  },
  {
    id: 'tag-n', title: 'NPC', group: 'Tags', syntax: '[N:Name|tags]',
    summary: 'Someone who persists. Later tags merge with earlier ones, so you only write what changed.',
    spec: 'core §4.1.1',
    examples: ['[N:Jonah|friendly|injured]', '[N:Jonah|+captured|-wounded]'],
    keywords: ['npc', 'person', 'character'],
  },
  {
    id: 'tag-l', title: 'Location', group: 'Tags', syntax: '[L:Name|tags]',
    summary: 'A place you may return to.',
    spec: 'core §4.1.2',
    examples: ['[L:Lighthouse|ruined|stormy]'],
    keywords: ['place', 'location'],
  },
  {
    id: 'tag-thread', title: 'Thread', group: 'Tags', syntax: '[Thread:Name|state]',
    summary: 'An open story question. Open, Closed and Abandoned are conventional; any state works.',
    spec: 'core §4.1.4',
    examples: ['[Thread:Find Jonah\'s sister|Open]', '[Thread:Find Jonah\'s sister|Open -> Closed]'],
    keywords: ['plot', 'quest', 'thread'],
  },
  {
    id: 'tag-clock', title: 'Clock, track, timer', group: 'Tags', syntax: '[Clock:Name X/Y]',
    summary: 'Clocks fill toward a threat, tracks fill toward a goal, timers count down. Same shape, opposite meanings.',
    spec: 'core §4.2',
    examples: ['[Clock:Suspicion 3/6]', '[Track:Escape 3/8]', '[Timer:Dawn 3]'],
    keywords: ['clock', 'track', 'timer', 'progress', 'countdown'],
  },
  {
    id: 'tag-ref', title: 'Reference tag', group: 'Tags', syntax: '[#Type:Name]',
    summary: 'Point at something already established without restating it. Asserts nothing new.',
    spec: 'core §4.1.6',
    examples: ['[#N:Jonah]', '[#R:3]'],
    keywords: ['reference', 'hash', 'again'],
  },
  {
    id: 'tag-delta', title: 'Changes to a tag', group: 'Tags', syntax: '[Type:Name|+flag] · [Type:Name|a -> b]',
    summary: '`+`/`-` add and remove; `a -> b` swaps one state for another; `HP-2` moves a number. Flags accumulate, so use a transition when only one state should hold.',
    spec: 'core §4.1.1, §4.1.5',
    examples: ['[N:Guard|+alert]', '[N:Guard|alert -> unconscious]', '[Wealth:Gold+15]'],
    keywords: ['delta', 'change', 'update', 'plus', 'minus'],
  },
  {
    id: 'tag-category', title: 'Tag categories', group: 'Tags', syntax: '[PC:Name|trait: a, b]',
    summary: 'Group values under a label when a game distinguishes kinds of tag.',
    spec: 'core §4.1.7',
    examples: ['[PC:Jonah|trait: friendly, curious|status: wounded]'],
    keywords: ['category', 'trait', 'group'],
  },
  {
    id: 'roll-context', title: 'Roll context', group: 'Tags', syntax: 'd: roll [tags] = N -> outcome',
    summary: 'Which tags were active for one roll. Temporary — it records what fed the roll without changing the character.',
    spec: 'core §4.1.9',
    examples: ['d: Investigate 2d6 [Be kind to others, Naive] = 8 -> Mixed'],
    keywords: ['context', 'modifiers', 'tags'],
  },

  // --- structure ---
  {
    id: 'scene', title: 'Scene', group: 'Structure', syntax: 'S# *context*',
    summary: 'The unit of play. `S5a` is a flashback, `S5.1` a montage step, `T2-S1` a scene in a parallel thread.',
    spec: 'core §5.3',
    examples: ['S1 *Dark alley, midnight*', 'S8a *Flashback: home, 15 years ago*'],
    keywords: ['scene', 'flashback', 'montage', 'thread'],
  },
  {
    id: 'session', title: 'Session', group: 'Structure', syntax: '## Session N',
    summary: 'A play session, optionally followed by an italic line of date and duration.',
    spec: 'core §5.2',
    examples: ['## Session 1', '*Date: 2026-07-26 | Duration: 1h30*'],
    keywords: ['session', 'date'],
  },
  {
    id: 'campaign-header', title: 'Campaign header', group: 'Structure', syntax: 'YAML front matter',
    summary: 'Title, ruleset, genre and so on at the top of the file. Optional, and useful mostly when sharing.',
    spec: 'core §5.1',
    examples: ['---', 'title: Clearview Mystery', 'ruleset: Loner + Mythic Oracle', '---'],
    keywords: ['campaign', 'front matter', 'title'],
  },
  {
    id: 'blocks', title: 'Structural blocks', group: 'Structure', syntax: '[COMBAT] … [/COMBAT]',
    summary: 'Mark a stretch of denser notation. The analog form is `--- COMBAT ---` / `--- END COMBAT ---`; the two are equivalent.',
    spec: 'combat §1, dungeon §3, resources §5, wargaming §1',
    examples: ['[COMBAT]', '[/COMBAT]', '--- RESOURCES ---'],
    keywords: ['block', 'combat', 'battle', 'resources'],
  },

  // --- add-ons ---
  {
    id: 'addon-combat', title: 'Combat', group: 'Add-ons', syntax: '[F:Name|HP 6|Close] · Rd#',
    summary: 'Combatants and initiative rounds. `Rd#` restarts at 1 each fight. Group identical foes with `Namex3`.',
    spec: 'combat §2, §3',
    examples: ['[F:Thug A|HP 6|Close|armed]', 'Rd1', '[F:Skeletonx3|HP 3 each]'],
    keywords: ['combat', 'foe', 'round', 'fight', 'hp'],
  },
  {
    id: 'addon-resources', title: 'Resources', group: 'Add-ons', syntax: '[Inv:Item|qty] · [Wealth:Cur N]',
    summary: 'Concrete things you carry and money you hold. Abstract supply lives in `[PC:]` as a usage die or a track.',
    spec: 'resources §1, §2, §3',
    examples: ['[Inv:Torch|3]', '[Inv:Torch-1]', '[Wealth:Gold+15]', '[PC:Kael|Supply d8->d6]'],
    keywords: ['inventory', 'item', 'wealth', 'gold', 'supply', 'usage die'],
  },
  {
    id: 'addon-dungeon', title: 'Dungeon', group: 'Add-ons', syntax: '[R:ID|status|desc|exits DIR:ID]',
    summary: 'Room state, not room layout — keep the map on paper. Statuses combine, as in `cleared, looted`.',
    spec: 'dungeon §1, §2',
    examples: ['[R:4|active|storage room|exits S:R2, E:R5]', '[R:4|+looted]'],
    keywords: ['room', 'dungeon', 'exits', 'cleared'],
  },
  {
    id: 'addon-wargaming', title: 'Battle', group: 'Add-ons', syntax: '[Unit:Name|xN|Morale N|status] · Tn#',
    summary: 'Units rather than individuals. `Tn#` is a unit-scale turn and is deliberately distinct from combat’s `Rd#`; both may appear in one log.',
    spec: 'wargaming §1, §2, §5',
    examples: ['[Unit:Rifles|x12|Morale 8|Fresh]', 'Tn2 Shoot:', '[Unit:Atlas|Armor CT30/RT25|Heat 5]'],
    keywords: ['unit', 'battle', 'turn', 'morale', 'heat', 'armor', 'wargame'],
  },
];

/** Lint rule → the entry that explains the notation it is about. */
export const LINT_REFERENCE = {
  L1: 'consequence', L2: 'action', L3: 'tag-clock', L4: 'addon-combat',
  L5: 'addon-combat', L6: 'addon-wargaming', L7: 'addon-resources',
  L8: 'tag-delta', L9: 'addon-resources', L10: 'narrative-block', L11: 'tag-clock',
};

/** @param {string} id */
export function entryFor(id) {
  return ENTRIES.find((e) => e.id === id) ?? null;
}

/**
 * Search titles, syntax, summary, keywords and examples.
 * @param {string} query
 * @returns {Entry[]}
 */
export function search(query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return ENTRIES;
  const terms = q.split(/\s+/);

  return ENTRIES
    .map((entry) => {
      const haystack = [
        entry.title, entry.syntax, entry.summary, entry.group,
        ...(entry.keywords ?? []), ...entry.examples,
      ].join(' ').toLowerCase();
      const score = terms.reduce((total, term) => {
        if (!haystack.includes(term)) return total - 100;
        return total
          + (entry.title.toLowerCase().includes(term) ? 3 : 0)
          + (entry.syntax.toLowerCase().includes(term) ? 2 : 0)
          + 1;
      }, 0);
      return { entry, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.entry);
}

/** Entries grouped in declaration order, for browsing. */
export function grouped(entries = ENTRIES) {
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.group)) groups.set(entry.group, []);
    groups.get(entry.group).push(entry);
  }
  return [...groups];
}
