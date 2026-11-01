import type zh from '../zh/dash';

/** 与 zh/dash.ts 的 key 一一对应，缺一个都会在这里报类型错误 */
const en: Record<keyof typeof zh, string> = {
  /* ---------------- 空状态（没有激活世界） ---------------- */
  'dash.empty.noSelect.title': 'No world selected',
  'dash.empty.none.title': 'No worlds yet',
  'dash.empty.desc':
    'A world is the container for everything you set down. Starting from a single idea is fine — drop in old drafts, images, and stray thoughts; the AI will read them, ask you questions, and shape them into a setting draft.',

  /* ---------------- 按钮 ---------------- */
  'dash.btn.newWorld': 'New world',
  'dash.btn.editWorld': 'Edit world info',

  /* ---------------- 世界信息卡 ---------------- */
  'dash.pill.categories': '{n} categories',
  'dash.rule.title': 'Creative discipline (injected into every AI generation)',

  /* ---------------- 统计卡片 ---------------- */
  'dash.stat.entries': 'Total entries',
  'dash.stat.canon': 'Canonized',
  'dash.stat.relations': 'Relations',
  'dash.stat.pieces': 'Scrapbook items',
  'dash.stat.piecesTitle': 'Open the scrapbook',
  'dash.stat.reviewPending': 'Proposals to review',

  /* ---------------- AI 未接入横幅 ---------------- */
  'dash.aiOff.title': 'AI is not connected yet',
  'dash.aiOff.desc':
    'The world library already works on its own (entries, relations, export, and backup all work). Once AI is connected, you can use generation, expansion, consistency checks, and article review. Go to “Settings → AI model” and fill in your own API Key.',

  /* ---------------- 待审提议 ---------------- */
  'dash.pending.title': 'Proposals to review',
  'dash.pending.count': '{n} pending',
  'dash.pending.goto': 'Open the review queue',

  /* ---------------- 最近更新 ---------------- */
  'dash.recent.title': 'Recently updated',
  'dash.recent.allEntries': 'All entries',
  'dash.recent.empty':
    'No entries yet. Generate your first batch in the AI studio, or create one by hand.',
  'dash.uncategorized': 'Uncategorized',

  /* ---------------- 结构体检 ---------------- */
  'dash.health.title': 'Structure checkup',
  'dash.health.entryMid': ' entries, ',
  'dash.health.isolatedMid': ' have no relations yet.',
  'dash.health.gapsHint':
    'These categories are thin on content — usually the skeleton gaps of a world:',
  'dash.health.fillGaps': 'Have the AI fill the gaps',
  'dash.health.allGood':
    'Every category has content — try a consistency check to hunt for deeper logical conflicts.',

  /* ---------------- 快速开始 ---------------- */
  'dash.quick.title': 'Quick start',
  'dash.quick.entry.title': 'Enter the settings you already have',
  'dash.quick.entry.desc':
    'Turn the ideas in your head, old documents, and scattered notes into entries — this is the foundation of the library.',
  'dash.quick.entry.action': 'Tidy up entries',
  'dash.quick.docs.title': 'Upload material for the AI to extract',
  'dash.quick.docs.desc':
    'Supports txt / md / docx / pdf; the AI reads it through and breaks it into structured entries for your review.',
  'dash.quick.docs.action': 'Go to documents',
  'dash.quick.studio.title': 'Have the AI generate candidate settings',
  'dash.quick.studio.desc':
    'Batch-produce by category and direction; everything goes into the review queue, and you decide case by case.',
  'dash.quick.studio.action': 'Go to AI studio',
  'dash.quick.article.title': 'Review your article',
  'dash.quick.article.desc':
    'Send in the passages you have written; the AI checks them against your settings, flags conflicts, and suggests fixes.',
  'dash.quick.article.action': 'Go to article review',
};

export default en;
