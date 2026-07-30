/**
 * How-to guide for the whole app (CLAUDE.md §8).
 *
 * Lives beside the notation reference: the Guide teaches what to *do*, section
 * by section; the Reference answers "what does this symbol mean" out of order.
 *
 * One accordion per part of the app, each opening to numbered steps. Sections
 * link to the screen they describe rather than acting for you — a guide that
 * quietly creates a campaign teaches nothing and leaves data behind.
 *
 * No per-game rules content (§9.8): the play section describes the loop this
 * notation is built around, not any publisher's system.
 */

import { el, clear } from './core.js';
import { referenceButton } from './ui.js';

/**
 * @typedef {{id:string, title:string, blurb:string, steps:string[],
 *   examples?:string[], route?:string, routeLabel?:string, reference?:string,
 *   needsCampaign?:boolean}} Section
 */

/** @type {Section[]} */
export const SECTIONS = [
  {
    id: 'play-loop',
    title: 'How to play a solo session',
    blurb: 'The loop this notation is built around. It works the same whatever '
      + 'rules you are playing, and with no rules at all.',
    steps: [
      'Frame the scene: where you are, when it is, and what is at stake. Tap Scene in the status strip and type that context.',
      'Say what your character does — tap @ Did and write it. One action at a time.',
      'If the outcome depends on your rules, roll your dice and enter them: tap 🎲 Roll, pick the shape of the comparison, type the numbers, and the app labels the result.',
      'If instead it depends on what the world does — is anyone home, does the guard notice — tap ? Asked and answer it with the oracle or with a table.',
      'Read the answer back into the fiction and write it down with => So. This is the part that matters; the dice are only there to surprise you.',
      'Record what stuck: a person, a place, a clock ticking up. Tap Tag… and name it.',
      'When the stakes are settled, tap Scene again to open the next one. When you stop for the night, tap Session… → End session.',
    ],
    examples: [
      'S1 *Rooftops, before dawn*',
      '@ Sneak past the watchman',
      '? Is he still awake',
      'd: d100=22 vs 50 -> Yes, but...',
      '=> He is dozing, but the tiles are loose underfoot. [N:Watchman|dozing]',
      '[Clock:Suspicion 1/6]',
    ],
    reference: 'action',
  },
  {
    id: 'campaigns',
    title: 'Campaigns — starting and keeping games',
    blurb: 'One campaign per game you are playing. Nothing needs setting up: no '
      + 'system to choose, no character sheet to fill in, no account.',
    steps: [
      'Tap New campaign and give it a name. That is the whole of the setup.',
      'Tap a campaign to open it. Play and Sheet then appear in the bottom bar and stay pointed at it.',
      'Never used the notation before? Tap Look at an example on the empty list — it opens a short played log you can poke at and delete.',
      'Delete removes a campaign and its log for good; there is a confirmation first.',
      'Settings lives here too — backups, import and export, spec warnings, theme.',
      'On Play, Details → Edit header… records what you are playing: title, ruleset, genre, player, tone. It rides along in the exported markdown.',
    ],
    route: 'campaigns',
    routeLabel: 'Open Campaigns',
  },
  {
    id: 'play',
    title: 'Play — writing your log',
    blurb: 'The screen you spend the session on. Everything you write lands in '
      + 'one plain-text file you own.',
    steps: [
      'Tap Session… → Start session to open a session, and Scene to open a scene inside it.',
      'Pick a symbol, type the rest of the line, press Enter. @ Did is something you do, ? Asked is a question for the world, d: Rolled is dice, => So is what changed.',
      'Tap ⋯ More for the other four: -> Result when the dice are not worth writing down, tbl: Table, gen: Generate, and ( ) Note for an aside to yourself.',
      'Tap Tag… to name anything that sticks around. Fields go one per row — the app writes the notation.',
      'Tap Said… for a line of dialogue: pick who is speaking and type what they said. Excerpt… is for a longer piece of in-fiction text — a found document, a passage worth keeping.',
      'The strip along the top is your live state. Tap it to open every value; tap a value to jump to the line that set it.',
      'Undo takes back the whole of your last entry, and Restore puts it back. Tap any line to edit it or delete from there down.',
      'Tap a row to read it, edit it, or delete from that line on. Close is the safe default.',
    ],
    examples: [
      '@ Search the shelves',
      'd: d20+4=17 vs DC 15 -> Success',
      '=> A loose page falls out. [N:Librarian|watchful]',
    ],
    route: 'log',
    routeLabel: 'Open Play',
    reference: 'action',
    needsCampaign: true,
  },
  {
    id: 'sheet',
    title: 'Sheet — what the app tracks for you',
    blurb: 'Your log, read back to you. Nothing here was configured: every value '
      + 'is folded out of the tags you wrote.',
    steps: [
      'Write [PC:Name|HP 10] once and a character sheet grows itself. Every stat you invent becomes a row.',
      'Use − and + to step a value, or set to type a new one. Each writes a new line to your log — it never edits state behind your back, which is why undo always works.',
      'Clocks, tracks and timers show as meters. Step them the same way.',
      'Threads show their state; tap Open, Closed or Abandoned to move one.',
      'Tap the line number beside any value to jump to the line that set it.',
      'Add a field to anything with + field, and drop one with its ×.',
    ],
    examples: ['[PC:Alex|HP 8|Stress 0]', '[Clock:Suspicion 3/6]', '[Thread:Find the sister|Open]'],
    route: 'state',
    routeLabel: 'Open the Sheet',
    reference: 'tag-pc',
    needsCampaign: true,
  },
  {
    id: 'roll',
    title: 'Roll — dice, oracle and tables',
    blurb: 'The app never rolls. You roll real dice; it captures the numbers and '
      + 'says what they mean.',
    steps: [
      'On Play, tap 🎲 Roll. The panel opens over your log, so the line you were writing is still there afterwards.',
      'Pick the shape of the comparison — against a target, counting successes, paired challenge dice, keep highest, a Fudge ladder, or degree bands.',
      'Type what you rolled. The outcome and the exact line appear before you commit anything.',
      'For a yes/no question, use the Oracle: type the question, pick how likely it is, roll a d100 and enter it. That ladder is a house aid — if your game has its own oracle, read that and type the answer instead.',
      'Define a table once and it lives in your log, so the log still makes sense to someone who does not own your books. Enter the number you rolled and it writes the lookup line.',
      'Roll again and the panel offers the same roll back — the label and the target you last used, with the dice empty, because you roll those.',
      'With no target there is nothing to compare, so the panel asks what the roll meant rather than inventing a result. You can always type your own word — Hit, Yes, but…',
      'Roll the same shape a few times and the app offers to save it as a one-tap quick roll. Nothing is saved unless you say so, and a saved roll never fills in the dice.',
    ],
    examples: [
      'd: Stealth d6=5 vs TN 4 -> Success',
      'tbl: Mood [Tense, Melancholic, Hopeful, Uncanny]',
      'tbl: Mood d4=2 -> Melancholic',
    ],
    route: 'resolve',
    routeLabel: 'Open Roll',
    reference: 'dice',
    needsCampaign: true,
  },
  {
    id: 'addons',
    title: 'Add-on panels — combat, resources, rooms, battles',
    blurb: 'There is nothing to switch on. A panel appears on the Sheet the first '
      + 'time its tags appear in your log.',
    steps: [
      'Write your first [F:] tag, or an Rd1 round marker, and a Combat panel appears with damage, position and status controls.',
      'Write [Inv:] or [Wealth:] and Resources appears — quantities, usage dice, spending and earning.',
      'Write [R:] and Dungeon appears: room status, exits, and a status block you can snapshot.',
      'Write [Unit:] or a Tn1 turn marker and Battle appears, with casualties, morale, heat and armour.',
      'Every control writes a line to your log, exactly as if you had typed it.',
      'Done with a panel? Hide it. That hides the panel only — your log keeps every line.',
    ],
    examples: ['[F:Thug|HP 6|Close]', '[Inv:Torch|3]', '[R:1|active|entry cave]', '[Unit:Rifles|x12|Morale 8|Fresh]'],
    route: 'state',
    routeLabel: 'Open the Sheet',
    reference: 'addon-combat',
    needsCampaign: true,
  },
  {
    id: 'keeping',
    title: 'Keeping your log — export, import, backup',
    blurb: 'What you write is a plain Lonelog markdown file. You can read it in '
      + 'any text editor, with or without this app.',
    steps: [
      'Settings → Export all as markdown writes each campaign out as a .md file.',
      'Settings → Export JSON backup saves everything at once — campaigns, quick rolls, tables.',
      'Import markdown brings a log back, keeping every line verbatim including lines this app does not recognise.',
      'On a browser that supports it, Bind to file on Play ties a campaign to a real .md on disk and re-saves as you play.',
      'Nothing is ever uploaded. There is no server and no account, so take a backup now and then.',
    ],
    route: 'settings',
    routeLabel: 'Open Settings',
  },
  {
    id: 'warnings',
    title: 'Spec warnings and the notation reference',
    blurb: 'The app checks your lines against the Lonelog specs, and never blocks '
      + 'you on what it finds.',
    steps: [
      'A line that breaks a notation rule is flagged in the margin. Tap the row to read why, with a link to the explanation.',
      'It is advice, not a gate — the line is written either way.',
      'Turn warnings down or off in Settings → Spec warnings.',
      'The Notation view beside this one explains every symbol, tag and block, with the section of the spec it comes from.',
    ],
    route: 'settings',
    routeLabel: 'Open Settings',
  },
  {
    id: 'install',
    title: 'Install it, and staying up to date',
    blurb: 'It is a web app that installs like a native one and works with no '
      + 'connection at all.',
    steps: [
      'Use your browser’s Install or Add to Home Screen. It then opens like any other app.',
      'Everything is stored on that device, so keep a backup.',
      'When a new version is published you get a toast with an Update button. It waits for you — an update never reloads a session you are writing in.',
      'You can also check by hand: Settings → Check for updates.',
    ],
    route: 'settings',
    routeLabel: 'Open Settings',
  },
];

