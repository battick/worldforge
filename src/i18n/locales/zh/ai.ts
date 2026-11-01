/**
 * AI 层：服务商预设、请求错误、连通性测试、送模型的上下文格式。
 *
 * 注意：真正的「提示词正文」（系统角色、纪律、JSON 结构说明）体量很大，
 * 单独放在 `src/ai/prompts/` 下按语言分文件 —— 那也是软编码的一部分，
 * 只是不挤进这个语言包。
 *
 * 命名空间约定：`ai.*`
 */
export default {
  /* ---------------- 服务商预设 ---------------- */
  /* 下拉里的三段分组（二十来家不分组是没法挑的） */
  'ai.provider.group.main': '常用',
  'ai.provider.group.aggregator': '聚合与海外',
  'ai.provider.group.local': '本机',
  'ai.provider.deepseek': 'DeepSeek 深度求索',
  'ai.provider.deepseek.hint': '性价比高，中文长文本表现好，适合世界观设定创作',
  'ai.provider.openai': 'OpenAI',
  'ai.provider.openai.hint': '通用能力强，需自备网络条件',
  'ai.provider.moonshot': 'Moonshot 月之暗面',
  'ai.provider.moonshot.hint': '长上下文，适合整本设定集做一致性检查',
  'ai.provider.zhipu': '智谱 GLM',
  'ai.provider.zhipu.hint': 'glm-4-flash 免费额度友好，适合先跑通流程',
  'ai.provider.dashscope': '通义千问（阿里云）',
  'ai.provider.dashscope.hint': '国内直连稳定',
  'ai.provider.siliconflow': 'SiliconFlow 硅基流动',
  'ai.provider.siliconflow.hint': '聚合多种开源模型',
  'ai.provider.volcengine': '火山方舟（豆包）',
  'ai.provider.volcengine.hint':
    '型号要填火山控制台里创建的「推理接入点 ID」（ep-… 开头），不是模型名本身',
  'ai.provider.hunyuan': '腾讯混元',
  'ai.provider.hunyuan.hint': '腾讯云官方接口，兼容 OpenAI 协议',
  'ai.provider.qianfan': '百度千帆',
  'ai.provider.qianfan.hint': '百度智能云，v2 接口走 OpenAI 兼容模式',
  'ai.provider.stepfun': '阶跃星辰',
  'ai.provider.stepfun.hint': '阶跃星辰官方接口',
  'ai.provider.lingyiwanwu': '零一万物',
  'ai.provider.lingyiwanwu.hint': '零一万物 Yi 系列',
  'ai.provider.openrouter': 'OpenRouter',
  'ai.provider.openrouter.hint':
    '一把钥匙开几百个模型（各家旗舰都在里面），型号写成 vendor/model 的形式',
  'ai.provider.gemini': 'Google Gemini',
  'ai.provider.gemini.hint': '走 Google 的 OpenAI 兼容层，需要 Google 的 Key',
  'ai.provider.xai': 'xAI Grok',
  'ai.provider.xai.hint': 'xAI 官方接口',
  'ai.provider.groq': 'Groq',
  'ai.provider.groq.hint': '主打推理速度，开源模型跑得飞快',
  'ai.provider.mistral': 'Mistral',
  'ai.provider.mistral.hint': 'Mistral 官方接口',
  'ai.provider.ai302': '302.AI',
  'ai.provider.ai302.hint': '中转聚合站，按量付费，国内可直连',
  'ai.provider.lmstudio': 'LM Studio（本机）',
  'ai.provider.lmstudio.hint': '在你电脑上跑模型：装好 LM Studio、载入模型、开启本地服务即可',
  'ai.provider.ollama': 'Ollama（本地模型）',
  'ai.provider.ollama.hint': '完全离线，数据不出本机',
  'ai.provider.custom': '自定义 / 中转站',
  'ai.provider.custom.hint': '任何兼容 OpenAI 协议的地址都可以填',

  /* ---------------- 型号清单 ---------------- */
  'ai.models.browse': '选型号',
  'ai.models.searchPlaceholder': '搜型号…',
  'ai.models.fetch': '获取模型列表',
  'ai.models.refresh': '重新获取',
  'ai.models.fetching': '正在向厂商获取…',
  'ai.models.notFetched': '还没有取过列表。点右边「获取模型列表」，就能看到这把钥匙可用的全部型号。',
  'ai.models.counted': '厂商返回 {n} 个型号 · 上次获取：{ago}',
  'ai.models.noMatch': '没有匹配「{q}」的型号。直接在上面输入型号 ID 也能用。',
  'ai.models.groupRecent': '最近用过',
  'ai.models.groupFetched': '厂商返回的列表',
  'ai.models.groupBuiltin': '内置候选（可能过时）',
  'ai.models.tagNotChat': '可能不是对话模型',
  'ai.models.footHint':
    '列表里没有的型号也可以直接用：在上面的输入框里手填任意 ID（自建网关、私有部署、刚发布还没列出来的都算）。',
  'ai.models.clearModel': '清空型号',
  'ai.models.agoJustNow': '刚刚',
  'ai.models.agoMinutes': '{n} 分钟前',
  'ai.models.agoHours': '{n} 小时前',
  'ai.models.agoDays': '{n} 天前',

  /* ---------------- 型号可用性探测 ----------------
     清单只说明「账面上有这些型号」，不说明能不能真的跑通。拉完清单会自动逐个探一次，
     结论就是列表里那个小竖条。措辞要紧的是「为什么不能用」——
     余额不足与型号不存在是两件完全不同的事，作者要做的事也不一样。 */
  'ai.probe.ping': 'ping',
  'ai.probe.checking': '正在探测可用性（{done}/{total}）…',
  'ai.probe.summary': '{ok} 可用 · {bad} 有问题',
  'ai.probe.recheck': '重新探测',
  'ai.probe.stop': '停止探测',
  'ai.probe.stopped': '已停止（探了 {done}/{total}）—— 没探到的仍是未知，不代表不可用',
  'ai.probe.gaveUp': '连着几个都连不上这个渠道，先停手了。检查一下地址和网络，再点「重新探测」。',
  'ai.probe.more': '还有 {n} 个没探（一次最多探 {limit} 个），点「重新探测」接着来。',
  'ai.probe.moreAll': '还有 {n} 个没探，点「重新探测」接着来。',
  'ai.probe.limitLabel': '探测上限',
  'ai.probe.limitUnit': '个',
  'ai.probe.limitHint':
    '这个数就是真实发出的请求数。调大对厂商是骚扰、对中转站容易触发限流；没探到的会如实报成「还有 N 个没探」，点「重新探测」接着来。',
  'ai.probe.unlimited': '不限制',
  'ai.probe.limitHintAll':
    '不限制：这一轮会把清单里能当对话用的型号全部探一遍（中途连着几个连不上会自动收手）。',
  'ai.probe.hint': '左边竖条：绿＝能真的回话；橙＝渠道报余额 / 额度不足；红＝这个型号有问题；灰＝还没探。',
  'ai.probe.state.idle': '还没探测',
  'ai.probe.state.ok': '可用 —— 它真的回话了',
  'ai.probe.state.noBalance': '渠道报余额 / 额度不足',
  'ai.probe.state.noAuth': '这把钥匙没通过鉴权',
  'ai.probe.state.noModel': '这个型号不存在或不被支持',
  'ai.probe.state.rateLimited': '被限流了（稍后再试；这不代表它不能用）',
  'ai.probe.state.serverError': '厂商服务端出错',
  'ai.probe.state.noContent': '通了，但返回的不是对话内容',
  'ai.probe.state.unreachable': '连不上这个渠道',
  'ai.probe.state.unknown': '探测没得出结论',

  /* 手写的「额外请求头 / 额外请求体」那两栏，报错时要说清是哪一栏 */
  'ai.extra.kind.headers': '额外请求头',
  'ai.extra.kind.body': '额外请求体',

  /* ---------------- 请求错误 ---------------- */
  'ai.err.noContent': '模型没有返回内容',
  'ai.err.badJson': '无法解析模型返回的 JSON：{raw}',
  'ai.err.shapeMismatch':
    '模型的返回里没有可读的列表（形状对不上），这次结果无法采信 —— 请重试，或换一个更听话的模型。原文开头：{raw}',
  'ai.err.noBaseUrl': '尚未配置 API 地址，请到「设置」里填写',
  'ai.err.noApiKey': '尚未配置 API Key，请到「设置」里填写',
  'ai.err.noModel': '尚未选择模型',
  'ai.err.unknown': '未知错误',
  'ai.err.requestFailed': '请求失败：{message}',
  /* 发起 AI 调用前的配置自检（toast 提示，措辞比上面的错误更口语） */
  'ai.guard.noBaseUrl': '还没有配置 AI 地址，请先到「设置」里填写。',
  'ai.guard.noApiKey': '还没有配置 API Key，请先到「设置」里填写。',
  'ai.guard.noModel': '还没有选择模型，请先到「设置」里填写。',
  'ai.err.networkFile':
    '网络请求失败：{message}。当前页面是用 file:// 直接打开的，浏览器会拦截跨域请求。请改用项目自带的启动方式（双击「启动世界观库.bat」，或运行 node server.mjs）打开。',
  'ai.err.networkGeneric': '网络请求失败：{message}。请检查 API 地址与网络是否可达。',
  'ai.err.networkBoth':
    '网络请求失败：直连与本地转发都没成功（{message}）。请确认本机能访问 {direct}。',
  'ai.err.proxyUnavailable':
    '本地转发不可用（当前页面不是由 WorldForge 的启动器提供的）。请用「启动世界观库.bat」或 node server.mjs 打开后再试。',
  'ai.err.viaProxy': '（经本地转发）',
  'ai.err.modelStatus': '模型返回 {status}{prefix}：{detail}',
  'ai.err.badShape': '模型返回格式异常：{body}',
  'ai.err.noStream': '当前环境不支持流式响应',
  /* 型号清单 */
  'ai.err.modelsEmpty': '厂商返回的列表里一个型号都没有 —— 检查一下这把钥匙是否有可用模型',
  'ai.err.modelsBadShape': '厂商返回的不是 JSON（可能是网关的错误页）：{body}',
  /* 手写的额外配置。这两句必须说清「哪一栏、错在哪」——
     写歪 JSON 的常见原因是少个引号或逗号，不说具体位置作者只能干瞪眼 */
  'ai.err.extraBadJson': '{which}不是合法的 JSON：{detail}',
  'ai.err.extraNotObject':
    '{which}得是一个 JSON 对象 —— 一对花括号里写「"键": 值」，不要写成数组或一句话',

  /* ---------------- 连通性测试 ---------------- */
  'ai.test.system': '你是连通性测试助手。',
  'ai.test.user': '只回复两个字：可用',

  /* ---------------- 送模型的上下文格式 ---------------- */
  'ai.ctx.worldName': '世界名称：{name}',
  'ai.ctx.worldGenre': '类型题材：{genre}',
  'ai.ctx.worldTone': '基调风格：{tone}',
  'ai.ctx.worldSummary': '世界简介：{summary}',
  'ai.ctx.aliasSuffix': '（别名：{aliases}）',
  'ai.ctx.entryLine': '- [{category}] {title}{alias}：{brief}',
  'ai.ctx.emptyIndex': '（暂无已有设定，这是全新的世界）',
  'ai.ctx.uncategorized': '未分类',
  'ai.ctx.expandCategory': '分类：{category}{aliases}',
  'ai.ctx.expandAliases': ' ｜ 别名：{aliases}',
  'ai.ctx.expandSummary': '概述：{summary}',
  'ai.ctx.listSep': '、',

  /* ---------------- 任务执行：由应用生成、会落库或展示的说明文字 ---------------- */
  'ai.task.unnamedEntry': '未命名条目',
  'ai.task.unnamedWorld': '未命名世界',
  'ai.task.defaultRelation': '相关',
  'ai.task.defaultCategory': '设定',
  'ai.task.listSep': '、',
  'ai.task.newEntryRelationRationale': '随新条目一并生成的关联',
  'ai.task.newEntryRelationNote': '（依赖尚未入库的新条目，采纳条目后自动生效）',
  'ai.task.unresolved': '有 {n} 条关联指向未知条目：{list}，已忽略',
  'ai.task.updateTitle': '修订：{title}',
  'ai.task.updateRationale': 'AI 对条目做了扩写与打磨',
  'ai.task.deleteTitle': '删除：{title}',
  'ai.task.deleteRationale': 'AI 判断这条条目冗余或与设定相悖，建议删除',
  'ai.task.polishRationale': '批量打磨：按你选的着力点做了克制修订',
  'ai.task.relationRationale': '打磨正文时顺带补上的关联',
  'ai.task.issueTitle': '设定问题',
  'ai.task.docExtractRationale': '来自资料《{docName}》的抽取（把握度：{confidence}）',
  'ai.task.confidence.high': '高',
  'ai.task.confidence.medium': '中',
  'ai.task.confidence.low': '低',
  'ai.task.unknownError': '未知错误',
  'ai.task.imageUnsupported': '可能不支持读图',
  'ai.task.imageDroppedIntake':
    '当前模型没能读取图片（{reason}），已跳过 {n} 张图片继续。如果图里有关键信息，可以在素材备注里用文字描述一下，或到「设置」换一个支持读图的模型。',
  'ai.task.imageDroppedProposal':
    '当前模型没能读取图片（{reason}），这一版草案只基于文字材料与问答。',
  'ai.task.aiCategory': '由 AI 补充的分类',
  'ai.task.noEntries': 'AI 这次没给出任何条目。可以重试一次，或在旁边补一句你想要的设定方向。',
  'ai.task.reviseNoEntries': '这一版没返回条目，草案保持不变，可以再试一次。',
  'ai.task.relayoutTitle': 'AI 重新排版（{n} 处）',
  'ai.task.relayoutUnmatched': '有 {n} 条没排上：{list}',
  'ai.task.reguessTitle': 'AI 重新猜测时间（{n} 条）',
  'ai.task.reguessUnmatched': '有 {n} 条没猜出来：{list}',
} as const;
