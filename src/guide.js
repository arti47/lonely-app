/**
 * Step-by-step guide for a new user (CLAUDE.md §8).
 *
 * Lives beside the notation reference: the Guide teaches the app in order, the
 * Reference answers "what does this symbol mean" out of order.
 *
 * Steps link to the screen they describe rather than acting for you — a guide
 * that quietly creates a campaign teaches nothing and leaves data behind.
 */

import { el, clear } from './core.js';
import { referenceButton } from './ui.js';

/**
 * @typedef {{id:string, title:string, body:string[], examples?:string[],
 *   route?:string, routeLabel?:string, reference?:string, needsCampaign?:boolean}} Step
 */

/** @type {Step[]} */
export const STEPS = [
  {
    id: 'start',
    title: 'Start a campaign',
    body: [
      'Everything lives in a campaign — one per game you are playing. Open Campaigns and tap New campaign.',
      'Nothing else needs setting up. There is no system to choose, no character sheet to fill in, and no account. '
      + 'The app works the same whether you are playing Ironsworn, a d20 dungeon crawl or something you invented last night.',
    ],
    route: 'campaigns',
    routeLabel: 'Open Campaigns',
  },
  {
    id: 'first-line',
    title: 'Write your first line',
    body: [
      'The Log screen has a row of symbols along the bottom. Tap one to choose what kind of line you are writing, '
      + 'type the rest, and press Enter.',
      'Those five symbols are the whole language. @ is something you do, ? is a question for the world, '
      + 'd: is a roll, -> is how it turned out, => is what changed in the fiction.',
      'The “?” beside the input explains whichever symbol you have selected.',
    ],
    examples: [
      '@ Sneak past the guard',
      'd: Stealth d6=5 vs TN 4 -> Success',
      '=> I slip by unnoticed.',
    ],
    route: 'log',
    routeLabel: 'Open the Log',
    reference: 'action',
    needsCampaign: true,
  },
  {
    id: 'tags',
    title: 'Name the things that stick around',
    body: [
      'People, places, clocks and characters get a tag. Use the Tag… button rather than typing brackets — '
      + 'it autocompletes names you have already used, so one guard stays one guard.',
      'You only ever write what changed. A later tag merges with the earlier one.',
    ],
    examples: [
      '[N:Guard|watchful]',
      '[PC:Alex|HP 8]',
      '[Clock:Suspicion 1/6]',
    ],
    reference: 'tag-n',
    route: 'log',
    routeLabel: 'Open the Log',
    needsCampaign: true,
  },
  {
    id: 'state',
    title: 'Watch the State screen fill itself in',
    body: [
      'Open State. Everything you tagged is there — a character sheet built from your [PC:] lines, '
      + 'your NPCs and places, and meters for any clocks or timers.',
      'You never configured that sheet. It is your log, read back to you. Tap any value to jump to the line that set it.',
      'The steppers here write a new line to your log; they never edit state behind your back. '
      + 'That is why undo always works.',
    ],
    route: 'state',
    routeLabel: 'Open State',
    reference: 'tag-pc',
    needsCampaign: true,
  },
  {
    id: 'roll',
    title: 'Roll your own dice',
    body: [
      'The app never rolls. You roll real dice, then enter the numbers on the Resolve screen and it works out what they mean.',
      'Pick the shape of the comparison — against a target, counting successes, paired challenge dice, and so on — '
      + 'type what you rolled, and it shows the outcome before you commit it.',
    ],
    examples: ['d: Stealth 5=5 vs TN 4 -> Success'],
    route: 'resolve',
    routeLabel: 'Open Resolve',
    reference: 'dice',
    needsCampaign: true,
  },
  {
    id: 'oracle',
    title: 'Ask the oracle',
    body: [
      'Same screen. Type the question, pick how likely you think it is, roll a d100 and enter it.',
      'The odds ladder is a plain house aid so the app is usable with nothing set up. '
      + 'If your game has its own oracle, read that table and type the answer instead — both land in the log the same way.',
    ],
    examples: ['? Does the guard notice me? (Unlikely)', 'd: d100=12 vs 25 -> Yes, but...'],
    route: 'resolve',
    routeLabel: 'Open Resolve',
    reference: 'question',
    needsCampaign: true,
  },
  {
    id: 'tables',
    title: 'Keep your tables in the log',
    body: [
      'Define a table once and it lives in the campaign file itself, so the log still makes sense to someone '
      + 'who does not own your books.',
      'Roll on it from the Resolve screen: enter the number you rolled and it writes the lookup line for you.',
    ],
    examples: [
      'tbl: Mood [Tense, Melancholic, Hopeful, Uncanny]',
      'tbl: Mood d4=2 -> Melancholic',
    ],
    route: 'resolve',
    routeLabel: 'Open Resolve',
    reference: 'tbl-options',
    needsCampaign: true,
  },
  {
    id: 'scenes',
    title: 'End a scene, end a session',
    body: [
      'Use Scene and Session… in the composer rather than typing markers. Ending a session closes anything you '
      + 'left open and writes a snapshot of whatever you are tracking, all in one go.',
      'It shows you what it is about to write first. Afterwards, Undo takes the whole thing back in one press, '
      + 'and Restore puts it back.',
    ],
    examples: ['S2 *Rooftops, before dawn*', '## Session 2'],
    route: 'log',
    routeLabel: 'Open the Log',
    reference: 'scene',
    needsCampaign: true,
  },
  {
    id: 'addons',
    title: 'Panels appear when you need them',
    body: [
      'Write your first [F:] tag and a combat panel appears on the State screen. First [Inv:] and resources appear. '
      + 'Rooms, units and battles work the same way.',
      'There is nothing to switch on. The log decides what you see, so a campaign that never fights never grows a combat tracker. '
      + 'You can hide a panel you are done with — that only hides it, your log keeps every line.',
    ],
    examples: ['[F:Thug|HP 6|Close]', '[Inv:Torch|3]', '[R:1|active|entry cave]'],
    route: 'state',
    routeLabel: 'Open State',
    reference: 'addon-combat',
    needsCampaign: true,
  },
  {
    id: 'quick-rolls',
    title: 'Let quick rolls learn themselves',
    body: [
      'Roll the same thing a few times and Resolve offers to save it as a one-tap quick roll. Nothing is saved unless you say so.',
      'A saved roll fills in the label and the target but never the dice — you still roll those. '
      + 'Group them into a pack and you can export it to a file.',
    ],
    route: 'resolve',
    routeLabel: 'Open Resolve',
    needsCampaign: true,
  },
  {
    id: 'warnings',
    title: 'Gentle warnings, never blocking',
    body: [
      'If a line breaks a notation rule, its row is flagged. Tap the row to see why, with a link to the explanation.',
      'It is advice, not a gate — the line is written either way. You can turn warnings down or off in Settings.',
    ],
    route: 'settings',
    routeLabel: 'Open Settings',
  },
  {
    id: 'keeping',
    title: 'Your log is a file you own',
    body: [
      'Settings exports any campaign as plain Lonelog markdown — readable in any text editor, with or without this app. '
      + 'A JSON backup saves everything at once.',
      'On a browser that supports it, Bind to file on the Log screen ties a campaign to a real .md on disk and re-saves as you play.',
      'Nothing is ever uploaded. There is no server.',
    ],
    route: 'settings',
    routeLabel: 'Open Settings',
  },
  {
    id: 'install',
    title: 'Install it on your phone',
    body: [
      'Use your browser’s Install or Add to Home Screen. It then opens like any other app and works with no connection at all.',
      'Everything is stored on that device, so take a backup now and then.',
    ],
  },
];

