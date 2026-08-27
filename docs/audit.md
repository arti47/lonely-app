# Spec-conformance audit

Run against the finished app per `CLAUDE.md` §11. Findings are numbered; each is
closed with a regression check so it cannot return. The **verified clean** list
at the end records what was checked and found correct, so a future audit does not
re-litigate it.

Audited: 2026-07-26 · engine at 220 unit tests + 86 browser checks.

---

## Findings

### A1 — Numbered combatants collapsed into one element · **fixed**

- **Rule:** Combat §3.2 splits a group into individuals — `[F:Pirate 1|Close|wounded]`,
  `[F:Pirate 2|Medium|crossbow]`.
- **Target:** `src/lonelog/tags.js` · `parseHead`.
- **Symptom:** the trailing number was read as the element's *value*, so both
  tags folded into a single element named `Pirate` carrying the union of both
  combatants' flags — `Close, wounded, Medium, crossbow`. The same defect merged
  `[N:Guard 1]` with `[N:Guard 2]`.
- **Fix:** a bare trailing number is only a head value for the types that mean
  one — `[Timer:Dawn 3]`, `[Wealth:Gold 45]`. For every other type it stays part
  of the name.
- **Why it mattered:** the most severe class of fold defect — silent identity
  loss. Nothing looked wrong on screen; two combatants simply became one.
- **Closed by:** `tests/fold.test.js` — *A1 numbered combatants stay separate
  elements*, *A1 a trailing number stays in the name for non-numeric types*,
  *A1 types that do mean a trailing number still read it*.

### A2 — Combined room statuses were untestable · **fixed**

- **Rule:** Dungeon §1.1 combines statuses: `[R:1|cleared, looted]`.
- **Target:** `src/lonelog/fold.js` · `applyField`.
- **Symptom:** the whole field became one flag, `"cleared, looted"`, so
  `flags.has('cleared')` was false and the dungeon panel could not see a state
  the log plainly recorded.
- **Fix:** the first field of an `[R:]` tag — the status slot in the spec's own
  format — splits on commas into separate flags. Later fields do not, so a
  description keeps its punctuation.
- **Why it mattered:** state present in the log was invisible to every consumer
  of the fold.
- **Closed by:** *A2 a comma-separated room status becomes separate flags*,
  *A2 a room description keeps its commas*.

### A3 — Group count and value diverged · **fixed**

- **Rule:** Combat §3.2 — `[F:Skeleton 2->1]` is the group losing one.
- **Target:** `src/lonelog/fold.js` · `applyHead`.
- **Symptom:** the transition set a `value` of `1` while `count` stayed at `3`.
  Two contradictory sizes for one group, with the panel reading the stale one.
- **Fix:** a numeric head transition on a countable type (`F`, `Unit`) updates
  the count.
- **Why it mattered:** the two spellings of group size appear in the specs'
  own examples, so a real log mixes them.
- **Closed by:** *A3 a numeric transition on a group is a casualty, not a
  separate value*, *A3 a non-numeric transition still sets a value*.

### A4 — Resolve fields had no accessible name · **fixed**

- **Rule:** `CLAUDE.md` §2 — keyboard and screen-reader usable.
- **Target:** `src/resolve.js` · `field`.
- **Symptom:** the label was rendered without a `for`, and the input was not
  nested inside it, so Modifier, Target, Threshold and the challenge dice were
  announced as unlabelled edit fields.
- **Fix:** `field()` now always associates the label with its control,
  generating an id when the caller supplies none.
- **Closed by:** browser check *every control on every screen has an accessible
  name*, which sweeps all six screens.

### A5 — An unknown route silently rendered Campaigns · **fixed**

- **Rule:** `CLAUDE.md` §3.1 — the router owns screen selection and tab gating.
- **Target:** `src/router.js` · `render`.
- **Symptom:** `routes.get(name) ?? routes.get('campaigns')` meant any
  unregistered route rendered the Campaigns screen while the URL and the nav
  still said otherwise. Reported in the wild as *“why do Campaigns and Notation
  show the same content?”* — a browser holding a cached build from before the
  Notation tab existed had no `reference` route, so the new tab fell through to
  Campaigns and looked like a duplicate.
- **Fix:** an unknown route renders a named “Screen not found” page with a
  Reload button, and clears `aria-current` rather than leaving a tab marked
  active. Two supporting changes: the page now warns when a service worker takes
  control after load (the running modules are stale at that point), and the
  worker no longer serves *itself* from cache, so a bad version cannot pin
  itself.
- **Why it mattered:** the failure was invisible. A stale cache plus a silent
  fallback produced two tabs with identical content and no error anywhere.
- **Closed by:** browser checks *each tab routes to its own screen* — which
  clicks the tabs rather than setting the hash — and *an unknown route says so
  instead of falling back*.

### A6 — Screens without a campaign were unnamed dead ends · **fixed**

