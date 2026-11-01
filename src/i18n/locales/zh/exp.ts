/**
 * 导出设定集页面的文案。
 * 命名空间约定：`exp.*`；二级为区域（scope / backup / preview / toast）。
 */
export default {
  /* ---------------- 页面头部 ---------------- */
  'exp.title': '导出设定集',
  'exp.desc':
    '把世界观整理成一份可以交给人看的文档。Markdown 适合继续加工，HTML 用浏览器打开后可直接「打印 → 另存为 PDF」或粘进 Word。',
  'exp.noWorld': '请先创建一个世界',
  'exp.btn.exportMarkdown': '导出 Markdown',
  'exp.btn.exportHtml': '导出 HTML / Word',

  /* ---------------- 导出选项 ---------------- */
  'exp.scope.title': '导出选项',
  /* {status} 由 kind.status.canon 提供（只导出已定稿条目） */
  'exp.scope.onlyCanon': '只导出{status}条目',
  'exp.scope.countHint': '当前将导出 {kept} / {total} 个条目',
  /* {status} 由 kind.status.draft 提供（包含草稿状态的条目） */
  'exp.scope.includeDraft': '包含{status}状态的条目',
  'exp.scope.includeRelations': '在条目末尾列出关联',
  'exp.scope.includeTimeline': '导出「大事记」（设了时间的条目）',
  'exp.scope.keepLinks': '保留 [[内链]] 语法',
  'exp.scope.keepLinksHint': '关闭后，内链会被替换成普通文字，方便导出到不支持该语法的工具。',

  /* ---------------- 数据备份 ---------------- */
  'exp.backup.title': '数据备份',
  'exp.backup.desc':
    '备份文件包含所有世界、条目、关系、资料全文、审查记录与杂物间（媒体文件转成 base64 一并保存），可用于迁移到另一台设备。',
  'exp.backup.btn': '导出全部数据（JSON）',

  /* ---------------- 预览 ---------------- */
  'exp.preview.charCount': '{n} 字符',
  'exp.preview.empty': '（没有可导出的内容）',

  /* ---------------- 导出文件名 ---------------- */
  'exp.file.mdName': '{base}_设定集.md',
  'exp.file.htmlName': '{base}_设定集.html',

  /* ---------------- 提示（toast） ---------------- */
  'exp.toast.markdownDone': 'Markdown 已导出',
  'exp.toast.htmlDone': 'HTML 已导出，双击打开后可打印为 PDF',
  'exp.toast.backupDone': '备份已下载',
  'exp.toast.copied': '已复制到剪贴板',
  'exp.toast.copyFailed': '复制失败，请手动选择文本',
} as const;
