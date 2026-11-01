/**
 * 设置页：界面语言、AI 模型、数据存储、备份恢复、使用小贴士。
 * 命名空间约定：`settings.*`
 */
export default {
  'settings.title': '设置',
  'settings.desc':
    'AI 模型、数据存储与备份。API Key 只保存在你这台设备的浏览器里，不会上传到任何服务器。',

  /* ---------------- 界面语言 ---------------- */
  'settings.lang.title': '界面语言',
  'settings.lang.desc':
    '切换后立即生效，选择保存在本机浏览器里（不会写进世界观数据）。新增语言只需补一份语言包，这里会自动多出一个选项。',
  'settings.lang.auto': '跟随系统',
  'settings.lang.autoHint': '当前：{locale}',

  /* ---------------- AI 模型 ---------------- */
  'settings.ai.title': 'AI 模型',
  'settings.ai.configured': '已配置',
  'settings.ai.notConfigured': '未配置',
  'settings.ai.test': '测试连接',
  'settings.ai.provider': '服务商',
  'settings.ai.model': '模型名称',
  'settings.ai.modelPlaceholder': '例：deepseek-chat',
  'settings.ai.modelHint':
    '可以直接手填任意型号 ID，也可以点「选型号」从厂商真实列表里挑（那把钥匙能用哪些，列表里就是哪些）。',
  'settings.ai.baseUrl': 'API 地址（Base URL）',
  'settings.ai.baseUrlHint':
    '必须是兼容 OpenAI 协议的地址，通常以 /v1 结尾。本地 Ollama 可填 http://localhost:11434/v1（无需 Key）。',
  'settings.ai.baseUrlReset': '这一家的地址被改过 —— 恢复成官方地址（{url}）',
  'settings.ai.apiKey': 'API Key',
  'settings.ai.show': '显示',
  'settings.ai.hide': '隐藏',
  'settings.ai.keyHint':
    'Key 仅存在本机 localStorage（键名 worldforge:settings）。如果用云端存储模式，Key 不会跟随数据同步。',
  'settings.ai.temperature': '创造性（temperature）：{value}',
  'settings.ai.temperatureHint': '设定创作建议 0.7-1.0；一致性检查与文章审校建议 0.2-0.4。',
  'settings.ai.contextLimit': '送入条目的数量上限',
  'settings.ai.contextLimitHint':
    '每次生成时最多带入多少个已有条目作为上下文，越大越准确也越贵。',
  'settings.ai.vision': '允许把图片素材发给模型',
  'settings.ai.visionHint':
    '新建世界时你上传的图片会交给模型读取。若当前模型不支持读图（例如纯文本模型），即使开着也读不了 —— 应用会自动跳过图片并继续，不会中断流程。确定模型不能读图可以关掉，省一次失败请求。',
  'settings.ai.maxTokens': '单次回复上限（max_tokens）',
  'settings.ai.maxTokensHint': '0 = 不限制，交给厂商默认。填小了会长文被截断。',
  'settings.ai.topP': '采样范围（top_p）：{value}',
  'settings.ai.topPHint': '1.00 = 不限制（多数厂商的默认值）。一般只调 temperature 就够了。',
  'settings.ai.stream': '用流式接收回复（边写边显示）',
  'settings.ai.streamHint':
    '关闭后要等整段写完才一次显示。只有在网关的流式不老实（少字、乱序、莫名中断）时才建议关掉。',
  'settings.ai.advanced': '高级：直接改请求',
  'settings.ai.advancedOn': '已更改',
  'settings.ai.jsonMode': 'JSON 模式（response_format）',
  'settings.ai.jsonMode.auto': '自动 —— 按每个任务本来的需要（默认）',
  'settings.ai.jsonMode.always': '总是带上 json_object',
  'settings.ai.jsonMode.never': '从不带 —— 网关不认识这个字段时选它',
  'settings.ai.jsonModeHint':
    '应用到哪些任务里要结构化的输出（工作台、一致性检查、关系抽取）。报「response_format 不支持」就选「从不带」。',
  'settings.ai.extraHeaders': '额外请求头',
  'settings.ai.extraHeadersHint':
    'JSON 对象。有些网关要求额外的鉴权头或版本头，写在这里。同名字段（不分大小写）会覆盖内置的 Authorization。',
  'settings.ai.extraBody': '额外请求体',
  'settings.ai.extraBodyHint':
    'JSON 对象，与内置参数合并 —— 可以用来传 deepseek 的 thinking、qwen 的 enable_thinking 这类厂商私有开关。同名字段以你写的为准，但 messages 不会被覆盖。',
  'settings.ai.testOkPrefix': '连接成功',
  'settings.ai.testOk': '连接成功，模型回复：{reply}',
  'settings.ai.testOkToast': '连接正常',
  'settings.ai.testFailedToast': '连接失败，请看下方详情',

  /* ---------------- 世界管理 ---------------- */
  'settings.world.title': '世界管理',
  'settings.world.new': '新建世界',
  'settings.world.current': '当前',
  'settings.world.stats': '{entries} 条目 ｜ {relations} 关系 ｜ 更新于 {time}',
  'settings.world.switch': '切换',
  'settings.world.edit': '编辑',
  'settings.world.confirmDelete': '删除世界「{name}」及其 {n} 个条目？此操作不可撤销。',
  'settings.world.deleted': '已删除',

  /* ---------------- 数据存储 ---------------- */
  'settings.storage.title': '数据存储',
  'settings.storage.localBanner':
    '当前是单机模式：所有数据存在本机浏览器的 IndexedDB 中，离线可用、不依赖网络。清除浏览器数据会一并清除世界观，请定期用下方「导出备份」。',
  'settings.storage.upgrade': '升级到云端（可选）',
  'settings.storage.upgradeHint':
    '将来如果你想让多台设备同步，或想开放给朋友一起写，只要搭一台小服务器实现下面这套接口，然后把地址填进来即可，本机代码无需改动：',
  'settings.storage.tableNames':
    '，表名为 worlds / categories / entries / relations / docs / review。',
  'settings.storage.baseUrl': '云端地址',
  'settings.storage.token': '访问令牌（可选）',
  'settings.storage.save': '保存并切换',
  'settings.storage.savedToast': '已保存存储配置，正在刷新…',

  /* ---------------- 备份与恢复 ---------------- */
  'settings.backup.title': '备份与恢复',
  'settings.backup.importConfirm':
    '点「确定」= 清空现有数据后完整恢复；点「取消」= 与现有数据合并（同 ID 覆盖）。',
  'settings.backup.imported': '导入完成',
  'settings.backup.importFailed': '导入失败：{message}',
  'settings.backup.export': '导出全部数据',
  'settings.backup.import': '导入备份文件',
  'settings.backup.wipeConfirm1':
    '确定清空全部数据？所有世界、条目、关系、资料与审查记录都会被删除，且无法撤销。',
  'settings.backup.wipeConfirm2': '再确认一次：这是不可逆操作。',
  'settings.backup.wipe': '清空全部数据',
  'settings.backup.wiped': '已清空',
  'settings.backup.downloaded': '备份已下载',

  /* ---------------- 小贴士 ---------------- */
  'settings.tips.title': '使用小贴士',
  'settings.tips.linkBefore': '在正文里写 ',
  'settings.tips.linkSample': '[[条目名]]',
  'settings.tips.linkAfter': ' 就能建立内链，图谱和一致性检查都会用到它。',
  'settings.tips.tone': '「基调与创作纪律」里写清禁止项（例如「禁止出现现代科技名词」），AI 跑偏会明显减少。',
  'settings.tips.more': '条目越多，生成越准。如果发现 AI 重复造已有设定，先去「条目库」确认那条设定是否已经存在、标题是否够简洁。',
  'settings.tips.review': '审查队列里「改一改再采纳」比重写一遍快得多，AI 的初稿通常只差一个语气。',
  'settings.tips.consistency': '每写完一章回来做一次一致性检查，比攒到十万字再回头改省事得多。',

  /* ---------------- 更新日志 ---------------- */
  'settings.changelog.title': '更新日志',
  'settings.changelog.current': '当前版本',
  'settings.changelog.type.feature': '新增',
  'settings.changelog.type.fix': '修复',
  'settings.changelog.type.improve': '改进',
  'settings.changelog.type.refactor': '重构',
} as const;