- **Rule:** `CLAUDE.md` §2 — every screen is navigable and screen-reader usable.
- **Target:** `src/screens.js` · `openCampaign`.
- **Symptom:** opening Log, State or Resolve with no campaign selected rendered
  a message with no `h1` at all, so three different screens were mutually
  indistinguishable and had no heading to land on. The original accessibility
  sweep missed it because it only ever visited those routes *with* a campaign.
- **Fix:** the empty state names its own screen and points at the campaign list.
  The sweep now visits every screen both with and without a campaign.
- **Closed by:** the accessibility sweep's extended route list, and *each tab
  routes to its own screen*.

---

## Second pass — fidelity audit against the official documents

Run 2026-07-27 against all five vendored specs read end to end, plus the three
further official documents the repository carries but does not implement. The
first pass audited the fold; this one audited what the app *says* and which of
the specs' own forms it can actually read.

Findings are numbered B1–B8 and each is closed by a check in
`tests/fidelity.test.js` that quotes the spec's own example verbatim.

### B1 — Digital scene headers were not scenes · **fixed**

- **Rule:** Core §5.3 gives two forms for a scene marker: digital
  `### S1 *School library after hours*` and analog `S1 *School library after
  hours*`. The digital form is what §2.4, §6.2 and §6.4 use throughout, and what
  the Wargaming add-on's Part I example uses.
- **Target:** `src/lonelog/lexer.js` · `lex` heading branch.
- **Symptom:** the heading rule ran first and claimed the line, so every digital
  scene lexed as a plain `heading`. A log written the way the specs write them
  folded with **zero scenes**: no scene in the status strip, no per-scene
  checkpoints, `nextSceneNumber` stuck at 1 so the composer re-emitted `S1`
  forever, and a block opened in a scene header (combat §1.1) never opened.
- **Fix:** a heading whose title begins with a scene, round or turn marker is
  read as that marker, keeping its `level` and its raw text. Everything else
  stays a heading, so `## Session 1` is still a session.
- **Why it mattered:** the app could not read the primary form of the primary
  structural element in the official documents. Importing a hand-written log
  silently discarded its structure.
- **Closed by:** *B1 a markdown scene heading is a scene*, *B1 every digital
  scene form folds*, *B1 a block opened in a digital scene header opens and
  closes*, *B1 reading a marker out of a heading stays lossless*.

### B2 — Roll context without a category read as an annotation · **fixed**

- **Rule:** Core §4.1.9 — `d: Investigate 2d6 [Be kind to others, Naive] = 8 ->
  Mixed`. Two of its three examples carry no `category:` prefix.
- **Target:** `src/lonelog/tags.js` · `classifyBracket`.
- **Symptom:** a bracket group with no colon was always an annotation, so the
  spec's own headline roll-context examples were classified as stage direction.
  Only the colon-bearing third example worked — and only that one was tested.
- **Fix:** inside a `d:` line, before the resolution arrow, a group that is not a
  known tag is roll context whether or not it carries a category. Outside a dice
  line nothing changed, so combat §3.3's `[Far->Close]` is still an annotation.
- **Closed by:** *B2 every roll-context example in core §4.1.9 reads as roll
  context*, *B2 a bracket outside a dice line is still an annotation*.

### B3 — Status vocabularies were matched case-sensitively · **fixed**

- **Rule:** Wargaming §2 tabulates `Fresh`/`Steady`/`Wavering`/`Broken`, then
  writes `[Unit:Rifles|x8|wavering]` and `[Unit:Orc Mob|half|wavering]` in its
  own examples. Combat §3.3 does the same for position bands.
- **Target:** `src/addons/wargaming.js` · `statusLine`, `sizeLine`, `unitRow` ·
  `src/addons/combat.js` · `moveLine`, `foeRow` · new `src/state.js` ·
  `currentFlag`.
- **Symptom:** `UNIT_STATUS.find((s) => unit.flags.has(s))` missed a lowercase
  status, so the panel emitted `[Unit:Rifles|+Steady]` instead of
  `[Unit:Rifles|wavering -> Steady]` — leaving the unit both wavering *and*
  steady. The same lookup also returned the *first* vocabulary entry the element
  happened to carry rather than the one set last, so a unit that had gone
  `full` → `half` stepped down from `full`.
- **Fix:** one shared `currentFlag(element, vocabulary)` that matches without
  regard to case and answers with the most recently set flag, spelled as the log
  spells it so the transition clears the right key.
- **Why it mattered:** same class as the Phase 3 thread defect — flags
  accumulate, so a missed transition leaves two contradictory states in the fold.
- **Closed by:** *B3 the current state is matched case-insensitively and by
  recency*, *B3 a lowercase unit status transitions rather than accumulating*,
  *B3 a lowercase position transitions too*, *B3 abstract size steps from the
  size the log last recorded*.

### B4 — The resource snapshot dropped currencies · **fixed**

- **Rule:** Resources §5 — `[Wealth:Gold 52 | Silver 8]` inside `[RESOURCES]`.
- **Target:** `src/addons/resources.js` · `snapshotLines`.
- **Symptom:** the snapshot restated only the head value, writing
  `[Wealth:Gold 52]` and losing every currency after the first.
