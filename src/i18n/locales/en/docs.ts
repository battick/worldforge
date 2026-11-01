import type zh from '../zh/docs';

/** 与 zh/docs.ts 的 key 一一对应，缺一个都会在这里报类型错误 */
const en: Record<keyof typeof zh, string> = {
  /* ---------------- 页面头部 ---------------- */
  'docs.title': 'Documents',
  'docs.desc':
    'Drop in scattered old documents, setting notes, and script drafts. The AI reads them through and breaks them into structured entries — you just nod or shake your head in the review queue.',
  'docs.noWorld': 'Create a world first',

  /* ---------------- 拖放区 ---------------- */
  'docs.drop.busy': 'Parsing files…',
  'docs.drop.idle': 'Click to choose files, or drag them here',
  'docs.drop.formats': 'Supports {exts}',
  'docs.drop.privacy':
    'Word and PDF are parsed locally in your browser; files are never uploaded to any server.',

  /* ---------------- 直接输入 ---------------- */
  'docs.compose.orType': 'Rather not upload a file?',
  'docs.compose.open': 'Type / paste text',
  'docs.compose.title': 'Type text directly',
  'docs.compose.nameLabel': 'Document name',
  'docs.compose.namePlaceholder': 'Name this document (blank uses the first line)',
  'docs.compose.bodyLabel': 'Content',
  'docs.compose.bodyPlaceholder': 'Paste or type your text here…',
  'docs.compose.hint':
    'Once saved it works exactly like an uploaded file, and stays only in your own browser.',
  'docs.compose.pasteTip':
    'Or just press Ctrl+V on this page to save the clipboard text as a document',
  'docs.compose.save': 'Save as document',
  'docs.compose.warn.empty': 'Nothing entered yet',
  'docs.compose.toast.saved': 'Saved “{name}”',
  'docs.compose.defaultName': 'Untitled note',

  /* ---------------- 抽取设置 ---------------- */
  'docs.field.category': 'Extracted entries default to this category',
  'docs.hint.extract':
    'During extraction the AI compares against existing entries, so duplicates won’t be re-extracted; anything uncertain is flagged for your verification.',

  /* ---------------- 资料列表 ---------------- */
  'docs.list.title': 'Imported documents ({n})',
  'docs.empty.title': 'No documents yet',
  'docs.empty.desc':
    'Import an old setting document to see the AI turn it into entries automatically.',
  'docs.meta.importedAt': 'imported {time}',
  'docs.meta.parsed': ' | extracted',
  'docs.btn.viewText': 'View text',
  'docs.btn.extract': 'Extract entries',
  'docs.confirm.delete': 'Delete document “{name}”?',
  'docs.toast.deleted': 'Deleted',

  /* ---------------- toast ---------------- */
  'docs.toast.noText': '{name}: no text could be read',
  'docs.toast.fileWarning': '{name}: {warning}',
  'docs.toast.parseFailed': '{name} failed to parse: {msg}',
  'docs.toast.imported': 'Imported {n} documents',
  'docs.toast.needCategory':
    'Create a category first — the AI needs to know where to put the entries',
  'docs.toast.noExtract':
    'No entries suitable for the library could be extracted from this document',
  'docs.toast.extracted': 'Extracted {n} candidate entries',
  'docs.toast.queued': 'Sent {n} entries to the review queue',
  'docs.chunk.name': '{name} (part {i}/{total})',

  /* ---------------- 抽取结果 ---------------- */
  'docs.result.title': 'Extraction result',
  'docs.result.count': '{n} candidate entries',
  'docs.result.deselectAll': 'Deselect all',
  'docs.result.push': 'Send to review queue ({n})',
  'docs.result.skipped': 'Skipped content:',

  /* ---------------- 文本预览弹窗 ---------------- */
  'docs.preview.truncated': '\n\n… (showing only the first 30,000 characters)',
};

export default en;
