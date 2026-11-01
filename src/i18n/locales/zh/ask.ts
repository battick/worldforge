/**
 * 世界问答页（src/pages/AskPage.tsx）。
 *
 * 这个页面的角色已经变了：提问本身搬进了 AI 工作台（那里有一个能真正读写
 * 知识库的 agent），这里只剩只读的历史会话存档。所以输入框、提示泡之类的
 * key 都已经删掉，别再往回加。
 *
 * 命名空间约定：`ask.*`
 */
export default {
  'ask.noWorld': '请先创建一个世界',
  'ask.title': '问答存档',
  'ask.desc':
    '这里留着你过去和 AI 的问答记录，只能回看。想继续提问请去 AI 工作台 —— 那边由能直接读写知识库的 agent 来作答。',
  'ask.me': '我',
  'ask.ai': 'AI',
  'ask.entryNotFound': '没有找到名为「{name}」的条目',
  'ask.cite': '引用：',
  /** 顶部引导条：提问能力已经搬去 AI 工作台 */
  'ask.archive.banner': '提问已经搬到 AI 工作台，那里的 agent 能直接读写你的知识库。',
  'ask.archive.goStudio': '去 AI 工作台',
  /** 全部会话都没内容时的空态 */
  'ask.archive.empty': '还没有问答记录',
  'ask.archive.emptyDesc': '去 AI 工作台和 agent 聊几句，历史会话随后会出现在这里。',
  /** 这一轮的工具调用当时被暂缓，没有真正执行 */
  'ask.archive.skipped': '这批动作当时没有执行。',
  /** 失败回执的前缀标签（颜色之外再给一个明确说法，不单靠颜色区分） */
  'ask.archive.stepFailed': '失败',
} as const;