- **Fix:** the snapshot restates the head *and* every field.
- **Why it mattered:** a snapshot exists to be the state you resume from; one
  that quietly omits half of it is worse than none.
- **Closed by:** *B4 a snapshot restates every currency in a Wealth tag*, which
  also folds the snapshot back and compares it to what it was taken from.

### B5 — A documented form the specs do not define · **fixed**

- **Rule:** Core §4.4 and Appendix A.7 define exactly two dialogue forms:
  `PC:` and `N (Name):`.
- **Target:** `src/reference.js` · the `dialogue` entry.
- **Symptom:** the entry's own example used `PC (Alex): "He'll be back."` — a
  third form, cited to §4.4, that appears nowhere in any of the five specs. The
  lexer accepts it (tolerant in), but the reference is where the app *teaches*
  the notation, and it was teaching something the notation does not say.
- **Fix:** the example is now the spec's own `PC: "Stay calm..."`, and the entry
  cites A.7 as well.
- **Closed by:** *B5 every dialogue example uses a form the spec defines*.

### B6 — Digital and analog logs folded differently · **fixed**

- **Rule:** Core §2.4 shows one log in both formats; §5.2.1 and §5.2.2 give the
  two session-header forms. Ledger T27 claims equivalence.
- **Target:** `src/lonelog/fold.js` · `applyEntry`, new `sessionTitle`.
- **Symptom:** with B1 fixed, the two forms agreed on everything except the
  session's title: digital folded `Session 1`, analog folded
  `=== Session 1 ===`. Equivalence was therefore still false.
- **Fix:** the analog delimiters are stripped, so both forms fold the same title.
- **Note on scope:** `renderForm` converts *structural blocks* between the two
  forms. It does not rewrite session or scene headers, and does not convert a
  YAML campaign header into the analog block of §5.1. T27's ledger line now says
  so rather than implying a general converter.
- **Closed by:** *B6 digital and analog forms of one log are equivalent*.

### B7 — The corpus could not see the defect that lived in it · **fixed**

- **Rule:** §9.5 — "round-trip of every example in all five vendored specs".
- **Target:** `tests/extract-corpus.mjs` · `NOTATION`, `harvest`.
- **Symptom:** the harvester read fenced blocks and blockquoted runs only. The
  vendored specs are PDF conversions in which a great many examples — every
  digital scene heading, the §4.4 dialogue, the §5 analog headers — are plain
  text. Those forms were structurally invisible to the corpus, which is why B1
  survived a full Phase 1 pass and a first audit. The notation filter also
  rejected any line starting with `#`, so even a harvested heading was dropped.
- **Fix:** a third harvest mode reads unfenced runs of notation-initial lines,
  and the filter accepts a heading prefix. The corpus went from 377 snippets to
  456, now including 13 with digital scene headings and 6 with session headings.
- **Closed by:** the corpus itself, plus *B1 …* above.

### B8 — The add-on barrel depended on import order · **fixed**

- **Rule:** CLAUDE.md §3.1 — "Runtime cycles are safe under ESM live bindings."
- **Target:** `src/addons/index.js` · `OWNED_TYPES` → `ownedTypes()`.
- **Symptom:** the barrel computed a `Set` from every add-on's `types` at module
  evaluation time. The add-ons import back through `state.js` to the barrel, so
  importing an add-on module *first* threw `Cannot access 'types' before
  initialization`. The app never hit it because `main.js` happens to reach the
  barrel first; a test or a future entry point that did not would.
- **Fix:** compute it on call.
- **Closed by:** *B8 importing an add-on before the barrel does not throw*,
  which runs a child process with the failing import order.

---

## Third pass — structure, positional slots and the analog header

Run 2026-07-27 as an exhaustive audit of the whole app: every notation-initial
line in the five specs pushed through the lexer, every add-on snapshot folded
back against the state it was taken from, the whole corpus folded for block
balance, and every control on every screen and in every dialog clicked in a
headless browser.

Findings are C1–C15 and each is closed by a check in `tests/fidelity.test.js`,
`tests/composer.test.js` or `tests/smoke.mjs`.

### C1 — an analog block never closed under its own name · **fixed**

- **Rule:** Dungeon §3 closes `--- DUNGEON STATUS ---` with `--- END STATUS ---`.
- **Target:** `src/lonelog/lexer.js` · `lex` analog-block branch.
- **Symptom:** the closer had to repeat the block's full name, so the spec's own
  analog example left the block open for the rest of the log: the stack never
  popped, the composer went on offering "End Dungeon Status", and a session-end
  bundle would close a block that had closed pages earlier.
- **Fix:** the lexer keeps the analog blocks it has opened and matches an
  abbreviated closer against the innermost one whose name ends with it. A closer
  naming nothing open is still prose.
- **Closed by:** *C1 `--- END STATUS ---` closes `--- DUNGEON STATUS ---`*,
  *C1 a stray `--- END X ---` naming nothing open stays prose*.

### C2 — a room's description was filed as a status · **fixed**

