import type zh from '../zh/exp';

/** Export compendium page; keys must match zh/exp.ts exactly. */
const en: Record<keyof typeof zh, string> = {
  'exp.title': 'Export the compendium',
  'exp.desc':
    'Turn your world into a document you can hand to someone. Markdown is good for further editing; open the HTML in a browser and you can “Print → Save as PDF” directly or paste it into Word.',
  'exp.noWorld': 'Create a world first',
  'exp.btn.exportMarkdown': 'Export Markdown',
  'exp.btn.exportHtml': 'Export HTML / Word',

  'exp.scope.title': 'Export options',
  'exp.scope.onlyCanon': 'Only export {status} entries',
  'exp.scope.countHint': 'Currently exporting {kept} / {total} entries',
  'exp.scope.includeDraft': 'Include {status} entries',
  'exp.scope.includeRelations': 'List relations at the end of each entry',
  'exp.scope.includeTimeline': 'Include the chronicle (entries with a time)',
  'exp.scope.keepLinks': 'Keep [[internal link]] syntax',
  'exp.scope.keepLinksHint':
    'When off, internal links are replaced with plain text — convenient when exporting to tools that don’t support the syntax.',

  'exp.backup.title': 'Data backup',
  'exp.backup.desc':
    'The backup file contains every world, entry, relation, full document text, review record and scrapbook item (media files are inlined as base64). Use it to migrate to another device.',
  'exp.backup.btn': 'Export all data (JSON)',

  'exp.preview.charCount': '{n} chars',
  'exp.preview.empty': '(nothing to export)',

  'exp.file.mdName': '{base}_compendium.md',
  'exp.file.htmlName': '{base}_compendium.html',

  'exp.toast.markdownDone': 'Markdown exported',
  'exp.toast.htmlDone': 'HTML exported — double-click to open, then print to PDF',
  'exp.toast.backupDone': 'Backup downloaded',
  'exp.toast.copied': 'Copied to clipboard',
  'exp.toast.copyFailed': 'Copy failed — please select the text manually',
};

export default en;
