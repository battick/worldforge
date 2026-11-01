/**
 * 后台任务队列（右下角那个提示面板）。
 * 命名空间约定：`queue.*`；二级为区域（状态 / 按钮 / 分组）。
 *
 * 这里只放**面板自己的**文案。具体某件活儿叫什么名字（「为《匠人同盟》生成修订方案」）
 * 归各自的功能命名空间（`consist.*` / `entries.*`）—— 队列是通用设施，不该认识业务。
 */
export default {
  'queue.title': '任务队列',
  'queue.desc':
    'AI 一次只做一件：连着点好几个会排队，按点下去的顺序逐件做完，中途可以撤单。',

  /* ---------------- 状态 ---------------- */
  'queue.status.queued': '排队中',
  'queue.status.error': '失败',
  'queue.status.canceled': '已撤单',

  /* ---------------- 面板顶部的总结 ---------------- */
  'queue.summary.running': '正在{label}',
  'queue.summary.runningMany': '正在{label}，后面还有 {n} 件',
  'queue.summary.idle': '队列已清空 · 共完成 {n} 件',
  'queue.summary.failed': '{n} 件没做成',
  'queue.badge.remaining': '{n}',

  /* ---------------- 按钮 ---------------- */
  'queue.btn.toggle': '展开任务队列',
  'queue.btn.collapse': '收起任务队列',
  'queue.btn.cancel': '撤单',
  'queue.btn.retry': '重试',
  'queue.btn.remove': '移除',
  'queue.btn.clear': '清空已完成',
  'queue.btn.stopAll': '全都停下',

  /* ---------------- 行内细节 ---------------- */
  'queue.row.waiting': '前面还有 {n} 件',
  'queue.row.runningFor': '已跑 {s} 秒',
  'queue.row.doneIn': '用了 {s} 秒',

  /* ---------------- 出错 ---------------- */
  'queue.err.noRunner':
    '这件活儿的执行代码已经不在了（多半是页面刚热更新过），请重新点一次。',
} as const;
