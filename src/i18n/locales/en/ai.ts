import type zh from '../zh/ai';

/** 与 zh/ai.ts 的 key 一一对应，缺一个都会在这里报类型错误 */
const en: Record<keyof typeof zh, string> = {
  /* Grouped so ~20 providers stay pickable */
  'ai.provider.group.main': 'Everyday',
  'ai.provider.group.aggregator': 'Aggregators & overseas',
  'ai.provider.group.local': 'On this machine',
  'ai.provider.deepseek': 'DeepSeek',
  'ai.provider.deepseek.hint': 'Great value; strong on long Chinese text and worldbuilding',
  'ai.provider.openai': 'OpenAI',
  'ai.provider.openai.hint': 'Strong all-rounder; you need network access to it',
  'ai.provider.moonshot': 'Moonshot (Kimi)',
  'ai.provider.moonshot.hint': 'Long context — good for consistency checks over a whole compendium',
  'ai.provider.zhipu': 'Zhipu GLM',
  'ai.provider.zhipu.hint': 'glm-4-flash has a friendly free tier — good for a first run',
  'ai.provider.dashscope': 'Qwen (Alibaba Cloud)',
  'ai.provider.dashscope.hint': 'Stable direct access in mainland China',
  'ai.provider.siliconflow': 'SiliconFlow',
  'ai.provider.siliconflow.hint': 'Aggregates many open-source models',
  'ai.provider.volcengine': 'Volcengine Ark (Doubao)',
  'ai.provider.volcengine.hint':
    'The model field wants the inference endpoint ID you created in the Ark console (starts with ep-), not the model name itself',
  'ai.provider.hunyuan': 'Tencent Hunyuan',
  'ai.provider.hunyuan.hint': 'Tencent Cloud official endpoint, OpenAI-compatible',
  'ai.provider.qianfan': 'Baidu Qianfan',
  'ai.provider.qianfan.hint': 'Baidu AI Cloud; the v2 endpoint speaks the OpenAI protocol',
  'ai.provider.stepfun': 'StepFun',
  'ai.provider.stepfun.hint': 'StepFun official endpoint',
  'ai.provider.lingyiwanwu': '01.AI (Yi)',
  'ai.provider.lingyiwanwu.hint': '01.AI Yi family',
  'ai.provider.openrouter': 'OpenRouter',
  'ai.provider.openrouter.hint':
    'One key, hundreds of models from every major lab — write model names as vendor/model',
  'ai.provider.gemini': 'Google Gemini',
  'ai.provider.gemini.hint': 'Goes through Google’s OpenAI-compatible layer; needs a Google key',
  'ai.provider.xai': 'xAI Grok',
  'ai.provider.xai.hint': 'xAI official endpoint',
  'ai.provider.groq': 'Groq',
  'ai.provider.groq.hint': 'Built for speed — open models answer remarkably fast',
  'ai.provider.mistral': 'Mistral',
  'ai.provider.mistral.hint': 'Mistral official endpoint',
  'ai.provider.ai302': '302.AI',
  'ai.provider.ai302.hint': 'Pay-as-you-go relay; reachable from mainland China',
  'ai.provider.lmstudio': 'LM Studio (local)',
  'ai.provider.lmstudio.hint':
    'Run models on your own machine: install LM Studio, load a model, start its local server',
  'ai.provider.ollama': 'Ollama (local model)',
  'ai.provider.ollama.hint': 'Fully offline — your data never leaves this machine',
  'ai.provider.custom': 'Custom / relay',
  'ai.provider.custom.hint': 'Any OpenAI-compatible endpoint works',

  'ai.models.browse': 'Browse',
  'ai.models.searchPlaceholder': 'Search models…',
  'ai.models.fetch': 'Fetch model list',
  'ai.models.refresh': 'Fetch again',
  'ai.models.fetching': 'Asking the provider…',
  'ai.models.notFetched':
    'No list fetched yet. Hit “Fetch model list” to see every model this key can reach.',
  'ai.models.counted': 'The provider returned {n} models · last fetched {ago}',
  'ai.models.noMatch': 'Nothing matches “{q}”. You can also just type a model ID above.',
  'ai.models.groupRecent': 'Recently used',
  'ai.models.groupFetched': 'From the provider',
  'ai.models.groupBuiltin': 'Built-in guesses (may be out of date)',
  'ai.models.tagNotChat': 'probably not a chat model',
  'ai.models.footHint':
    'Anything missing from the list still works: type any ID into the field above — self-hosted gateways, private deployments, brand-new models that were not listed yet.',
  'ai.models.clearModel': 'Clear model',
  'ai.models.agoJustNow': 'just now',
  'ai.models.agoMinutes': '{n} min ago',
  'ai.models.agoHours': '{n} h ago',
  'ai.models.agoDays': '{n} d ago',

  /* Model availability probing — see the zh bundle for why the wording is this specific */
  'ai.probe.ping': 'ping',
  'ai.probe.checking': 'Checking availability ({done}/{total})…',
  'ai.probe.summary': '{ok} available · {bad} with problems',
  'ai.probe.recheck': 'Check again',
  'ai.probe.stop': 'Stop checking',
  'ai.probe.stopped': 'Stopped ({done}/{total} checked) — the rest are still unknown, not unusable',
  'ai.probe.gaveUp':
    'Several in a row could not reach this channel, so we stopped. Check the address and network, then hit “Check again”.',
  'ai.probe.more': '{n} not checked yet (at most {limit} per pass) — hit “Check again” to continue.',
  'ai.probe.moreAll': '{n} not checked yet — hit “Check again” to continue.',
  'ai.probe.limitLabel': 'Probe limit',
  'ai.probe.limitUnit': '',
  'ai.probe.limitHint':
    'This number is exactly how many real requests get sent. Raising it hammers the provider and easily trips an aggregator’s rate limit; anything left over is reported honestly as “N not checked yet”, and “Check again” continues from there.',
  'ai.probe.unlimited': 'No limit',
  'ai.probe.limitHintAll':
    'No limit: this pass will probe every chat-capable model in the list (it still stops automatically after several unreachable ones in a row).',
  'ai.probe.hint': 'The strip on the left: green = it really replied; amber = channel says no balance / quota; red = something is wrong with this model; grey = not checked yet.',
  'ai.probe.state.idle': 'Not checked yet',
  'ai.probe.state.ok': 'Available — it really replied',
  'ai.probe.state.noBalance': 'Channel reports insufficient balance or quota',
  'ai.probe.state.noAuth': 'This key failed authentication',
  'ai.probe.state.noModel': 'This model does not exist or is not supported',
  'ai.probe.state.rateLimited': 'Rate limited (try later; this does not mean it is unusable)',
  'ai.probe.state.serverError': 'The provider’s server errored',
  'ai.probe.state.noContent': 'It responded, but not with message content',
  'ai.probe.state.unreachable': 'Cannot reach this channel',
  'ai.probe.state.unknown': 'The check reached no conclusion',

  'ai.extra.kind.headers': 'The extra headers',
  'ai.extra.kind.body': 'The extra request body',

  'ai.err.noContent': 'The model returned nothing',
  'ai.err.badJson': 'Could not parse the JSON returned by the model: {raw}',
  'ai.err.shapeMismatch':
    'The model returned no readable list (unexpected shape), so this result cannot be trusted — please retry or switch to a more obedient model. Raw start: {raw}',
  'ai.err.noBaseUrl': 'No API base URL configured yet — fill it in under Settings',
  'ai.err.noApiKey': 'No API key configured yet — fill it in under Settings',
  'ai.err.noModel': 'No model selected yet',
  'ai.err.unknown': 'Unknown error',
  'ai.err.requestFailed': 'Request failed: {message}',
  'ai.guard.noBaseUrl': 'No AI base URL configured yet — fill it in under Settings.',
  'ai.guard.noApiKey': 'No API key configured yet — fill it in under Settings.',
  'ai.guard.noModel': 'No model selected yet — choose one under Settings.',
  'ai.err.networkFile':
    'Network request failed: {message}. This page was opened directly via file://, so the browser blocks cross-origin requests. Open it the way the project intends instead (double-click “启动世界观库.bat”, or run node server.mjs).',
  'ai.err.networkGeneric':
    'Network request failed: {message}. Check that the API URL is reachable and your network is up.',
  'ai.err.networkBoth':
    'Network request failed: neither the direct call nor the local relay worked ({message}). Make sure this machine can reach {direct}.',
  'ai.err.proxyUnavailable':
    'The local relay is unavailable (this page was not served by the WorldForge launcher). Open it with “启动世界观库.bat” or node server.mjs and try again.',
  'ai.err.viaProxy': ' (via local relay)',
  'ai.err.modelStatus': 'Model returned {status}{prefix}: {detail}',
  'ai.err.badShape': 'The model returned an unexpected shape: {body}',
  'ai.err.noStream': 'Streaming is not supported in this environment',
  'ai.err.modelsEmpty':
    'The provider returned an empty list — check whether this key has any models available',
  'ai.err.modelsBadShape':
    'The provider did not return JSON (probably a gateway error page): {body}',
  'ai.err.extraBadJson': '{which} is not valid JSON: {detail}',
  'ai.err.extraNotObject':
    '{which} must be a JSON object — a pair of curly braces around “"key": value” pairs, not an array or a sentence',

  'ai.test.system': 'You are a connectivity test assistant.',
  'ai.test.user': 'Reply with two words: it works',

  'ai.ctx.worldName': 'World name: {name}',
  'ai.ctx.worldGenre': 'Genre: {genre}',
  'ai.ctx.worldTone': 'Tone: {tone}',
  'ai.ctx.worldSummary': 'World summary: {summary}',
  'ai.ctx.aliasSuffix': '(aliases: {aliases})',
  'ai.ctx.entryLine': '- [{category}] {title}{alias}: {brief}',
  'ai.ctx.emptyIndex': '(no existing canon yet — this is a brand-new world)',
  'ai.ctx.uncategorized': 'Uncategorized',
  'ai.ctx.expandCategory': 'Category: {category}{aliases}',
  'ai.ctx.expandAliases': ' | aliases: {aliases}',
  'ai.ctx.expandSummary': 'Summary: {summary}',
  'ai.ctx.listSep': ', ',

  'ai.task.unnamedEntry': 'Untitled entry',
  'ai.task.unnamedWorld': 'Untitled world',
  'ai.task.defaultRelation': 'related to',
  'ai.task.defaultCategory': 'General',
  'ai.task.listSep': ', ',
  'ai.task.newEntryRelationRationale': 'Relation generated alongside the new entry',
  'ai.task.newEntryRelationNote':
    '(depends on an entry not in the library yet — takes effect once the entry is accepted)',
  'ai.task.unresolved': '{n} relations point to unknown entries ({list}) and were skipped',
  'ai.task.updateTitle': 'Revision: {title}',
  'ai.task.updateRationale': 'The AI expanded and polished this entry',
  'ai.task.deleteTitle': 'Delete: {title}',
  'ai.task.deleteRationale':
    'The AI judged this entry redundant or inconsistent with the canon and suggests deleting it',
  'ai.task.polishRationale': 'Batch polish: a restrained pass along the focus you picked',
  'ai.task.relationRationale': 'A connection found while polishing the body',
  'ai.task.issueTitle': 'Canon issue',
  'ai.task.docExtractRationale': 'Extracted from “{docName}” (confidence: {confidence})',
  'ai.task.confidence.high': 'high',
  'ai.task.confidence.medium': 'medium',
  'ai.task.confidence.low': 'low',
  'ai.task.unknownError': 'unknown error',
  'ai.task.imageUnsupported': 'may not support image input',
  'ai.task.imageDroppedIntake':
    'The current model could not read the images ({reason}), so {n} images were skipped and the run continued. If those images hold key information, describe them in the material note, or switch to a vision-capable model in Settings.',
  'ai.task.imageDroppedProposal':
    'The current model could not read the images ({reason}); this draft is based on the text materials and Q&A only.',
  'ai.task.aiCategory': 'Category added by the AI',
  'ai.task.noEntries':
    'The AI returned no entries this time. Retry, or add a line about the direction you want.',
  'ai.task.reviseNoEntries':
    'This revision returned no entries, so the draft is unchanged. Try again.',
  'ai.task.relayoutTitle': 'AI re-layout ({n} moves)',
  'ai.task.relayoutUnmatched': '{n} could not be placed: {list}',
  'ai.task.reguessTitle': 'AI re-guessed times ({n} entries)',
  'ai.task.reguessUnmatched': '{n} could not be guessed: {list}',
};

export default en;
