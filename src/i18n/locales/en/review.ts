import type zh from '../zh/review';

/** Review queue page; keys must match zh/review.ts exactly. */
const en: Record<keyof typeof zh, string> = {
  'review.title': 'Review queue',
  'review.desc':
    'Everything the AI produces stops here first. Accepting writes it into your live setting bible; rejecting discards it. You can also edit before accepting.',
  'review.btn.clearRejected': 'Clear rejected',
  'review.btn.acceptAll': 'Accept all',

  'review.stat.pending': 'Awaiting your call',
  'review.stat.conflicts': 'Conflicts to resolve',

  'review.filter.all': 'All types',

  'review.list.count': '{n}',
  'review.uncategorized': 'Uncategorized',
  'review.deleted': '(deleted)',
  'review.newEntry': '(new entry)',

  'review.empty.pending.title': 'The queue is empty',
  'review.empty.other.title': 'No records here yet',
  'review.empty.pending.desc':
    'Go to the AI studio to generate candidate settings, or upload documents and let the AI extract entries — whatever it produces will show up here.',
  'review.empty.goStudio': 'Open AI studio',
  'review.empty.goDocs': 'Open documents',

  'review.detail.aliases': 'Aliases: {names}',
  'review.detail.collapseBody': 'Collapse body',
  'review.detail.expandBody': 'Expand body',
  'review.detail.targetEntry': 'Target entry',
  'review.detail.suggestion': 'Suggested fix:',
  'review.detail.summary': 'Summary',
  'review.detail.deleteWarn':
    'Accepting will permanently delete this entry and all its relations (reversible from the activity log).',
  'review.detail.deleteRelationWarn':
    'Accepting will remove this relation (reversible from the activity log).',
  'review.detail.deleteRelCount': 'It currently has {n} relation(s), which will be deleted along with it.',
  /* A proposal carrying a time: say where it lands and how to move it */
  'review.time.landsAt':
    'It carries the time “{when}” — lands at the end of the axis once accepted; drag it into place in Time & relations',
  'review.time.goThere': 'Open the time axis',
  'review.detail.rationale': 'AI rationale:',
  /**
   * Where the proposal came from. The default paths (document extraction / batch
   * generation) are not labelled — that is just noise. Only the studio agent gets a
   * badge: it may have invented something the library never had, and the author is
   * entitled to know whether he is reviewing transcription or speculation.
   */
  'review.origin.agent': 'From the studio agent',
  /** one end of a relation proposal has not landed yet */
  'review.blocked.relationDraft':
    'An entry it depends on is still in the review queue — accept that one first',

  /* ---------------- Timeline layout plan ---------------- */
  'review.layout.colEntry': 'Entry',
  'review.layout.colPos': 'Position',
  'review.layout.colWhen': 'Set to when',
  'review.layout.colOther': 'Also changes',
  'review.layout.notPlaced': 'not on the axis',
  'review.layout.eraTo': 'era → {era}',
  'review.layout.toAt': 'ends at {n}',
  'review.layout.toWhen': 'when → "{from}"',
  'review.layout.gone': '(deleted in the meantime — it will be skipped on accept)',
  'review.layout.hint':
    'Smaller values come earlier, and the gap between two values is the distance on the axis. Accepting only changes positions — the wording you wrote ("Year 12 of the Rising Tide") stays exactly as it is.',
  'review.layout.guessHint':
    'These are times the AI guessed for you. Accepting sets both the time text and the axis position. Check each row’s reason before accepting anything you are unsure about.',
  'review.layout.reasonTip': 'Why the AI put it there: {reason}',
  'review.layout.editTitle': 'Adjust this layout',
  'review.layout.editHint':
    'Unchecked rows are left alone, and each position can be tuned. Saving only updates this proposal — press Accept to actually write it.',
  'review.guess.editTitle': 'Adjust these guesses',
  'review.guess.editHint':
    'Unchecked rows are left without a time, and both the time and position can be tuned. Saving only updates this proposal — press Accept to actually write it.',
  'review.guess.editWhen': 'Time',
  'review.layout.editPick': 'Take this row',
  'review.layout.editPos': 'Position',
  'review.layout.editEnd': 'End',
  'review.layout.editNone': 'Nothing left — this plan is not worth accepting.',

  'review.diff.before': 'Before',
  'review.diff.after': 'After',
  'review.diff.empty': '*(empty)*',

  'review.field.title': 'Title',
  'review.field.summary': 'Summary',
  'review.field.content': 'Body',
  'review.field.tags': 'Tags',
  'review.field.aliases': 'Aliases',
  'review.field.category': 'Category',
  'review.field.contentMd': 'Body (Markdown)',

  'review.btn.markHandled': 'Mark as handled',
  'review.btn.accept': 'Accept',
  'review.btn.editAccept': 'Edit before accepting',
  'review.btn.reject': 'Reject',
  'review.btn.saveChanges': 'Save changes',
  'review.btn.rerun': 'Regenerate',
  'review.btn.revert': 'Revert',

  'review.confirm.acceptAll':
    'Accept the {n} proposals in the current list? This writes them straight into your setting library.',
  'review.batch.confirm':
    'Accept all {n} revisions in this batch? This writes them straight into your setting library.',

  /* ---------------- One batch (batch polish / batch generate) ---------------- */
  'review.batch.title': 'One batch · {n} items',
  'review.batch.accept': 'Accept this batch',
  'review.batch.reject': 'Reject this batch',
  'review.batch.skippedEnds':
    '{n} skipped — the entry at the other end of their relation hasn\u2019t landed yet',
  'review.batch.allBlocked':
    'Everything in this batch is waiting on the other end of a relation, so nothing can be accepted yet',

  'review.toast.accepted': 'Accepted {n}',
  'review.toast.acceptedOne': 'Accepted and written to the setting library',
  'review.toast.rejected': 'Rejected',
  'review.toast.updated': 'Proposal updated — accept it once it looks right',
  'review.toast.skippedEnds':
    'Skipped {n}: the entry at the other end of their relation hasn\u2019t landed yet',

  'review.rerun.title': 'Regenerate \u201c{title}\u201d',
  'review.rerun.hint':
    'Runs the original task again and replaces this proposal with the new result. Add a line below to nudge it closer to what you want (leave blank to rerun as-is).',
  'review.rerun.placeholder':
    '(Optional) extra instruction, e.g. make the protagonist\u2019s name tougher, set it before the founding…',
  'review.rerun.confirm': 'Regenerate',
  'review.rerun.running': 'Regenerating…',
  'review.rerun.done': 'Regenerated — this proposal was replaced with the new result',
  'review.rerun.nothing': 'No replaceable result this time; the original proposal is unchanged',
  'review.rerun.reverted': 'Reverted to the pre-regeneration version',
  'review.rerun.revertHint': 'Go back to the version before regenerating',
};

export default en;
