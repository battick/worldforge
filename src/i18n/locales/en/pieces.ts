import type zh from '../zh/pieces';

/** 与 zh/pieces.ts 的 key 一一对应，缺一个都会在这里报类型错误 */
const en: Record<keyof typeof zh, string> = {
  'pieces.title': 'Scrapbook',
  'pieces.desc':
    'Entry text is where your “canon” lives; this is where everything else goes: long and short pieces, stray thoughts, descriptions of things, personal plots — plus images, audio and video. Text items automatically become reference material for World Q&A.',

  /* ---------------- List ---------------- */
  'pieces.list.noWorld': 'Create a world first',
  'pieces.list.btn.upload': 'Upload image/audio/video',
  'pieces.list.btn.new': 'Write one',
  'pieces.list.quick.placeholder': 'Jot a line — a thought, a bit of dialogue, half a setting; press Enter to save',
  'pieces.list.quick.btn': 'Stash it',
  'pieces.list.quick.saved': 'Stashed in the scrapbook',
  'pieces.list.upload.done': 'Added {n} item(s) — click to add notes',
  'pieces.list.search.placeholder': 'Search title/body/tags',
  'pieces.list.empty.title': 'The scrapbook is still empty',
  'pieces.list.empty.desc':
    'Stash anything: old drafts, stray lines, character notes, reference images, a piece of music. It need not be complete — just toss it in.',
  'pieces.list.pinned': 'Pinned',
  'pieces.list.btn.pin': 'Pin',
  'pieces.list.btn.unpin': 'Unpin',
  'pieces.list.confirm.delete': 'Delete “{title}”? The media file will be deleted too.',
  'pieces.list.toast.deleted': 'Deleted',
  'pieces.list.meta.createdAt': 'Stashed {time}',
  'pieces.list.noContent': '(No body yet — click “Edit” to add one)',
  'pieces.list.linked': 'Related entries',

  /* ---------------- Media ---------------- */
  'pieces.media.loading': 'Loading media…',
  'pieces.media.download': '⬇ Download {name} ({size})',
  'pieces.media.drop.idle': 'Drag images / audio / video here',
  'pieces.media.drop.active': 'Release to stash these items',
  'pieces.media.attach': 'Attachment: {name} ({size}) — write notes below.',

  /* ---------------- Filter ---------------- */
  'pieces.filter.all': 'All {n}',

  /* ---------------- Editor ---------------- */
  'pieces.editor.title.new': 'Write one',
  'pieces.editor.title.edit': 'Edit item',
  'pieces.editor.warn.empty': 'Write something, or cancel first',
  'pieces.editor.untitled': 'Untitled item',
  'pieces.editor.label.kind': 'Type',
  'pieces.editor.kind.mediaNote': ' (media item — type is determined by the file)',
  'pieces.editor.label.title': 'Title',
  'pieces.editor.placeholder.title': '(Optional — defaults to the first line of the body)',
  'pieces.editor.label.content': 'Body (Markdown supported)',
  'pieces.editor.placeholder.content':
    'Write anything — this is your scrapbook, no one is judging.',
  'pieces.editor.label.note': 'Note / description',
  'pieces.editor.placeholder.note':
    'What is this media? One line for your future self and the AI.',
  'pieces.editor.label.tags': 'Tags (comma-separated)',
  'pieces.editor.placeholder.tags': 'e.g. inspiration, unused, Northern Reach',
  'pieces.editor.label.linked': 'Related entries (whom is this item about — optional)',
  'pieces.editor.placeholder.entrySearch': 'Search entries…',
  'pieces.editor.empty.entries': '(This world has no entries yet)',
};

export default en;
