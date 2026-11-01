import type zh from '../zh/entries';

/** Entries page and entry editor; keys must match zh/entries.ts exactly. */
const en: Record<keyof typeof zh, string> = {
  'entries.title': 'Entries',
  'entries.desc':
    'The smallest unit of a world. Every entry is a page — characters, places, factions, events, systems, anything goes. Use',
  'entries.linkSyntax': '[[entry name]]',
  'entries.descTail': 'to cross-reference one another in the body text.',
  'entries.noWorld': 'Create a world first',

  'entries.btn.newCategory': 'New category',
  'entries.btn.newEntry': 'New entry',
  'entries.btn.saveChanges': 'Save changes',

  'entries.cat.all': 'All entries',
  'entries.cat.emptyHint': 'No categories yet — try creating one called “Characters”.',
  'entries.catModal.edit': 'Edit category',
  'entries.catModal.new': 'New category',
  'entries.catModal.delete': 'Delete category',

  'entries.placeholder.search': 'Search titles, aliases, tags, body…',
  'entries.placeholder.categoryName': 'e.g. Geography / Characters / Factions / History / Power system',
  'entries.placeholder.fieldDefs': 'e.g. Age, Faction, Location',
  'entries.placeholder.aliases': 'e.g. Greycloak, The Order',
  'entries.placeholder.tags': 'e.g. key character, mystery',
  'entries.placeholder.summary': 'Helps the AI grasp this setting quickly; also shown in lists and exports',
  'entries.placeholder.aiInstruction':
    'e.g. Add its history with other factions and unify the calendar naming',
  'entries.placeholder.newField': 'New custom field name, e.g. military strength',
  'entries.placeholder.selectEntry': 'Select an entry…',

  'entries.empty.noMatch': 'No matching entries',
  'entries.empty.noMatchDesc': 'Try another keyword, or clear the search box.',
  'entries.empty.categoryEmpty': 'This category is still empty',
  'entries.empty.categoryEmptyDesc':
    'Create entries by hand, or go to the AI studio and let the AI generate candidates in bulk.',

  'entries.row.alias': 'also known as {names}',
  'entries.row.relCount': '{n} relations',
  'entries.row.sources': 'Sources',
  'entries.row.polish': 'AI polish',
  'entries.row.polishHint':
    'Queue it in the dock at the bottom right and it runs in turn — click several and they all line up',

  /* ---------------- single-entry polish (through the job queue) ---------------- */
  'entries.polish.group': 'Entry polish',
  'entries.polish.label': 'Polish “{title}”',
  'entries.polish.queued': 'Queued {n}; they run one after another',
  'entries.polish.exists': 'That one is already in the queue',
  'entries.polish.waiting':
    'This entry already has a pending revision — clear that one first',
  'entries.polish.note': 'Sent {n} revision(s) to review',
  'entries.polish.nothing': 'Looked at it — nothing worth changing',
  'entries.uncategorized': 'Uncategorized',
  'entries.count': '{n} total',

  'entries.modal.chooseCategory': 'Choose a category:',
  'entries.modal.noCategory': 'No categories yet — create one on the left first.',

  'entries.toast.needCategory': 'Create a category first',
  'entries.toast.categorySaved': 'Category saved',
  'entries.toast.categoryDeleted': 'Category deleted',
  'entries.toast.deleted': 'Deleted',
  'entries.toast.relationCreated': 'Relation created',
  'entries.toast.aiQueued':
    'AI revision suggestions are now in the review queue — confirm them field by field there.',

  /* ---------------- Batch polish ---------------- */
  'entries.btn.batch': 'Batch polish',
  'entries.btn.batchOn': 'Exit batch',
  'entries.batch.desc':
    'Tick a batch, pick a focus, then hit "Add to queue" — they join the task queue at the bottom right and get polished one after another, each result landing in the review queue; nothing reaches the library until you accept it.',
  'entries.batch.selected': '{n} selected',
  'entries.batch.selectAll': 'Select all {n}',
  'entries.batch.clear': 'Clear selection',
  'entries.batch.smart': 'Pick the ones worth polishing',
  'entries.batch.smartDone': 'Picked {n} worth polishing',
  'entries.batch.smartNone': 'These entries look complete — nothing was picked.',
  'entries.batch.focus': 'Focus',
  'entries.batch.focusHint':
    'Picking none is fine — the AI then only fixes wording and errors, and changes as little as possible',
  'entries.batch.focus.detail': 'Fill in detail',
  'entries.batch.focus.style': 'Unify the voice',
  'entries.batch.focus.trim': 'Trim the fat',
  'entries.batch.focus.links': 'Add connections',
  'entries.batch.focus.conflict': 'Check conflicts',
  'entries.batch.instruction': 'Extra requirement (optional)',
  'entries.batch.instructionPlaceholder':
    'e.g. always write the era as "the Tide Era", never "the Tide Calendar"',
  'entries.batch.cost':
    'This calls the model {n} times, one after another. Once queued you can switch pages — the queue at the bottom right keeps going.',
  'entries.batch.enqueue': 'Add to queue ({n})',
  'entries.batch.enqueued':
    'Queued {n} — the queue at the bottom right runs them one by one; feel free to switch pages',
  'entries.batch.allQueued': 'All of these are already in the queue',
  'entries.batch.queueLive':
    'This batch: {n} total — {running} running, {queued} waiting · {sent} revision(s) sent to review',
  'entries.batch.queueSettled':
    'This batch is done: {done} of {n} finished · {sent} revision(s) sent to review',
  'entries.batch.queueSettledFailed':
    'This batch is done: {done} of {n} finished, {failed} failed · {sent} revision(s) sent to review',
  'entries.batch.stopBatch': 'Stop this batch',
  'entries.batch.heldBack': '{n} already had a pending revision and were skipped',
  'entries.batch.goReview': 'Go to review',
  'entries.batch.dismiss': 'Dismiss',
  'entries.batch.pickFirst': 'Tick the entries you want to polish first',
  'entries.batch.reason.short': 'Body is thin',
  'entries.batch.reason.noSummary': 'No summary',
  'entries.batch.reason.noTags': 'No tags',
  'entries.batch.reason.noRelation': 'No relations',
  'entries.batch.reason.draft': 'Still a draft',

  'entries.confirm.deleteCategory': 'Delete category “{name}”? Its {n} entries will be deleted too.',
  'entries.confirm.deleteEntry': 'Delete entry “{title}”? Its relations will be deleted too.',

  'entries.default.newEntryTitle': 'New entry',
  'entries.default.untitled': 'Untitled entry',

  'entries.field.categoryName': 'Category name',
  'entries.field.icon': 'Icon',
  'entries.field.fieldDefs': 'Structured fields (comma-separated, may be empty)',
  'entries.field.fieldDefsHint':
    'Once defined, entries in this category get matching input boxes for structured search and AI references.',
  'entries.field.title': 'Title',
  'entries.field.category': 'Category',
  'entries.field.status': 'Status',
  'entries.field.aliases': 'Aliases (comma-separated, used for search and consistency checks)',
  'entries.field.tags': 'Tags (comma-separated)',
  'entries.field.summary': 'One-line summary',
  'entries.field.relType': 'Relation type',
  'entries.field.note': 'Note',

  'entries.tab.content': 'Body',
  'entries.tab.fields': 'Structured fields',
  'entries.tab.fieldsCount': 'Structured fields ({n})',
  'entries.tab.relationsCount': 'Relations ({n})',

  'entries.editor.missing': 'Entry not found',
  'entries.editor.missingDesc': 'This record may have been deleted.',
  'entries.editor.noContent': '*(No body yet)*',
  'entries.editor.id': 'ID: {id}',
  'entries.editor.statusLabel': 'Status:',
  'entries.editor.sources': 'Sources: {n}',

  'entries.ai.title': 'Let the AI polish this setting',
  'entries.ai.generate': 'Generate revision suggestions',
  'entries.ai.hint':
    'The AI will not edit your entry directly — it generates revision suggestions into the review queue, and you decide field by field whether to accept them.',

  'entries.fieldEditor.empty':
    'This category has no fields defined yet. Add custom fields below, e.g. “Age”, “Capital”.',
  'entries.fieldEditor.removeCustom': 'Remove custom field',
  'entries.fieldEditor.add': 'Add field',

  'entries.rel.empty':
    'No relations yet. Add one below by hand, or go to the graph page and let the AI suggest them in bulk.',
  'entries.rel.outgoing': 'points to',
  'entries.rel.incoming': 'from',
  'entries.rel.mutual': 'mutual',
  'entries.rel.mutualSep': ' ⇄ ',
  'entries.rel.deleted': '(deleted)',
  'entries.rel.delete': 'Delete relation',
  'entries.rel.to': 'Relate to',
  'entries.rel.create': 'Create relation',

};

export default en;
