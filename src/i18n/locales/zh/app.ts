/**
 * 应用外壳：标题、品牌、侧栏导航、世界切换、数据库异常页。
 * 命名空间约定：`app.*`
 */
export default {
  'app.title': 'WorldForge · 个人世界观知识库',
  'app.brandName': 'WorldForge',
  'app.brandSub': '个人世界观知识库',

  'app.noWorld': '还没有世界',
  'app.newWorld': '新建世界',
  'app.newAnotherWorld': '新建另一个世界',
  'app.editCurrentWorld': '编辑当前世界',
  'app.lockedHint': '先新建一个世界',

  'app.modeLocal': '单机模式 · 数据存于本机',
  'app.modeCloud': '云端模式',
  'app.footStats': '{entries} 条目 / {relations} 关系',

  'app.navGroup.overview': '总览',
  'app.navGroup.ai': 'AI 协作',
  'app.navGroup.output': '输出',
  'app.nav.dashboard': '世界总览',
  'app.nav.wiki': 'Wiki',
  'app.nav.graph': '时间与关系',
  'app.nav.studio': 'AI 工作台',
  'app.nav.review': '审查队列',
  'app.nav.docs': '资料库',
  'app.nav.consistency': '一致性检查',
  'app.nav.ask': '问答存档',
  'app.nav.article': '文章审校',
  'app.nav.log': '操作日志',
  'app.nav.export': '导出设定集',
  'app.nav.settings': '设置',
  'app.navWorking': 'AI 正在这里干活 —— 切到别的页面也不会停',

  'app.toast.worldCreated': '「{name}」已经建好了，接下来可以往里添东西了',
  'app.diagCopied': '诊断日志已复制，发给 AI 助手即可',
  'app.diagCopiedShort': '诊断日志已复制',
  'app.copyFallbackPrompt': '自动复制失败，请手动全选复制：',

  /* ---------------- 启动 / 加载 ---------------- */
  'app.boot.loading': '正在打开你的世界观库…',

  /* ---------------- 数据库异常 ---------------- */
  'app.db.openFailed': '无法打开本地数据库',
  'app.db.starvedTitle': '数据库被僵死的排队请求卡住了',
  'app.db.starvedBody':
    '数据库本身还在{dbInfo}，但连接队列里堵着一个早已失效的升级请求，把后面所有请求都饿死了。这种堵死刷新页面无法解除，页面内也没有任何代码能取消别人的排队请求——只能彻底重启浏览器进程。',
  'app.db.starvedDbInfo': '（worldforge v{version}，数据没有丢）',
  'app.db.starvedSteps': '请按顺序操作：',
  'app.db.step1CloseAll': '关闭所有浏览器窗口。',
  'app.db.step2Edge':
    'Edge 的「启动增强」和「Microsoft Edge 关闭后继续运行后台扩展和应用」会让 Edge 在关窗后仍驻留后台 —— 去设置 → 系统和性能 把这两项关掉（至少这次先关掉）。',
  'app.db.step2Kill':
    '按 Ctrl + Shift + Esc 打开任务管理器，结束所有「{browser}」进程——确保一个都不剩，堵住队列的僵尸标签就藏在里面。',
  'app.db.step3Reopen': '重新打开浏览器，回到本页，点下面的「重试」。',
  'app.db.retryAfterRestart': '我已彻底重启浏览器，重试',
  'app.db.retryAfterClose': '关好了，重试',
  'app.db.reload': '重新加载',

  'app.db.missingBody':
    '探测发现这个浏览器环境里根本没有创建过数据库，多半是站点数据被禁用：',
  'app.db.missingIncognito': '使用了「无痕 / 隐私模式」——请换普通窗口打开。',
  'app.db.missingBlocked':
    '浏览器把本站设置为禁用网站数据 / Cookie——请在地址栏左侧的站点设置里放开，或在浏览器设置里清除该站点的「阻止」记录。',

  'app.db.commonCauses': '常见原因与解决办法：',
  'app.db.causeOtherTabs':
    '其他标签页/窗口开着 WorldForge（包括被浏览器休眠的后台标签）——请全部关闭后重试。',
  'app.db.causeBackground':
    'Edge / Chrome 开了「关闭浏览器后继续运行后台应用」时，关掉窗口浏览器进程其实还活着——请在浏览器菜单里点「退出」，或在任务管理器里结束所有浏览器进程后再重开。',
  'app.db.causeIncognito': '使用了「无痕 / 隐私模式」——请换普通窗口打开。',
  'app.db.causeBlocked': '浏览器被设置为禁用网站数据或 Cookie——请在站点设置里放开。',
  'app.db.fixThenRetry': '修复后点「重试」。你的数据不会因此丢失。',

  'app.db.copyLog': '复制诊断日志',
  'app.db.expandLog': '展开诊断日志（直接发给 AI 助手，能定位卡在哪一步）',

  /* ---------------- 数据库升级 ---------------- */
  'app.upgrade.title': '正在升级数据库',
  'app.upgrade.timeoutTitle': '数据库升级等待超时',
  'app.upgrade.timeoutDefault': '升级等待超时',
  'app.upgrade.waiting': '等待其他 WorldForge 标签页释放数据库…',
  'app.upgrade.body':
    '有别的 WorldForge 标签页（可能是被浏览器休眠的后台标签）占着旧版数据库。关闭它们之后，这里会自动完成，不需要刷新。你的数据不会受影响。',
  'app.upgrade.reload': '刷新本页',
} as const;