- **Rule:** Dungeon §1 `[R:ID|status|desc|exits]`; §1.3 gives the description
  its own slot.
- **Target:** `src/lonelog/fold.js` · `applyField` · `src/addons/dungeon.js`.
- **Symptom:** `[R:1|cleared, looted|entry cave|exits N:R2]` folded "entry cave"
  as a *status*, so the panel read `cleared, looted, entry cave` and the status
  block re-emitted the description in the status slot.
- **Fix:** documented positional slots (below). The room vocabulary moved into
  the engine, because telling a status from a description is a notation rule
  (§9.2), and the snapshot writes the spec's own shape back out.
- **Closed by:** *C2 the description slot folds as a description*, *C2 two
  statuses in separate fields are still statuses*, *C2 a dungeon snapshot
  re-reads as the rooms it was taken from*.

### C3 — a scenario objective became a stat key · **fixed**

- **Rule:** Wargaming §3 `[Scenario:Name|objective|turn limit|special rules]`,
  §2 `[Force:Name|commander|strength|objective]`.
- **Target:** `src/lonelog/fold.js` · `positionalSlot`.
- **Symptom:** every scenario example in the spec mangled — `Exit 2+ units
  south` folded as a stat named `Exit` holding `2+ units south`, because the
  space-separated stat-key rule (written for `Armor CT30/RT25`) matched any
  phrase whose second word starts with a digit.
- **Fix:** where a spec gives a tag a positional format, the named slots are
  free text and keep their raw value. Only a plain field fills a slot; a delta
  or a transition is an *update*, and updates are not positional.
- **Closed by:** *C3 every scenario example in wargaming §3 keeps its
  objective*, *C3 a force keeps commander, strength and objective*, *C3 an
  update is not positional*.

### C4 — a campaign snapshot dropped the whole force · **fixed**

- **Rule:** Wargaming §4 — `[CAMPAIGN]` records entering and closing state.
- **Target:** `src/addons/wargaming.js` · `snapshotLines`.
- **Symptom:** the snapshot restated `fields` only. A `[Force:]` written the way
  the spec writes it held commander, strength and objective as flags, so the
  block came out `[Force:Ironclad Company]` — the force's whole description
  gone. Same class as B4, which had been fixed for `[Wealth:]` alone.
- **Fix:** restate the slots in order, then any other field, then flags.
- **Closed by:** *C4 a [CAMPAIGN] snapshot folds back to the forces it
  snapshotted*.

### C5 — a resource snapshot renamed every item · **fixed**

- **Rule:** Resources §1 `[Inv:Item|qty|props]`; §5 the `[RESOURCES]` block.
- **Target:** `src/addons/resources.js` · `snapshotLines`.
- **Symptom:** the quantity was written on the tag head — `[Inv:Torch 3|lit]` —
  and a trailing number stays part of the name for `[Inv:]` (audit A1). Every
  snapshot therefore created a *second* item called "Torch 3" with no quantity,
  and the real one silently stopped being updated.
- **Fix:** the quantity goes back in the field slot the spec puts it in, and a
  grouped item keeps its multiplier.
- **Why it mattered:** the most severe class of defect again — silent identity
  loss, triggered by a control whose whole purpose is to preserve state.
- **Closed by:** *C5 a [RESOURCES] snapshot keeps item identity and quantity*,
  *C5 a grouped item keeps its multiplier through a snapshot*.

### C6 — the analog header folded to a title and nothing else · **fixed**

- **Rule:** Core §5.1 and §5.2.2 give the analog campaign and session headers a
  `[Field]` form, with the value on the same line or the one beneath.
- **Target:** `src/lonelog/lexer.js` · new `metaField` kind ·
  `src/lonelog/fold.js` · `setMeta`.
- **Symptom:** `[Date]`, `[Duration]`, `[Recap]`, `[Goals]`, `[Ruleset]`,
  `[Genre]` and the rest fell through to prose. A digital log's YAML front
  matter folded into `state.meta` and its `*Date: … | Duration: …*` line onto
  the session; the analog log carrying exactly the same information folded
  neither. T24, T25 and T27 were all only half true.
- **Fix:** a closed vocabulary — the specs list every key — so an ordinary
  bracketed aside is never mistaken for a header field. Campaign keys land on
  the campaign, session keys on the session they sit under.
- **Closed by:** *C6 an analog campaign header folds its fields*, *C6 an analog
  session header folds onto its session*, *C6 digital and analog session
  metadata agree*, *C6 a bracket that is not a header key is left alone*,
  *C6 an analog header is lossless*.

### C7 — a one-line narrative block swallowed the log · **fixed**

