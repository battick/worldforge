/**
 * 库层（src/lib）里跑在组件之外、但用户仍会看到的文字：
 * 诊断报告、导出产物、文件解析提示、时间格式等。
 * 这些地方拿不到 React Context，统一用 `tGlobal()` 取当前语言的文案。
 * 命名空间约定：`lib.*`
 */
export default {
  /* ---------------- 诊断报告 ---------------- */
  'lib.diag.title': '===== WorldForge 启动诊断日志 =====',
  'lib.diag.time': '时间: {time}',
  'lib.diag.page': '页面: {url}',
  'lib.diag.ua': 'UA: {ua}',
  'lib.diag.visibility': 'document.visibilityState: {state}',
  'lib.diag.idbAvailable': 'indexedDB 可用: {value}',
  'lib.diag.localStorageOk': 'localStorage: 正常',
  'lib.diag.localStorageBlocked': 'localStorage: 不可写（隐私模式或站点数据被禁用）',
  'lib.diag.eventHeader': '----- 事件流 -----',
  'lib.diag.end': '===== 日志结束 =====',
  'lib.diag.noDatabases': '（没有任何数据库 —— 可能是全新环境或隐私模式）',
  'lib.diag.probeFailed': '探测失败或超时',
  'lib.diag.idbApiUnsupported': '当前浏览器不支持 indexedDB.databases()',
  'lib.diag.storageEstimate': '已用 {used} / 配额 {quota}',
  'lib.diag.boolTrue': '是',
  'lib.diag.boolFalse': '否',

  /* ---------------- 导出设定集（Markdown / HTML 产物） ---------------- */
  'lib.export.genre': '题材',
  'lib.export.tone': '基调',
  'lib.export.entryTotal': '条目总数',
  'lib.export.exportedAt': '导出时间',
  'lib.export.worldOverview': '世界概述',
  'lib.export.toc': '目录',
  'lib.export.aliases': '别名',
  'lib.export.status': '状态',
  'lib.export.tags': '标签',
  'lib.export.summary': '概述',
  'lib.export.relations': '关联',
  'lib.export.deleted': '（已删除）',
  'lib.export.metaSep': ' ｜ ',
  'lib.export.listSep': '、',
  'lib.export.tocItem': '- **{name}**（{count}）',
  'lib.export.metaItem': '{label}：{value}',
  'lib.export.summaryLine': '**概述**：{value}',
  'lib.export.field': '- **{label}**：{value}',
  'lib.export.relOut': '{type} → {title}',
  'lib.export.relIn': '被{type} ← {title}',
  'lib.export.note': '：{note}',
  'lib.export.timeline': '大事记',
  'lib.export.timelineTotal': '大事记条目',
  'lib.export.timelineNoEra': '（未归入纪元）',
  'lib.export.timelineNoDate': '纪年不详',
  'lib.export.timelineEvent': '- **{date}**：{title}',
  'lib.export.timelineRange': '{from} － {to}',
  'lib.export.timelineOngoing': '{from} 起至今',
  'lib.export.timelineLinked': '  关联：{value}',
  'lib.export.docTitle': '{name} · 世界设定集',
  /* HTML 导出版本：正文直接拼 HTML，标点符号（：、（））也得放进文案里，否则会被 i18n 覆盖扫描当硬编码 */
  'lib.export.html.metaItem': '{label}：{value}',
  'lib.export.html.tocCount': '（{count}）',
  'lib.export.html.metaSep': '　',
  'lib.export.html.colon': '：',

  /* ---------------- 文件解析提示 ---------------- */
  'lib.files.badDocx': '不是有效的 .docx 文件（缺少 word/document.xml）',
  'lib.files.jsonFailed': 'JSON 解析失败，已按纯文本处理',
  'lib.files.docxFailed': 'Word 解析失败：{message}',
  'lib.files.pdfFailed': 'PDF 解析失败：{message}',
  'lib.files.unsupported': '暂不支持 .{ext}，请先另存为 .docx / .pdf / .txt 后再上传',
  'lib.files.unknownFormat': '未知格式 .{ext}，已按纯文本读取',
  'lib.files.pdfPages': '（文件共 {total} 页，已解析前 {parsed} 页）',

  /* ---------------- 媒体 / 图片处理错误 ---------------- */
  'lib.error.readMediaFailed': '读取媒体失败',
  'lib.error.readImageFailed': '读取图片失败',
  'lib.error.decodeImageFailed': '图片解码失败',
  'lib.error.canvasUnsupported': '当前浏览器不支持 Canvas',

  /* ---------------- 状态层（store）：诊断事件与落库时的默认值 ---------------- */
  'lib.state.diag.retryInit': '用户点击重试，重建数据库连接',
  'lib.state.diag.boot': '存储适配器={kind}',
  'lib.state.diag.loadStore': '{name}: {count} 条',
  'lib.state.diag.backfillKeys': '为 {n} 条旧条目补了 key 字段',
  'lib.state.diag.ready': '初始化完成，进入应用',
  'lib.state.upgradeTimeout': '升级等待超时',
  'lib.state.draftNoProposal': '草稿还没有生成设定，无法创建世界',
  'lib.state.unnamedWorld': '未命名世界',
  'lib.state.newCategory': '新分类',
  'lib.state.defaultCategory': '设定',
  'lib.state.categoryN': '分类 {n}',
  'lib.state.unnamedEntry': '未命名条目',
  'lib.state.defaultRelation': '相关',
  /** 同世界内已存在同名条目（key 冲突）时的报错 */
  'lib.state.entryDuplicate': '已存在同名条目「{title}」，条目不允许重名。',
  /** 采纳一条关系提议、而它牵着的条目还没落地时的说明（写在提案上给人看） */
  'lib.state.relationEndpointMissing': '它牵着的条目还没有落地，这条关系先驳回了。',
  'lib.state.unnamedPiece': '未命名藏品',
  /** 旧版「大事记事件」迁成条目后留下的关系类型 */
  'lib.state.migratedTimelineRelation': '牵涉',
  /** 迁移留痕：日志里的那句话 */
  'lib.state.migratedTimeline': '把 {n} 件旧的大事记迁成了条目',
  'lib.state.tempRule': '临时写下的规则',
  'lib.state.unnamedMaterial': '未命名素材',
  'lib.state.newThread': '新对话',
  'lib.state.imageMaterialDoc':
    '（图片素材{note}。建立世界时 AI 已读取这张图，此处仅保留索引。）',
  'lib.state.imageMaterialNote': '：{note}',
  'lib.state.noteBlock': '【备注】{note}\n\n{text}',
  'lib.state.worldRulesHeading': '## 世界的底层规则',

  /* ---------------- 存储适配器 ---------------- */
  'lib.storage.cloudLabel': '云端（{baseUrl}）',
  'lib.storage.memoryLabel': '内存（临时）',
  'lib.storage.noBaseUrl': '未配置云端地址',
  'lib.storage.requestFailed': '云端请求失败：{status} {body}',

  /* ---------------- 本地数据库适配器（IndexedDB） ----------------
     出错提示会直接弹给用户；diag.* 写进「启动诊断日志」，用户复制给我们排查。 */
  'lib.idb.label': '本地数据库（IndexedDB）',
  'lib.idb.noVersion': '不带版本',
  'lib.idb.txNotReady': '数据库尚未初始化',
  'lib.idb.txDisplaced': '数据库刚被其他页面升级，本页已让位。请刷新本页继续（数据不会丢失）。',
  'lib.idb.txUpgrading': '数据库正在升级，请稍候片刻…',
  'lib.idb.openFailed': 'IndexedDB 打开失败',
  'lib.idb.openTimeout':
    '打开本地数据库超时。通常是有别的 WorldForge 标签页（可能已被浏览器休眠）占着数据库，或此前卡住的升级请求还在排队。请关闭其他所有 WorldForge 标签页/窗口后重试；若始终无效，完全退出并重启浏览器即可（数据不会丢失）。',
  'lib.idb.upgradeBlocked': '数据库升级被另一个打开的 WorldForge 页面占用',
  'lib.idb.upgradeIncomplete': '数据库升级后 store 仍不完整，请刷新页面重试',
  'lib.idb.diag.openRequested': '请求已发出（版本={version}）',
  'lib.idb.diag.openTimeout': '等待 {ms}ms 仍无响应（版本={version}）',
  'lib.idb.diag.lateSuccess': '超时后迟到的连接已立即关闭',
  'lib.idb.diag.lateBlocked': '超时后请求仍在队列里排队',
  'lib.idb.diag.pending': '仍在等待（版本={version}）',
  'lib.idb.diag.blocked': '升级请求被其他连接占用（目标版本={version}），{mode}',
  'lib.idb.diag.blockedWaiting': '耐心等待中',
  'lib.idb.diag.blockedAbandon': '即将放弃',
  'lib.idb.diag.opened': '数据库已打开（实际版本={version}）',
  'lib.idb.diag.versionchange': '其他页面请求升级，本页连接主动让位',
  'lib.idb.diag.oldVersion': '库版本 {version}（目标 {target}），将后台升级补齐',
  'lib.idb.diag.upgradeStart': '旧连接已关闭，发起升级到 v{target}',
  'lib.idb.diag.upgradeDone': '已升级到 v{version}',
  'lib.idb.diag.upgradeStillMissing': '升级后 store 仍缺，继续升级到 v{target}',
} as const;
