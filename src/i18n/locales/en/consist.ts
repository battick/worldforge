import type zh from '../zh/consist';

/** 与 zh/consist.ts 的 key 一一对应，缺一个都会在这里报类型错误 */
const en: Record<keyof typeof zh, string> = {
  /* ---------------- 页面头部 ---------------- */
  'consist.title': 'Consistency check',
  'consist.desc':
    'The AI plays fact-checker, reading through all your entries to find contradictions, timeline mix-ups, power-scale drift, and the like. The problems it finds go into the review queue, and each one can generate a fix in a single click.',
  'consist.noWorld': 'Create a world first',

  /* ---------------- 按钮 ---------------- */
  'consist.btn.audit': 'Start audit',
  'consist.btn.auditing': 'Auditing…',
  'consist.btn.abort': 'Stop',
  'consist.btn.generateFix': 'Have the AI propose a fix',
  'consist.btn.fixAll': 'Propose every fix ({n})',
  'consist.btn.fixAllRunning': 'Writing them one by one…',
  'consist.btn.markHandled': 'Mark as handled',
  'consist.btn.ignore': 'Ignore',

  /* ---------------- 统计卡片 ---------------- */
  'consist.stat.high': 'High-priority conflicts',
  'consist.stat.medium': 'Needs clarification',
  'consist.stat.low': 'Suggestions',
  'consist.stat.handled': 'Handled',

  /* ---------------- 审计范围横幅 ----------------
   * This text has to be **honest**: the index does have a cap, and bodies really are split by a budget.
   * It used to claim “the index and full-text summaries of all entries”, while the code capped the index
   * at 80 — so authors tuned a setting that had no effect. */
  'consist.scope.title': 'Audit scope',
  'consist.scope.desc':
    'Sending {n} entries: the index lists at most {limit} of them (adjustable under “Settings → Max entries sent as context”), and the bodies share a total budget — roughly 900 characters each. The more entries there are, the less each one gets.',
  'consist.scope.ledger':
    '{n} previously audited issues also go along as a ledger — the model only reports what is new.',
  'consist.scope.ledgerEmpty': 'This is the first audit, so there is no ledger yet — everything reported will be new.',

  /* ---------------- 列表筛选 ---------------- */
  'consist.filter.pending': 'Open {n}',
  'consist.filter.all': 'All {n}',

  /* ---------------- 空状态 ---------------- */
  'consist.empty.title': 'No audit records yet',
  'consist.empty.desc':
    'Click “Start audit” in the top right, and the AI will cross-check all your entries. This is the most effective way to find deep logical holes.',
  'consist.empty.cleared': 'No open issues left.',
  'consist.empty.clearedDesc': 'The ones you already ruled on are still here — switch to “All” to look back.',

  /* ---------------- 本轮审计的结果 ---------------- */
  'consist.audit.newTitle': '{n} new issues this round',
  'consist.audit.cleanTitle': 'Nothing new this round',
  'consist.audit.desc':
    'These are leads, not written into your library yet — handle or dismiss them, and the next round can look elsewhere.',
  'consist.audit.skipped':
    '{n} were old issues reported again (the model repeated them; the ledger held them back): {titles}',
  'consist.audit.ledger':
    'The ledger sent along this round held {n} records: {open} open · {settled} ruled on · {revisit} worth a second look',
  'consist.audit.ledgerMore': '; {n} older ones were left out (they are not to be repeated either)',
  'consist.audit.cleanNote':
    'Those {n} ledger records are still outstanding — handle the open ones, and for the settled ones actually edit the entries behind them. If the next round is “nothing new” again, it is most likely not a broken check but the same batch of material.',

  /* ---------------- 问题条目 ---------------- */
  'consist.related': 'Related entries:',
  'consist.related.deleted': '(deleted)',
  'consist.suggestion': 'Suggested fix:',
  'consist.gotoReview': 'Handle them all in the review queue ({n} pending)',

  /* ---------------- generate every fix ---------------- */
  'consist.fixAll.title': '{n} issues can be turned into fixes in one go',
  'consist.fixAll.desc':
    'Grouped by their related entry: several issues on the same entry are merged into one revision, and no two revisions touch the same entry (entries that already have a pending revision are left alone this time). Everything lands in the review queue for you to approve in one sitting.',
  'consist.fixAll.someHeld':
    '{n} more issues target an entry that already has a pending revision, so they are left alone this time.',
  'consist.fixAll.progress': '{done}/{total} · {label}',
  'consist.fixAll.resultTitle': 'Wrote {n} revision proposals',
  'consist.fixAll.resultDesc':
    'These are proposals, not written into your library yet — they take effect once you approve them in the review queue.',
  'consist.fixAll.merged':
    '{n} issues targeted the same entry as another issue and were merged into its single revision',
  'consist.fixAll.heldBack': '{n} issues target an entry that already has a pending revision',
  'consist.fixAll.orphan': '{n} issues point at no editable entry, so no revision could be written',
  'consist.fixAll.failed': '{n} could not be written; you can retry them on their own',
  'consist.fixAll.goReview': 'Confirm in the review queue ({n} pending)',
  'consist.fixAll.dismiss': 'Dismiss',

  /* ---------------- toast ---------------- */
  'consist.toast.needEntries': 'You need at least 2 entries to run a consistency check',
  'consist.toast.noIssues': 'No obvious setting conflicts found — keep writing.',
  'consist.toast.foundNothingNew':
    'Nothing new — the {n} already reported are on the ledger and will not be reworded and served again',
  'consist.toast.foundNew': 'Found {n} new issues; they are now in the review queue',
  'consist.toast.foundAllDup':
    'Nothing new — {n} were an old account already reported, held back by the ledger',
  'consist.toast.fixGenerated':
    'Generated a revision suggestion for “{title}” — confirm it in the review queue',
  'consist.toast.fixAllDone': 'Wrote {n} revision proposals — confirm them in the review queue',
  'consist.toast.fixAllHeld':
    'Every entry these issues point at already has a pending revision — clear those first',
  'consist.toast.fixAllNothing': 'Nothing could be written this time; you can try again later',
  'consist.toast.handled': 'Marked as handled',
  'consist.toast.ignored': 'Issue ignored',

  /* ---------------- queueing a single fix ---------------- */
  'consist.queue.group': 'Consistency fix',
  'consist.queue.label': 'Generate a fix for “{title}”',
  'consist.queue.note': 'Fix proposal written',
  'consist.queue.queued': 'Queued {n}; they run one after another',
  'consist.queue.exists': 'That one is already in the queue',
  'consist.queue.sameTarget':
    'A fix for “{title}” is already running in the queue — one entry gets one revision at a time, otherwise you would not know which one to apply. To handle this issue together with the others, use “Generate fixes for all” above.',
  'consist.queue.hasPending':
    '“{title}” already has a pending revision — clear that one first.',
};

export default en;