/**
 * @param {HTMLElement} host
 * @param {{go:(route:string)=>any, hasCampaign:boolean}} ctx
 */
export function renderGuide(host, ctx) {
  clear(host);

  // A first-ever launch lands here (§8.2 F9), so the first thing on the page is
  // the thing that first launch needs.
  if (!ctx.hasCampaign) {
    host.append(el('div', { class: 'row' }, [
      el('button', {
        class: 'btn btn-primary', type: 'button', id: 'guide-start',
        onclick: () => ctx.go('campaigns'),
      }, ['Start my first campaign']),
    ]));
  }

  host.append(el('p', { class: 'hint' }, [
    'One section per part of the app. Open the one you need — nothing here '
    + 'changes your log.',
  ]));

  const list = el('ul', { class: 'guide-list' });

  const toggle = el('button', {
    class: 'btn btn-small', type: 'button', id: 'guide-toggle',
    onclick: () => {
      const sections = [...list.querySelectorAll('details')];
      const expand = sections.some((d) => !d.open);
      for (const d of sections) d.open = expand;
      toggle.textContent = expand ? 'Collapse all' : 'Expand all';
      toggle.setAttribute('aria-pressed', expand ? 'true' : 'false');
    },
  }, ['Expand all']);
  toggle.setAttribute('aria-pressed', 'false');

  host.append(el('div', { class: 'group ref-controls' }, [toggle]));

  for (const section of SECTIONS) {
    const body = el('div', { class: 'guide-body' }, [
      el('p', { class: 'el-detail' }, [section.blurb]),
      el('ol', { class: 'guide-steps' }, section.steps.map((step) => el('li', {}, [step]))),
    ]);

    if (section.examples?.length) {
      body.append(el('pre', { class: 'log-preview' }, [section.examples.join('\n')]));
    }

    const blocked = section.needsCampaign && !ctx.hasCampaign;
    body.append(el('div', { class: 'row' }, [
      section.route ? el('button', {
        class: 'btn btn-small', type: 'button',
        onclick: () => ctx.go(blocked ? 'campaigns' : section.route),
      }, [blocked ? 'Start a campaign first' : section.routeLabel ?? 'Open']) : null,
      section.reference ? referenceButton(section.reference, { label: section.title }) : null,
    ].filter(Boolean)));

    list.append(el('li', {}, [
      el('details', { class: 'guide-section', dataset: { section: section.id } }, [
        el('summary', { class: 'guide-head' }, [
          el('span', { class: 'guide-title' }, [section.title]),
        ]),
        body,
      ]),
    ]));
  }

  host.append(list);
}