- **Rule:** Core §4.4 — `\---` opens an in-fiction block, `---\` closes it.
- **Target:** `src/lonelog/lexer.js`.
- **Symptom:** the opening branch returned before testing for the closer, so
  `\--- The fog rolls in. ---\` opened a block that never closed: every line
  after it, for the rest of the log, lexed as narrative. No symbol worked again.
- **Fix:** a line that closes what it opened is self-closing.
- **Closed by:** *C7 a one-line narrative block does not swallow the log*,
  *C7 a multi-line narrative block still spans its lines*.

### C8 — the spec's own narrative opener was not recognised · **fixed**

- **Rule:** Core §4.4's example opens `\--The diary reads:` although the prose
  names `\---`.
- **Target:** `src/lonelog/lexer.js` · `RE_NARRATIVE_OPEN`.
- **Fix:** two dashes are accepted, canonical output unchanged (§5.3).
- **Closed by:** *C8 the two-dash opener the spec writes is accepted*.

### C9 — a PC named in the campaign header was not a PC · **fixed**

- **Rule:** Core §5.1's front matter carries a real tag: `pcs: Alex
  [PC:Alex|HP 8|Stress 0|Gear:Flashlight,Notebook]`.
- **Target:** `src/lonelog/lexer.js` front-matter branch, `src/lonelog/fold.js`.
- **Symptom:** front-matter lines carried no tags at all, so the character the
  header introduces existed nowhere until they were tagged again in play.
- **Closed by:** *C9 front matter establishes the tags it carries*.

### C10 — importing a campaign header dropped most of it · **fixed**

- **Rule:** CLAUDE.md §5.2 — never lose a byte. Core §5.1 lists more header
  fields than this app has opinions about.
- **Target:** `src/store.js` · `fromMarkdown`, `toMarkdown`, `normalizeCampaign`.
- **Symptom:** import kept five keys and discarded the rest — `pcs`, `tools`,
  `themes`, `notes` and anything an author invented were gone on the next
  export. The app's own round trip lost the user's data.
- **Fix:** unknown keys are kept verbatim in `meta.extra` and written back out
  after the known ones, so import → export → import is stable.
- **Closed by:** *C10 every campaign-header field survives import and export*,
  *C10 a log with no header still exports without inventing one*.

### C11 — the campaign header could not be seen or set · **fixed**

- **Rule:** Core §5.1; CLAUDE.md §6 lists `ruleset`, `genre`, `player`, `tone`.
- **Target:** `src/screens.js` · `logScreen` · `editHeader`.
- **Symptom:** the fields existed in the data model and shipped in the export,
  but no screen showed them and nothing could set them. A campaign could not
  even be renamed after it was created.
- **Fix:** Log details shows the header and offers **Edit header…**.
- **Closed by:** browser checks *the log details dialog offers the campaign
  header*, *every header field is present and labelled*, *saving the header
  stores it and writes it into the export*.

### C12 — two core constructs had no control at all · **fixed**

- **Rule:** Core §4.4 — dialogue (`PC:`, `N (Name):`) and the long in-fiction
  block.
- **Target:** `src/composer.js` · `dialogueLine`, `excerptLines`, `Said…`,
  `Excerpt…`.
- **Symptom:** every other line kind had a button; these two could only be
  written by someone who already knew the punctuation, which is the opposite of
  what a symbol-first composer is for. Both were ticked in the ledger (T20,
  T21) — as engine support, which is all they had.
- **Fix:** **Said…** builds only the two forms the spec defines, with the
  speaker autocompleting from the fold; **Excerpt…** commits the passage as one
  balanced block, so undo takes it in a single step.
- **Closed by:** *dialogue uses only the two forms the spec defines*, *an
  excerpt is one bundle that opens and closes itself*, and browser checks
  *the dialogue dialog previews and inserts a spec form*, *an excerpt lands as
  one balanced block, undoable in one step*.

### C13 — the JSON backup was not a backup · **fixed**

- **Rule:** CLAUDE.md §1 mandatory scope — "markdown export/import **and** JSON
  backup in Settings"; §6 lists `settings` as a store.
- **Target:** `src/store.js` · `exportBackup`, `importBackup`.
- **Symptom:** the backup omitted settings entirely, so restoring it lost theme,
  lint level, notation view and the remembered campaign. It also carried each
  campaign's file handle, which cannot cross JSON: the `{}` left in its place
  read as "still bound", and every later save failed against it. The whole path
  had no test of any kind, unit or browser.
- **Fix:** settings are exported and restored; handles are stripped.
- **Closed by:** browser checks *a JSON backup carries campaigns, templates,
  tables and settings*, *a backup carries no dead file handle*, *importing the
  backup restores the campaigns and the settings*.

### C14/C15 — the compact roster forms created phantom characters · **fixed**

- **Rule:** Combat §5.2 Quick Reference — `Rd3 Roster: [PC:HP 3] [F:Boss|HP 4]`;
  §7 "Ultra-compact" — `[PC:HP 12]`, `[N: Jordan HP-4]`.
- **Target:** `src/lonelog/fold.js` · `compactHead`.
- **Symptom:** read literally, `[PC:HP 3]` is a character *named* "HP 3" and
  `[N: Jordan HP-4]` is a second NPC called "Jordan HP-4". Every roster line in
  a long fight added another phantom to the Sheet, and the real character's HP
  never moved. Found by folding the corpus and looking for elements named after
  their own data.
- **Fix:** a stat expression in the name slot applies to the element it belongs
  to. Only the PC may go unnamed — it is the one character a solo log never has
  to introduce, and never one of a numbered group, so `[F:Pirate 1]` and
  `[Inv:Slot 1]` are untouched (A1).
- **Closed by:** *C14 a roster's unnamed PC is the PC*, *C14 the ultra-compact
  log opens with a PC*, *C15 a delta written into the name slot applies to the
  named element*, *C14/C15 numbered individuals are untouched*.

---

## Fourth pass — the play loop

Run 2026-07-30, asking one question: does a solo session flow? Measured by
driving real beats through the UI — `@` → `?` → `d:` → `=>`, then three rolls in
a row — and counting what a thumb has to do between them.

Findings are D1–D4, closed by checks in `tests/smoke.mjs` and
`tests/compare.test.js`.

### D1 — the composer silently re-armed the wrong symbol · **fixed**

- **Rule:** CLAUDE.md §1, D9 — the composer is symbol-first, so the symbol is
  the control.
- **Target:** `src/composer.js` · `mountComposer`, `setKind`.
- **Symptom:** every commit re-mounts the composer, and `kind` was a local
  starting at `'action'`. So after each line the bar reset to `@ Did` — costing
  a tap on every run of consequences, and worse, *silently*: a player typing
  their next line found it filed as an action when they meant a consequence.
  Measured before the fix: five beats, five symbol taps, and the wrong symbol
  armed after four of them.
- **Fix:** the chosen kind persists across re-mounts, exactly as the bar's
  expanded state already did. A bar whose kind is an advanced one opens
  expanded, so nothing is ever pressed-but-hidden.
- **Measured after:** two consecutive consequences cost **zero** taps beyond
  typing.
- **Closed by:** *the composer keeps the symbol it was on after a line lands*.

### D2 — the roll drawer forgot the roll you had just made · **fixed**

- **Rule:** §8.2 F6 — rolling happens over the log so play does not stop.
- **Target:** `src/resolve.js` · `lastRoll`, `remember`.
- **Symptom:** a fight is the same roll every round, and the drawer came back
  blank each time: label, target and mode all re-typed. Three fields per roll,
  measured, every round.
- **Fix:** the *shape* of the last committed roll is remembered for the life of
  the page — mode, label, target, threshold, comparison, dice count — and never
  the dice, which the player rolls (D2). A fresh page starts empty.
- **Measured after:** roll one costs three fields, rolls two and three cost
  **one**.
- **Closed by:** *reopening the drawer carries the roll back but never the
  dice*.

### D3 — the drawer opened on a button, and its commit was below the fold · **fixed**

- **Rule:** D8 — phone-first, 360px.
- **Target:** `src/ui.js` · `modal` focus · `styles.css` `.modal`,
  `.modal-body`, `.resolve-commit`.
- **Symptom:** two compounding problems. The dialog focused its primary action,
  so tapping 🎲 left the caret on a button and typing a number took an extra tap.
  And `.modal` was itself the scroller, so on a 667px phone **Add to log sat
  below the viewport** — as did the dialog's own actions, in every tall dialog.
  The most-used control in the app could not be seen when it opened.
- **Fix:** `modal()` honours an `[autofocus]` in the body, and the first die
  input claims it. The dialog is a column whose body scrolls, so its title and
  actions stay pinned; the roll panel's preview and commit stay in reach on a
  sticky footer. The Outcome field is only asked for when it is needed, which
  keeps the common roll two fields deep.
- **Measured after:** on 360×667 the die, the preview, the commit and the
  dialog's actions are all on screen the moment the drawer opens.
- **Closed by:** *the roll drawer opens with the die focused*, *the roll drawer
  needs no scrolling to enter a roll and commit it*.

### D4 — a roll with nothing to compare wrote a non-outcome · **fixed**

- **Rule:** Core §3.2.1 — "Always include the outcome (Success/Fail or narrative
  result)."
- **Target:** `src/compare.js` · `evaluate`, `rollLine` · `src/resolve.js` ·
  `update`.
- **Symptom:** with no target, `target` and `keep` modes echoed the total as the
  outcome, committing `d: 17 -> 17` — a roll recorded as having resolved to
  nothing. The Add button was enabled for it.
- **Fix:** those modes report no verdict, and the pane asks the player what it
  meant — `d: 17 -> Partial success` — or to set a target. The player's word also
  *wins* over the computed one, because the specs write `d: 19 >= 13 Hit` as
  readily as `-> Success`. A mode with a verdict of its own keeps it: a Fate
  ladder rung and a success count are results, not echoes.
- **Closed by:** *a target roll with no target offers no outcome to invent*,
  *the player's own word becomes the outcome*, *keep mode with no target says
  nothing about the total either*, *a mode that has a verdict without a target
  keeps it*, and browser check *a roll with no target asks what it meant instead
  of inventing a result*.

### C16 — the analog header was a different construct from the digital one · **fixed**

- **Rule:** Core §5.1, §5.2.2; ledger T27 claims the two forms are equivalent.
- **Target:** `src/lonelog/lexer.js` · `RE_HEADING_ANALOG` ·
  `src/lonelog/fold.js` heading branch · `src/reference.js`.
- **Symptom:** C6 taught the fold to read the analog header's `[Field]` lines,
  but the header line itself — `=== Session 1 ===`, `=== Campaign Log: Name ===`
  — was still only *prose that the fold pattern-matched*. Two branches read one
  construct, the log view classed the line as prose, and the reference taught
  the digital form alone for a construct the app reads in both.
- **Fix:** the analog delimiters make a `heading`, exactly as `##` does, so the
  fold has one branch for both; a row of equals signs is still prose. Both
  reference entries now document the written form beside the digital one.
