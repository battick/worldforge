import type zh from '../zh/time';

/** Key-for-key with zh/time.ts — a missing one is a type error here */
const en: Record<keyof typeof zh, string> = {
  /* ---------- The time view (Relations & time → Time) ---------- */
  'time.view.desc':
    'On the right are the entries **not yet on the axis**: drag one onto the axis and it sits at that spot — the spot *is* its time. To be more precise (a wording like “First year”, a span, “to date”, an era, a weight, an exact position), select it and edit it right there — changes take effect immediately.',
  'time.view.tool.add': 'New entry',
  'time.scale.proportional': 'By value',
  'time.scale.even': 'Evenly spaced',
  'time.scale.hintProportional': 'Gaps between nodes reflect the difference in their position values',
  'time.scale.hintEven': 'Ignore the gaps, one after another — easier to read the order',
  'time.view.tool.onlyMajor': 'Major only',
  'time.view.tool.zoomIn': 'Loosen',
  'time.view.tool.zoomOut': 'Tighten',
  'time.view.tool.density': 'Density',
  'time.view.tool.reset': 'Reset view',

  /* ---------- Empty state ---------- */
  'time.empty.title': 'Nothing is on the timeline yet',
  'time.empty.desc':
    'What happened in this world, and when? Drag an entry from the right onto this axis and it sits at that spot.',
  'time.empty.action': 'Make a new one on the axis',
  'time.empty.goRelations': 'See relations',
  'time.empty.hasNone':
    'This world already has {n} entries, but none is on the axis — so the axis is empty because there is nothing to lay out.',

  /* ---------- The axis ---------- */
  'time.axis.addHint': 'Click here to make a new one at this moment',
  'time.axis.dragHint': 'Hold a node and drag sideways to change its order',
  'time.axis.dropHere':
    'Drag an entry from “Not on the timeline yet” onto this axis — wherever you drop it is when it happened',
  'time.axis.notimeLegend': 'Dashed ring = the spot is fixed, the wording is not written yet',
  'time.axis.samePosition':
    'A few sit very close together (or share the same position value), so for now they stack out of each other way — edit their positions if you want them truly apart.',
  'time.axis.dragging': 'position {n}',
  'time.axis.ongoingArrow': 'to date',

  /* ---------- Reading a time out loud ---------- */
  /**
   * The connector is part of the copy: Chinese uses a fullwidth dash, English an en dash.
   * So it must live here, not in the component — otherwise the typography follows the
   * code instead of the language.
   */
  'time.label.range': '{from} – {to}',
  'time.label.ongoing': '{from} – {until}',
  /** In the list and the panel the start is already printed, so only the tail is needed */
  'time.label.tailRange': '– {to}',
  'time.label.tailOngoing': '– {until}',
  /** Placeholder for a missing end point (only a start is known) */
  'time.label.unknown': '?',
  'time.legend.clear': 'Show all',

  /* ---------- Weight ---------- */
  'time.weight.major': 'Major',
  'time.weight.normal': 'Notable',
  'time.weight.minor': 'Minor',
  'time.weight.major.hint': 'Turning points, beginnings and ends — drawn larger, with the name always visible',
  'time.weight.normal.hint': 'Worth mentioning',
  'time.weight.minor.hint': 'Small background facts — the name shows on hover',

  /* ---------- The list under the axis ---------- */
  'time.list.heading': 'In chronological order',
  'time.list.count': '{n} in total',
  'time.list.empty': 'No entry matches this filter',
  'time.list.noFrom': '(no time given)',

  /* ---------- Quick glance panel ---------- */
  'time.panel.title': 'On the axis',
  'time.panel.hint':
    'Click a node or a row below to edit its time right here, or to open the entry and read it — what is on the axis *is* the entry, there is no second copy.',
  'time.panel.timed': 'On the axis',
  'time.panel.untimed': 'Not yet',
  'time.panel.open': 'Open entry',
  'time.panel.relations': 'Entries it touches',
  'time.panel.when': 'When it is',
  'time.panel.editHint':
    'Changes take effect immediately — no need to open the entry editor. Position is the number that matters: the order on the axis is built from it, and smaller is earlier.',

  /* ---------- The pool of entries not yet placed ---------- */
  'time.pool.heading': 'Not on the timeline yet',
  'time.pool.hint':
    'Drag one anywhere onto the axis and it is placed — the position is its time. You can also click one, then click anywhere on the axis.',
  'time.pool.search': 'Search name, alias, tag…',
  'time.pool.noMatch': 'No unplaced entry matches that',
  'time.pool.allPlaced': 'Every entry in this world is already on the axis.',
  'time.pool.more': '{n} more are not listed — typing a search is quicker.',
  'time.pool.pending': 'Click anywhere on the axis to put “{title}” there',
  'time.pool.pendingCancel': 'Never mind',
  'time.pool.rowHint': 'Drag “{title}” onto the axis, or click it and then click anywhere on the axis',
  'time.pool.dropAt': 'lands at {n}',
  'time.pool.dropHint': 'drag onto the axis',

  /* ---------- AI auto-layout ---------- */
  'time.layout.btn': 'AI auto-layout',
  'time.layout.running': 'Laying out',
  'time.layout.hint':
    'Let the AI read this world’s times and entries and propose an order. It only **proposes**: the plan lands in the review queue, and nothing moves until you accept it.',
  'time.layout.group': 'Timeline layout',
  'time.layout.label': 'Lay out the timeline of “{world}”',
  'time.layout.needEntries': 'This world has no entries to lay out yet — create a few first.',
  'time.layout.queued': 'Queued ({n} in the queue); it will land in the review queue when done',
  'time.layout.exists': 'A layout job is already in the queue',
  'time.layout.note': '{n} changes submitted — confirm them in the review queue',
  'time.layout.noChange': 'The AI read it and thinks the current order is already right — no changes',
  'time.layout.unmatched': 'The AI named {n} titles that are not in the list; nothing to accept this time',
  'time.layout.planTitle': 'Timeline layout · {n} changes',
  'time.layout.planNote': '{sent} entries were sent in this time; {rest} did not take part.',
  'time.layout.planUnmatched': 'It named {n} titles that are not in the list; ignored: {titles}',
  'time.layout.pendingBanner':
    'An AI layout plan ({n} changes) is waiting for you — nothing on the axis moves until you accept it.',
  'time.layout.goReview': 'Go to review',

  /* ---------- AI actions menu ---------- */
  'time.aiMenu.label': 'AI actions',
  'time.aiMenu.hint':
    'Let the AI help with time: re-order what exists, or guess a time for entries that have none. Results always land in the review queue.',
  'time.layout.shortHint': 'Re-order entries that already have a time',

  /* ---------- AI guess time ---------- */
  'time.guess.btn': 'AI guess times',
  'time.guess.running': 'Guessing times',
  'time.guess.hint':
    'Let the AI guess a sensible time for entries that have none, and set it. It is inventing a date for you, so the result always goes to the review queue and only moves the axis once you accept.',
  'time.guess.shortHint': 'Guess and set times for untimed entries',
  'time.guess.group': 'AI guess times',
  'time.guess.label': 'Guess times for “{world}”',
  'time.guess.needPool': 'Every entry already has a time — nothing to guess.',
  'time.guess.queued': 'Queued ({n} in the queue); it will land in the review queue when done',
  'time.guess.exists': 'A guess job is already in the queue',
  'time.guess.note': '{n} guesses submitted — confirm them in the review queue',
  'time.guess.noChange': 'The AI found no entries it could guess a time for',
  'time.guess.unmatched': 'The AI named {n} titles not in the pool; nothing to accept this time',
  'time.guess.planTitle': 'AI guessed times · {n} entries',
  'time.guess.planNote': '{sent} entries were sent in this time; {rest} did not take part.',
  'time.guess.planUnmatched': 'It named {n} titles not in the pool; ignored: {titles}',
  'time.guess.pendingBanner':
    'An AI guess plan ({n} entries) is waiting for you — nothing on the axis changes until you accept it.',
  'time.guess.goReview': 'Go to review',

  /* ------------------------------------------------------------------ */
  /* The chronicle view (Relations & Time → Chronicle)                    */
  /*                                                                     */
  /* Two readings of the *same* data, so this block only carries layout   */
  /* and reading vocabulary — anything about what a time *is* comes from  */
  /* the `time.*` keys above.                                             */
  /* ------------------------------------------------------------------ */
  'chron.view.desc':
    'Top to bottom this page reads one and the same axis four ways: era bands, cards, a gantt rail, a ruler. The cards form one continuous wall in chronological order, none covering another; the ones that fall too close together are spread out in place, so read exact spans off the rail underneath. Drag a card or a bar left and right to change its order, and click the dashed strip at the bottom to add one at that moment.',
  'chron.era.filterHint': 'Show only “{era}” (click again for everything)',
  'chron.card.noTimeText': 'no time written yet',
  /** The line that surfaces when hovering a card — clicking the card opens the entry */
  'chron.card.view': 'View details',
  'chron.legend.point': 'a point',
  'chron.legend.range': 'a span (its length is the real span)',
  'chron.legend.ongoing': 'to date',
  'chron.panel.title': 'Chronicle',
  'chron.panel.hint':
    'Click a card, or the bar beneath it, to change its time right here — or open the entry to read its text. What you see is the entry itself; there is no second copy.',
  'chron.pool.hint':
    'Drag one onto the rail on the left and it is placed — or click it, then click anywhere on the canvas. Where it lands is when it happened.',
  'chron.tools.more': 'View',
  'chron.tools.moreHint': 'Proportional, major only, density — the once-and-done settings live here',
  /** To the old dot-axis (the time view) — chronicle took over the entry, this is the side door */
  'chron.tools.oldView': 'the old one',
  'chron.tools.oldViewHint':
    'Switch back to the old dot-axis (the time view) — it reads the very same data as the chronicle, and changes on either side count.',
  'chron.push.hint': '{n} spread out',
  'chron.push.hintTitle':
    '{n} cards fall too close together (the same moment, or almost) — they are laid out in order, side by side. Read exact spans off the rail.',

  /* ---------- Shapes of a time ---------- */
  'time.kind.point': 'A point',
  'time.kind.range': 'A span',
  'time.kind.ongoing': 'Start – to date',
  'time.kind.hint.point': 'A single moment, e.g. “Twelfth year of the Tide Era”',
  'time.kind.hint.range': 'With a beginning and an end, e.g. “Twelfth year” to “Thirty-ninth year of the Tide Era”',
  'time.kind.hint.ongoing': 'Started and not finished — drawn all the way to the right edge',

  /* ---------- The Time tab in the entry editor ---------- */
  'time.edit.tab': 'Time',
  'time.edit.heading': 'When, in this world, is this',
  'time.edit.none': 'No time set',
  'time.edit.noneHint':
    'Leaving it unset is perfectly fine — a rule or a place name has no “when” to speak of. Only a time puts it on the axis.',
  'time.edit.set': 'Set a time',
  'time.edit.unset': 'Remove time',
  'time.edit.from': 'From',
  'time.edit.fromPlaceholder': 'e.g. “Twelfth year of the Tide Era”',
  'time.edit.to': 'To',
  'time.edit.toPlaceholder': 'e.g. “Thirty-ninth year of the Tide Era”',
  'time.edit.toAt': 'End position',
  'time.edit.toAtHint':
    'Optional — fill it and the span is drawn to scale on the axis; leave it empty and only a dashed stub is drawn (its length is drawn, not a real span).',
  'time.edit.at': 'Position on the axis',
  'time.edit.atHint':
    'Smaller goes earlier; the difference between values is the distance on the axis — dragging a node changes exactly this. Left empty it lands at the end, which is only first-come-first-served, not a real date.',
  'time.edit.era': 'Era',
  'time.edit.eraPlaceholder': 'Times sharing an era form one coloured band, e.g. “Tide Era”',
  'time.edit.weight': 'Weight',
  'time.edit.lock': 'Lock (position welded to the when text)',
  'time.edit.lockHint':
    'When locked, "120 年" is position 120 and "120 年 6 月" is 120.5 — change the text and the position follows; drag the position and the text is rewritten. A text that cannot be turned into a number (like "涨潮纪") cannot be locked, and falls back to a normal entry.',
  'time.edit.linkHint': 'Write what happened in the body — this entry *is* that moment.',

  /* ---------- Toast ---------- */
  'time.toast.set': 'Gave “{title}” a time',
  'time.toast.unset': 'Removed the time on “{title}”',
  'time.toast.moved': '“{title}” moved to position {n}',
  'time.toast.added': 'Added “{title}” — now write it out',
  'time.toast.placed': '“{title}” is on the timeline — refine its time in the panel on the right',
};

export default en;
