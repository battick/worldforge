import type zh from '../zh/editor';

/**
 * The body editor — toolbar, syntax colouring, link completion, edit summary.
 *
 * Namespace: `editor.*`, second level by area (tool / ph / table / suggest / stats / help / mode).
 *
 * `editor.ph.*` is the placeholder text **inserted into the body** (what drops in when you
 * click "bold"), so it has to read as prose — "bold text", not "please enter bold text".
 * The author will most likely just type over it; a wordy placeholder gets deleted first.
 */
const en: Record<keyof typeof zh, string> = {
  /* ---------------------------- toolbar ---------------------------- */
  'editor.placeholder': '## Overview\n\nWrite the body in Markdown. Type [[ to link to another entry.',

  'editor.tool.bold': 'Bold (Ctrl/Cmd + B)',
  'editor.tool.italic': 'Italic (Ctrl/Cmd + I)',
  'editor.tool.strike': 'Strikethrough',
  'editor.tool.code': 'Inline code (Ctrl/Cmd + E)',
  'editor.tool.h1': 'Heading 1',
  'editor.tool.h2': 'Heading 2',
  'editor.tool.h3': 'Heading 3',
  'editor.tool.plain': 'Back to body text (drop the heading)',
  'editor.tool.wikilink': 'Link to another entry (Ctrl/Cmd + K)',
  'editor.tool.link': 'External link',
  'editor.tool.image': 'Image',
  'editor.tool.ul': 'Bulleted list',
  'editor.tool.ol': 'Numbered list',
  'editor.tool.quote': 'Quote',
  'editor.tool.codeblock': 'Code block',
  'editor.tool.hr': 'Divider',
  'editor.tool.table': 'Insert a table',
  'editor.tool.sections': 'Sections',
  'editor.tool.help': 'Keyboard shortcuts',

  /* ---------------------------- inserted placeholders ---------------------------- */
  'editor.ph.bold': 'bold text',
  'editor.ph.italic': 'italic text',
  'editor.ph.strike': 'struck-through text',
  'editor.ph.code': 'code',
  'editor.ph.link': 'entry name',
  'editor.ph.linkText': 'link text',
  'editor.ph.url': 'https://',
  'editor.ph.imageAlt': 'image caption',

  /* ---------------------------- table ---------------------------- */
  'editor.table.title': 'Insert a table',
  'editor.table.rows': 'Rows',
  'editor.table.cols': 'Columns',
  'editor.table.col': 'Col {n}',
  'editor.table.insert': 'Insert',

  /* ---------------------------- sections ---------------------------- */
  'editor.sections.empty': 'No sections yet. Start one with ## and it will show up here',

  /* ---------------------------- link suggestions ---------------------------- */
  'editor.suggest.title': 'Link to an entry',
  'editor.suggest.for': '"{q}"',
  'editor.suggest.hint': '↑↓ to choose · Enter to insert · Esc to close',
  'editor.suggest.none': 'No entry named "{q}" yet — you can leave it as is; the reader will mark it as a link waiting to be written',

  /* ---------------------------- status bar ---------------------------- */
  'editor.stats.chars': '{n} characters',
  'editor.stats.sections': '{n} sections',
  'editor.stats.links': '{n} entry links',
  'editor.stats.urls': '{n} external links',
  'editor.footHint': 'The body is Markdown; [[entry name]] is an entry link',

  /* ---------------------------- shortcuts ---------------------------- */
  'editor.help.key.bold': 'Ctrl/Cmd + B',
  'editor.help.what.bold': 'Bold',
  'editor.help.key.italic': 'Ctrl/Cmd + I',
  'editor.help.what.italic': 'Italic',
  'editor.help.key.link': 'Ctrl/Cmd + K',
  'editor.help.what.link': 'Turn the selection into an entry link; with nothing selected it inserts [[ ]]',
  'editor.help.key.tab': 'Tab / Shift+Tab',
  'editor.help.what.tab': 'Indent / outdent whole lines',
  'editor.help.key.enter': 'Enter',
  'editor.help.what.enter': 'Continue the list; on an empty item it ends the list',
  'editor.help.note':
    'Type [[ and the entry suggestions appear. The graph and the consistency check both understand [[entry links]] — and if you forget the syntax, come back and click this question mark.',

  /* ---------------------------- editor shell ---------------------------- */
  'editor.mode.edit': 'Edit',
  'editor.mode.split': 'Split',
  'editor.mode.preview': 'Preview',
  'editor.previewHint': 'This is exactly how it will read — the reader uses the same typography.',
  'editor.summary.label': 'Edit summary',
  'editor.summary.placeholder': 'One line on what you changed',
  'editor.summary.hint': 'Optional. Write one and the activity log will later tell you why this was changed.',
  'editor.draft.found': 'You left an unsaved draft last time',
  'editor.draft.restore': 'Restore it',
  'editor.draft.discard': 'Discard',
  'editor.leave.confirm':
    'The body has unsaved changes.\n\nOK = save them now.\nCancel = leave it — the draft is kept and you can carry on next time.',
};

export default en;