- **Closed by:** *C16 an analog session header lexes as the heading it mirrors*,
  *C16 the analog campaign header names the campaign*, *C16 a row of equals
  signs is not a header*, *C16 both header forms are lossless*.

### D5 — the app could write notation the guide could not teach · **fixed**

- **Rule:** §8 Phase 8 — "every automated surface links to its reference entry";
  D11 — the guide teaches the app.
- **Target:** `src/composer.js` · `dialogueDialog`, `excerptDialog` ·
  `src/guide.js`.
- **Symptom:** the two §4.4 controls added in the third pass had no reference
  link and no mention in the guide, which had been rewritten in between. The
  campaign-header editor and the roll drawer's two new behaviours were untaught
  too. Nothing was broken; the app simply did things it never explained.
- **Fix:** both dialogs link to their entry and open on the field they are
  asking for; the guide's Play, Campaigns and Roll sections cover every control
  they offer. `tests/guide.test.js` now asserts the *converse* invariant —
  every symbol and every tool button is taught — which is what drifted.
- **Closed by:** *the guide teaches every control the composer offers*, *the
  guide teaches the campaign header*, and browser checks *the dialogue dialog
  opens on the speaker and links to its entry*, *the excerpt dialog puts the
  caret in the passage and links out*.

### Verified clean — flow

