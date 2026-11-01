import type zh from '../zh/wiki';

/**
 * Wiki — three ways of looking at "what is in this world".
 *
 * Namespace: `wiki.*`, second level by area (tab / nav / read / sort / empty).
 *
 * This page is where "Entries" and "Scrapbook" went: read in `display`, edit in
 * `entries`, odds and ends in `pieces`. So the tab wording here has to line up with
 * the wording in `entries.*` / `pieces.*` — if one says "Edit" and the other says
 * "Organise", the author will think they are two different places.
 */
const en: Record<keyof typeof zh, string> = {
  'wiki.title': 'Wiki',
  'wiki.desc':
    'The knowledge base of this world: every entry listed by category on the left, the article laid out on the right. Click through the list, or follow a link inside the text — switch to Edit when you want to change something.',
  'wiki.noWorld': 'Create a world first',

  /* ---------------- the three sub-pages ---------------- */
  'wiki.tab.display': 'Read',
  'wiki.tab.entries': 'Edit',
  'wiki.tab.pieces': 'Scrapbook',
  'wiki.tab.displayHint': 'Browse this world like an encyclopedia',
  'wiki.tab.entriesHint': 'The entry editor: create entries and categories, edit fields, batch polish',
  'wiki.tab.piecesHint': 'Fragments, quick notes, images, audio and video',

  /* ---------------- contents (left column): filtering and sorting ---------------- */
  'wiki.search.placeholder': 'Search titles, aliases, tags, body…',
  'wiki.sort.label': 'Sort',
  'wiki.sort.updated': 'Recently updated',
  'wiki.sort.title': 'By name',
  'wiki.sort.links': 'Most linked',
  'wiki.count': '{n} entries',
  'wiki.nav.empty': 'No entries match',

  /* ---------------- empty states ---------------- */
  'wiki.empty.noMatch': 'No matching entries',
  'wiki.empty.noMatchDesc': 'Try another keyword, or clear the search box.',
  'wiki.empty.none': 'This world has no entries yet',
  'wiki.empty.noneDesc':
    'Create a category, then write entries into it — this is where they will be browsable.',
  'wiki.empty.goEdit': 'Create entries',

  /* ---------------- reading ---------------- */
  'wiki.read.back': 'Back to',
  'wiki.read.edit': 'Edit this entry',
  'wiki.read.noContent': 'This entry has no body yet.',
  'wiki.read.outline': 'Sections',
  'wiki.read.related': 'Related ({n})',
  'wiki.read.this': 'this entry',
  'wiki.read.mutual': 'mutual',
  'wiki.read.mutualSep': ' ⇄ ',
  'wiki.read.fields': 'Fields',
  'wiki.read.sources': 'Sources ({n})',
  'wiki.read.meta': 'About',
  'wiki.read.updated': 'Updated {time}',
  'wiki.read.linkMissing': 'No entry named "{name}" — the entry this link points at has not been created yet',
};

export default en;
