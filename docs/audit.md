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
