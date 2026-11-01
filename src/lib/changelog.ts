/**
 * 更新日志。
 *
 * 放在代码里而不是单独的 md，是因为：
 *   1. 应用是纯前端、没有后端托管文档，随包走最省事；
 *   2. 内容直接进界面，不用再做一次 md 解析；
 *   3. 发版时改这里就行，版本号也从这里读。
 *
 * 每条改动的 `type` 决定前面的标记颜色：
 *   feature 新增 / fix 修复 / improve 改进 / refactor 重构
 *
 * 这里的 `zh` / `en` 是内容本身（不是 UI 文案），所以不进语言包，直接双语内联。
 */

export type ChangelogType = 'feature' | 'fix' | 'improve' | 'refactor';

export interface ChangelogEntry {
  version: string;
  date: string;
  items: { type: ChangelogType; zh: string; en: string }[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.2.0',
    date: '2026-10-01',
    items: [
      {
        type: 'feature',
        zh: '条目新增唯一标识（key）：同一世界内标题归一化后不可重复，创建/编辑/AI 生成/导入时都会校验。', // i18n-allow
        en: 'Entries now have a unique key: normalized titles cannot repeat within a world, checked on create/edit/AI generation/import.',
      },
      {
        type: 'feature',
        zh: '新建世界流程新增「放弃创建」按钮，可清除草稿从头开始，不再只能生成后再删除。', // i18n-allow
        en: 'Added "Abandon" button in world creation to discard the draft and start over, instead of having to create then delete.',
      },
      {
        type: 'fix',
        zh: '修复 AI 工作台切换世界后仍保留旧世界记忆、往旧世界写条目的问题。', // i18n-allow
        en: "Fixed AI workbench keeping the previous world's memory and writing entries to the old world after switching worlds.",
      },
      {
        type: 'fix',
        zh: '编辑条目时标题与已有条目冲突会即时报错，不再静默失败。', // i18n-allow
        en: 'Editing an entry to a duplicate title now shows an error instead of failing silently.',
      },
      {
        type: 'fix',
        zh: '审查队列采纳条目时若与已有条目重复，会提示并跳过，不再产生重复数据。', // i18n-allow
        en: 'Accepting a review item that duplicates an existing entry now warns and skips instead of creating duplicates.',
      },
      {
        type: 'improve',
        zh: 'AI 批量生成条目时自动跳过与库内或同批重复的标题。', // i18n-allow
        en: 'AI batch entry generation now skips titles that duplicate existing entries or same-batch items.',
      },
      {
        type: 'improve',
        zh: '导入备份时自动为旧版条目补全唯一标识。', // i18n-allow
        en: 'Importing backups now backfills unique keys for legacy entries.',
      },
      {
        type: 'feature',
        zh: '设置页新增更新日志，可查看各版本改动。', // i18n-allow
        en: 'Added changelog in Settings to view changes across versions.',
      },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-09-15',
    items: [
      {
        type: 'feature',
        zh: '首个可用版本：世界共创、条目库、关系图、时间轴、AI 工作台、审查队列、一致性检查。', // i18n-allow
        en: 'First usable release: world co-creation, entry library, relation graph, timeline, AI workbench, review queue, consistency check.',
      },
    ],
  },
];

/** 当前版本号 = 更新日志里最新的那条 */
export const APP_VERSION = CHANGELOG[0]?.version ?? '0.0.0';
