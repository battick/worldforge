/**
 * 正文编辑器 —— 工具栏、语法上色、内链补全、编辑摘要。
 *
 * 命名空间约定：`editor.*`；二级为区域（tool / ph / table / suggest / stats / help / mode）。
 *
 * `editor.ph.*` 是**插进正文里**的占位文字（点了「加粗」落下的那几个字），
 * 所以它们得能当正文读（「粗体」而不是「请输入粗体文字」）——
 * 作者点完按钮大概率直接在上面接着打字，占位符太啰嗦反而要删。
 */
export default {
  /* ---------------------------- 工具栏 ---------------------------- */
  'editor.placeholder': '## 概览\n\n用 Markdown 写正文。打 [[ 可以链到其它条目。',

  'editor.tool.bold': '加粗（Ctrl/Cmd + B）',
  'editor.tool.italic': '斜体（Ctrl/Cmd + I）',
  'editor.tool.strike': '删除线',
  'editor.tool.code': '行内代码（Ctrl/Cmd + E）',
  'editor.tool.h1': '一级标题',
  'editor.tool.h2': '二级标题',
  'editor.tool.h3': '三级标题',
  'editor.tool.plain': '变回正文（去掉标题）',
  'editor.tool.wikilink': '内链到其它条目（Ctrl/Cmd + K）',
  'editor.tool.link': '外部链接',
  'editor.tool.image': '图片',
  'editor.tool.ul': '无序列表',
  'editor.tool.ol': '有序列表',
  'editor.tool.quote': '引用',
  'editor.tool.codeblock': '代码块',
  'editor.tool.hr': '分隔线',
  'editor.tool.table': '插入表格',
  'editor.tool.sections': '章节',
  'editor.tool.help': '快捷键',

  /* ---------------------------- 插入的占位文字 ---------------------------- */
  'editor.ph.bold': '粗体',
  'editor.ph.italic': '斜体',
  'editor.ph.strike': '删除线',
  'editor.ph.code': '代码',
  'editor.ph.link': '条目名',
  'editor.ph.linkText': '链接文字',
  'editor.ph.url': 'https://',
  'editor.ph.imageAlt': '图片说明',

  /* ---------------------------- 表格 ---------------------------- */
  'editor.table.title': '插入表格',
  'editor.table.rows': '行数',
  'editor.table.cols': '列数',
  'editor.table.col': '列{n}',
  'editor.table.insert': '插入',

  /* ---------------------------- 章节 ---------------------------- */
  'editor.sections.empty': '正文还没有小节。用 ## 起一个，这里就会列出来',

  /* ---------------------------- 内链候选 ---------------------------- */
  'editor.suggest.title': '链接到条目',
  'editor.suggest.for': '「{q}」',
  'editor.suggest.hint': '↑↓ 选择 · Enter 填入 · Esc 关掉',
  'editor.suggest.none': '还没有叫「{q}」的条目 —— 先这么写着也行，阅读页会把它标成待建的链接',

  /* ---------------------------- 状态条 ---------------------------- */
  'editor.stats.chars': '共 {n} 字',
  'editor.stats.sections': '{n} 节',
  'editor.stats.links': '{n} 内链',
  'editor.stats.urls': '{n} 外链',
  'editor.footHint': '正文用 Markdown；[[条目名]] 是内链',

  /* ---------------------------- 快捷键 ---------------------------- */
  'editor.help.key.bold': 'Ctrl/Cmd + B',
  'editor.help.what.bold': '加粗',
  'editor.help.key.italic': 'Ctrl/Cmd + I',
  'editor.help.what.italic': '斜体',
  'editor.help.key.link': 'Ctrl/Cmd + K',
  'editor.help.what.link': '给选中的字加内链；没选就是插一对 [[ ]]',
  'editor.help.key.tab': 'Tab / Shift+Tab',
  'editor.help.what.tab': '整行往右 / 往左缩进',
  'editor.help.key.enter': '回车',
  'editor.help.what.enter': '列表里接着下一项；空项上回车则收掉列表',
  'editor.help.note':
    '打 [[ 就会弹出条目候选。[[内链]] 会被关系图与一致性检查认出来 —— 语法忘了也不用去翻文档，回来点这个问号。',

  /* ---------------------------- 编辑器外壳 ---------------------------- */
  'editor.mode.edit': '编辑',
  'editor.mode.split': '分栏',
  'editor.mode.preview': '预览',
  'editor.previewHint': '这里就是保存之后的模样 —— 阅读页用的是同一套排版。',
  'editor.summary.label': '编辑摘要',
  'editor.summary.placeholder': '一句话说明这次改了什么',
  'editor.summary.hint': '留空也行。写上一句，日后翻活动日志就知道当时为什么改。',
  'editor.draft.found': '上次编辑到一半，还有一份没保存的改动',
  'editor.draft.restore': '恢复这一份',
  'editor.draft.discard': '丢弃',
  'editor.leave.confirm':
    '正文改了但还没保存。\n\n点「确定」= 现在保存。\n点「取消」= 先放着 —— 草稿会留着，下次打开还能接着改。',
};