- Focus returns to the composer after every commit, including after a roll
  lands from the drawer, so the keyboard never has to be summoned twice.
- The log scrolls to the newest line after every commit.
- Compact single-line shorthand (core §6.1) can be typed straight into the
  composer and lands verbatim: `@ Force the door d: 14 vs 12 -> Success => it
  gives way`.
- The oracle writes both the question and its roll, so `?` + `d:` is one action.
- Scene and Session sit in the status strip, one tap from the composer (D12).
- The symbol bar and the tool row both fit 360px with nothing off-screen.

---

## Fourth pass — reachability, for someone who has read nothing

Run 2026-08-27. The previous passes asked whether the app is correct and whether
it is faithful to the specs. This one asks the only question a new player has:
**can I find it, and do I know what it is when I find it?**

The pass is permanent. `tests/reachability.mjs` drives the real app and reports
every finding in one run, so the loop is `npm run audit` → fix → run again until
it prints nothing; it then runs inside `npm test`, which is what keeps it at
nothing. Its rules:

| Rule | What it refuses to let happen |
|---|---|
| R1 | a capability the app claims with no control that reaches it |
| R2 | a control with no accessible name, or a label that is bare notation |
| R3 | a control that opens a dialog without saying so, or a dialog with no way out |
| R4 | an empty state that does not name a control on its own screen |
| R5 | a control that throws, or leaves no screen behind |
| R6 | notation the app can write but offers no control to write |
| R7 | a cold start that cannot reach a logged line and a recorded roll |
| R8 | a surfaced add-on panel that cannot explain its own notation |

Probing clicks real controls, so the campaign log is saved before each click and
restored after: a destructive control is safe to test exactly once.

### E1 — The status strip spoke in notation · **fixed**

- **Symptom:** the collapsed strip read `Session 1 · S1 · Rd1 · Tn1 · HP 8`.
  `S1`, `Rd1` and `Tn1` are the notation, and the notation is precisely what the
  reader of that line has not learnt yet.
- **Fix:** the strip spells them — `Session 1 · Scene 1 · Round 1 · Turn 1`. The
  chips underneath still show the marker itself, so the trace back to the line
  is unchanged.
- **Closed by:** R2.

### E2 — A tap could open a dialog with no warning · **fixed**

- **Symptom:** `New campaign`, `Details`, `Scene`, `set`, `+ field`, `+ add` and
  the dungeon's `+ status` / `− status` all opened a dialog while reading like
  buttons that act. Seven controls, one convention, followed by none of them.
- **Fix:** every wordy control that opens a dialog ends in `…`. Deletion keeps
  its bare label, because a confirmation is exactly what a delete should imply.
- **Closed by:** R3, which now enforces the convention rather than trusting it.

### E3 — Glyph-led controls had no spoken name · **fixed**

- **Symptom:** `+ add…`, `+ status…` and `− status…` announce as their glyph and
  a bare word, naming neither what they add nor what they add it to.