/**
 * @param {HTMLElement} host
 * @param {{go:(route:string)=>any, hasCampaign:boolean}} ctx
 */
export function renderGuide(host, ctx) {
  clear(host);

  host.append(el('p', { class: 'hint' }, [
    'Thirteen steps, in the order you will meet them. Nothing here changes your log — '
    + 'each step just points at the screen it describes.',
  ]));

  host.append(el('ol', { class: 'guide-list' }, STEPS.map((step, index) => {
    const body = [
      el('div', { class: 'guide-head' }, [
        el('span', { class: 'guide-num', 'aria-hidden': 'true' }, [String(index + 1)]),
        el('h2', { class: 'guide-title' }, [step.title]),
        step.reference ? referenceButton(step.reference, { label: step.title }) : null,
      ]),
      ...step.body.map((paragraph) => el('p', {}, [paragraph])),
    ];

    if (step.examples?.length) {
      body.push(el('pre', { class: 'log-preview' }, [step.examples.join('\n')]));
    }

    if (step.route) {
      const blocked = step.needsCampaign && !ctx.hasCampaign;
      body.push(el('div', { class: 'row' }, [
        el('button', {
          class: 'btn btn-small', type: 'button',
          onclick: () => ctx.go(blocked ? 'campaigns' : step.route),
        }, [blocked ? 'Start a campaign first' : step.routeLabel ?? 'Open']),
      ]));
    }

    return el('li', { class: 'guide-step' }, body);
  })));
}
