/**
 * Transcript rendering and editing (CLAUDE.md §3.1).
 *
 * Every row is one lexed entry and knows its line index, so a value in the State
 * pane can point back at the line that set it (§5.7). Undo is truncation
 * (§5.1) — there is no separate edit history to keep in sync with the log.
 */

import { el, clear } from './core.js';
import { LINT_REFERENCE } from './reference.js';
import { modal, confirmModal, promptModal, showToast, referenceButton } from './ui.js';

/**
 * @param {HTMLElement} host
 * @param {object[]} entries
 * @param {{onTruncate:(line:number)=>any, onEdit:(line:number,text:string)=>any,
 *          findings?:object[], focusLine?:number|null}} ctx
 */
export function renderLog(host, entries, ctx) {
  clear(host);

  if (!entries.length) {
    host.append(el('p', { class: 'empty' }, [
      'Nothing logged yet. Use the composer below — tap a symbol, type, and press Enter.',
    ]));
    return;
  }

  const byLine = new Map();
  for (const f of ctx.findings ?? []) {
    if (!byLine.has(f.line)) byLine.set(f.line, []);
    byLine.get(f.line).push(f);
  }

  const list = el('ol', { class: 'log-rows', start: '1' });

  for (const entry of entries) {
    const findings = byLine.get(entry.line) ?? [];
    const worst = findings.some((f) => f.severity === 'error') ? 'error'
      : findings.length ? 'warn' : null;

    const row = el('li', {
      class: `log-row kind-${entry.kind}`,
      dataset: { line: String(entry.line), kind: entry.kind },
      tabindex: '0',
      'aria-label': `Line ${entry.line + 1}, ${entry.kind}`,
    }, [
      // The gutter carries the line number, not the symbol: the symbol is
      // already the first thing on the line, and the State pane refers to
      // values by line (§5.7).
      el('span', { class: 'log-num', 'aria-hidden': 'true' }, [String(entry.line + 1)]),
      el('span', { class: 'log-text' }, highlight(entry)),
    ]);

    if (worst) {
      row.classList.add(`has-${worst}`);
      row.append(el('span', {
        class: 'log-flag', title: findings.map((f) => `${f.rule}: ${f.message}`).join('\n'),
      }, [worst === 'error' ? '!' : '?']));
    }

    if (entry.line === ctx.focusLine) row.classList.add('is-focused');

    row.addEventListener('click', () => openRowMenu(entry, ctx, findings));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRowMenu(entry, ctx, findings); }
    });

    list.append(row);
  }

  host.append(list);

  if (ctx.focusLine != null) {
    host.querySelector('.is-focused')?.scrollIntoView({ block: 'center' });
  } else {
    list.lastElementChild?.scrollIntoView({ block: 'end' });
  }
}

/** Wrap recognised tags so they read differently from prose. */
function highlight(entry) {
  const tags = (entry.tags ?? []).filter((t) => t.span).sort((a, b) => a.span[0] - b.span[0]);
  if (!tags.length) return [entry.raw || ' '];

  const out = [];
  let cursor = 0;
  for (const t of tags) {
    if (t.span[0] > cursor) out.push(entry.raw.slice(cursor, t.span[0]));
    out.push(el('span', { class: `tag tag-${t.type.toLowerCase()}` }, [entry.raw.slice(t.span[0], t.span[1])]));
    cursor = t.span[1];
  }
  if (cursor < entry.raw.length) out.push(entry.raw.slice(cursor));
  return out;
}

async function openRowMenu(entry, ctx, findings = []) {
  const body = el('div', {}, [el('pre', { class: 'log-preview' }, [entry.raw || '(blank)'])]);

  // Lint is advisory: it explains, links to the reference, and never blocks.
  for (const finding of findings) {
    body.append(el('div', { class: `note note-${finding.severity === 'error' ? 'warn' : ''} lint-summary` }, [
      el('span', {}, [finding.message]),
      LINT_REFERENCE[finding.rule]
        ? referenceButton(LINT_REFERENCE[finding.rule], { label: finding.rule })
        : null,
    ]));
  }

  const choice = await modal({
    title: `Line ${entry.line + 1}`,
    body,
    actions: [
      { label: 'Close', value: null },
      { label: 'Edit', value: 'edit' },
      { label: 'Truncate from here', value: 'truncate', primary: true },
    ],
  });

  if (choice === 'edit') {
    const text = await promptModal('Rewrite this line', { title: `Edit line ${entry.line + 1}`, value: entry.raw });
    if (text != null) await ctx.onEdit(entry.line, text);
    return;
  }

  if (choice === 'truncate') {
    const ok = await confirmModal(
      `Delete line ${entry.line + 1} and everything after it? Undo is available immediately afterwards.`,
      { title: 'Truncate log', confirmLabel: 'Truncate' },
    );
    if (ok) await ctx.onTruncate(entry.line);
    else showToast('Left unchanged.');
  }
}