- **Fix:** each carries an `aria-label` naming the object — *Add a condition or
  field to Jonah*, *Clear a status on room 1*.
- **Closed by:** R2.

### E4 — Nothing checked any of this · **fixed**

- **Symptom:** the smoke run asserted flows *it already knew about*. Nothing
  asserted that a capability had a control at all, so a feature could ship
  reachable only by its author — and nothing walked the app as a stranger.
- **Fix:** `tests/reachability.mjs`, plus `tests/browser.mjs` so the smoke run
  and the audit share one harness instead of drifting apart.
- **Evidence it works:** mid-pass a bad edit added a duplicate `aria-label` to
  `statTile` and broke the whole Sheet screen. R5 reported the throw and R1
  reported twelve capabilities that had just become unreachable, in the same
  run, before any of it could be committed.

---

## Verified clean

Checked during this audit and found correct; no change was needed.

**Fold sequencing**

- `+` / `-` delta order within a single tag: `[PC:Alex|HP-2|HP+1]` applies left
  to right.
- `a -> b` transitions remove the prior state rather than accumulating.
- Numeric deltas against an `X/Y` stat move the current value, not the maximum.
- Reference tags (`[#N:Name]`) assert nothing, including for an element that was
  never established.
- Element identity is case-insensitive on the name and stable across scenes.
- Usage-die step-down runs the full chain to `depleted` without skipping.

**Blocks**

- Nesting closes innermost-first; an unbalanced `[/BLOCK]` is ignored rather
  than corrupting the stack.
- A block opened in a scene header is closed by the next scene marker
  (combat §1.1), and an explicitly opened block is not.
- All five block types behave identically in analog and digital form, in both
  directions.

**Markers**

- `Rd#` and `Tn#` are independent; neither panel advances the other's marker.
- A scene marker resets round and turn scope without discarding folded elements.
- Flashback, montage and parallel-thread scene forms parse their parts.

**Round-trip and determinism**

- All 377 spec examples round-trip byte-identically.
- Folding is deterministic, and folding from any scene checkpoint equals folding
  from zero, across the whole corpus.
- Unrecognised lines survive verbatim and do not disturb state.

**Architecture**

- No RNG anywhere in `src/`.
- No network code outside the service worker; no native `alert`/`confirm`/`prompt`.
- The notation engine imports nothing outside itself.
- Every shipped module is in the service-worker app shell.
- Every asset reference is relative, so a project subpath works.

**Accessibility**

- One `h1` per screen; exactly one `aria-current` nav item.
- Live regions, a labelled nav landmark, a skip link, and a document language.
- Modals are labelled, trap focus, close on Escape and restore focus.
- Zero horizontal overflow at 360px and 390px on all six screens.

**Information fidelity** *(second pass)*

- Every `spec:` citation in the 30 reference entries names a section that exists
  in the document it names; §4.3 and its subsections are present in the body
  even though the conversion lost their headings.
- Every reference example is notation the lexer classifies as the construct the
  entry documents, and no example uses a form the specs do not define (B5).
- All eleven lint rules cite a catalogued defect in `docs/spec-review.md`, and
  each message states the rule the spec actually gives.
- The oracle ladder, the degree bands and the `d100` odds column are labelled
  house aids; the app ships no publisher's oracle or table (D3, §9.8).
- 32 spec-verbatim constructs covering the whole ledger were folded and checked
  against the state each claims to produce.

**Every control, clicked** *(third pass)*

- 157 controls across the six screens were clicked one at a time in a headless
  browser: no exception, no console error, no dialog left stuck open, and every
  screen still had its `h1` afterwards. The only controls that do nothing are
  the ones that should — a disabled **Add to log**, a toggle already pressed,
  the composer's **Add** with an empty box, and the two file downloads.
- 20 dialogs were opened and swept: each has a title, traps focus, closes on
  Escape, names every button, and labels every field.
- Status-strip chips trace: clicking one focuses the line that set the value
  (§5.7).

**Documents present but not implemented**

- `lonelog/` carries three further official documents — Card Notation Add-on
  v1.0.0, Dice Notation Add-on v1.0.0, and the Community Add-on Guidelines
  v1.1.0. None is vendored under `docs/spec/`, none is in the ledger, and the
  app implements none of them. Recorded in CLAUDE.md §3 and in
  `docs/spec-review.md` #9 so the gap is deliberate rather than forgotten.
- The Guidelines corroborate two catalogued defects: the five core symbols are
  fixed, and `!` is named there as a non-compliant sixth symbol (review #2).

**Reachability** *(fourth pass)*

- All 33 capabilities the app claims are reachable by clicking, from a cold
  start, without typing notation.
- All eight core symbols have a button, and each button carries its word.
- A first launch reaches a written line and a recorded roll in nine taps, with
  no prior knowledge: guide → start → name → the checklist says what to do next.
- Every dialog in the app is labelled, closes on Escape, and offers a way out.
- Every empty state names a control that exists on the screen it is on.
- Every surfaced add-on panel links to the reference entry for its notation.
