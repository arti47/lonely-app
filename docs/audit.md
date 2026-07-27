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

**Documents present but not implemented**

- `lonelog/` carries three further official documents — Card Notation Add-on
  v1.0.0, Dice Notation Add-on v1.0.0, and the Community Add-on Guidelines
  v1.1.0. None is vendored under `docs/spec/`, none is in the ledger, and the
  app implements none of them. Recorded in CLAUDE.md §3 and in
  `docs/spec-review.md` #9 so the gap is deliberate rather than forgotten.
- The Guidelines corroborate two catalogued defects: the five core symbols are
  fixed, and `!` is named there as a non-compliant sixth symbol (review #2).
