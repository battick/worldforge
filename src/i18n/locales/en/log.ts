import type zh from '../zh/log';

/** 与 zh/log.ts 的 key 一一对应，缺一个都会在这里报类型错误 */
const en: Record<keyof typeof zh, string> = {
  /* ---------------- page head ---------------- */
  'log.title': 'Activity log',
  'log.desc':
    'Every write to the library leaves a record — whether you clicked it elsewhere or the AI studio did it for you. Each step carries an undo snapshot.',
  'log.noWorld': 'Create a world first',

  /* ---------------- empty state ---------------- */
  'log.empty': 'Nothing has happened yet',
  'log.emptyDesc':
    'Once you or the AI studio touch the data, each step shows up here.',

  /* ---------------- how one record reads ---------------- */
  'log.action.create': 'Created',
  'log.action.update': 'Edited',
  'log.action.delete': 'Deleted',
  'log.action.note': 'Noted',
  'log.action.view': 'Opened',
  /** the agent only proposes; an entry lands once the author accepts it in review */
  'log.action.propose': 'Proposed',
  'log.actor.user': 'You',
  'log.actor.agent': 'AI',
  'log.entity.world': 'a world',
  'log.entity.category': 'a category',
  'log.entity.entry': 'an entry',
  'log.entity.relation': 'a relation',
  'log.entity.doc': 'a document',
  'log.entity.piece': 'a scrapbook item',
  'log.entity.note': 'a note',
  'log.entity.settings': 'settings',
  /** "{actor} {action} {entity}" */
  'log.line': '{actor} {action} {entity}',
  'log.lineWithTarget': '{actor} {action} {entity} "{target}"',
  'log.noteLine': '{actor} noted: {detail}',
  'log.global': 'Global',

  /* ---------------- metadata ---------------- */
  'log.fields': 'Fields changed: {fields}',
  /** the reason the agent gave at the time (stored in detail) — otherwise only a verdict shows */
  'log.detail': 'Why: {detail}',
  'log.count': '{n} record(s)',
  'log.undone': 'Undone',
  'log.undoneHint': 'This step has been rolled back',

  /* ---------------- undo ---------------- */
  'log.undo': 'Undo',
  'log.undoTip': 'Roll this step back exactly as it was',
  'log.undone.toast': 'Undone: {what}',
  'log.undoUnavailable': 'This step has no undo information',
  'log.undoFailed': 'Undo failed: {message}',

  /* ---------------- filters ---------------- */
  'log.filter.actor': 'Who',
  'log.filter.entity': 'Kind',
  'log.filter.all': 'All',
  'log.filter.worldOnly': 'This world only',
  'log.filter.worldOnlyOn': 'This world only',

  /* ---------------- clear ---------------- */
  'log.clear': 'Clear log',
  'log.clearConfirm': 'Clear the activity log? Records will go, but world data is untouched.',
  'log.cleared': 'Activity log cleared',

  /* ---------------- jump ---------------- */
  'log.open': 'Open',
  'log.openTip': 'Open it',
  'log.jump': 'View activity log',
};

export default en;
