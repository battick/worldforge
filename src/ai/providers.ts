import type { AISettings } from '../types';
import type { MsgKey } from '../i18n/translate';
import { PROBE_LIMIT } from './probe';

/**
 * 下拉里的分组。二十来个服务商挤成一坨是没法挑的，按「你会怎么用它」切三段：
 * 常用（国内直接可用）/ 聚合与海外（一把钥匙开一屋子模型）/ 本机（不出网）。
 */
export type ProviderGroup = 'main' | 'aggregator' | 'local';

export interface ProviderPreset {
  id: string;
  /** 显示名的文案 key（界面用 t(preset.nameKey) 取当前语言的名字） */
  nameKey: MsgKey;
  group: ProviderGroup;
  baseUrl: string;
  /**
   * **内置兜底**型号，不是全部型号。
   *
   * 型号这东西换得比代码快 —— 写死在仓库里必然过时（上一版这里只有三个
   * OpenAI 型号和一个永远列不全的 DeepSeek 清单，作者看到的就是「怎么只有这么几个」）。
   * 所以它只负责一件事：**还没从厂商拉到列表时，先给你几个能直接用的名字**。
   * 真正的清单靠设置页那颗「获取模型列表」（`GET {baseUrl}/models`），
   * 而且手填任意型号一直是允许的（自建网关、私有部署、厂商还没列出来的新模型）。
   */
  fallbackModels: string[];
  /** 一句话说明的文案 key */
  hintKey: MsgKey;
}

/**
 * 全部走 OpenAI 兼容协议（/chat/completions），所以只要厂商兼容就能接。
 * 这里只描述「有哪些服务商」，所有给人看的文字都放在 i18n 的 ai.provider.* 下。
 *
 * 只列**见过出处**的地址：聚合站和各家官方文档说法不一致的（例如 MiniMax 有
 * .chat / .io / .minimaxi 三个版本在传），宁可不写 —— 填错地址的挫败感比没这个选项大得多，
 * 何况「自定义」一直摆在那儿。
 */
export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'deepseek',
    nameKey: 'ai.provider.deepseek',
    group: 'main',
    baseUrl: 'https://api.deepseek.com/v1',
    fallbackModels: ['deepseek-chat', 'deepseek-reasoner'],
    hintKey: 'ai.provider.deepseek.hint',
  },
  {
    id: 'dashscope',
    nameKey: 'ai.provider.dashscope',
    group: 'main',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    fallbackModels: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-long'],
    hintKey: 'ai.provider.dashscope.hint',
  },
  {
    id: 'zhipu',
    nameKey: 'ai.provider.zhipu',
    group: 'main',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    fallbackModels: ['glm-4-flash', 'glm-4-plus', 'glm-4-air', 'glm-4-long'],
    hintKey: 'ai.provider.zhipu.hint',
  },
  {
    id: 'moonshot',
    nameKey: 'ai.provider.moonshot',
    group: 'main',
    baseUrl: 'https://api.moonshot.cn/v1',
    fallbackModels: [
      'moonshot-v1-8k',
      'moonshot-v1-32k',
      'moonshot-v1-128k',
      'kimi-latest',
      'kimi-k2-0711-preview',
    ],
    hintKey: 'ai.provider.moonshot.hint',
  },
  {
    id: 'volcengine',
    nameKey: 'ai.provider.volcengine',
    group: 'main',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    fallbackModels: [],
    hintKey: 'ai.provider.volcengine.hint',
  },
  {
    id: 'hunyuan',
    nameKey: 'ai.provider.hunyuan',
    group: 'main',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    fallbackModels: ['hunyuan-turbos-latest', 'hunyuan-large', 'hunyuan-standard'],
    hintKey: 'ai.provider.hunyuan.hint',
  },
  {
    id: 'qianfan',
    nameKey: 'ai.provider.qianfan',
    group: 'main',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    fallbackModels: [],
    hintKey: 'ai.provider.qianfan.hint',
  },
  {
    id: 'stepfun',
    nameKey: 'ai.provider.stepfun',
    group: 'main',
    baseUrl: 'https://api.stepfun.com/v1',
    fallbackModels: [],
    hintKey: 'ai.provider.stepfun.hint',
  },
  {
    id: 'lingyiwanwu',
    nameKey: 'ai.provider.lingyiwanwu',
    group: 'main',
    baseUrl: 'https://api.lingyiwanwu.com/v1',
    fallbackModels: ['yi-lightning', 'yi-large'],
    hintKey: 'ai.provider.lingyiwanwu.hint',
  },
  {
    id: 'openai',
    nameKey: 'ai.provider.openai',
    group: 'aggregator',
    baseUrl: 'https://api.openai.com/v1',
    fallbackModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
    hintKey: 'ai.provider.openai.hint',
  },
  {
    id: 'openrouter',
    nameKey: 'ai.provider.openrouter',
    group: 'aggregator',
    baseUrl: 'https://openrouter.ai/api/v1',
    fallbackModels: [],
    hintKey: 'ai.provider.openrouter.hint',
  },
  {
    id: 'siliconflow',
    nameKey: 'ai.provider.siliconflow',
    group: 'aggregator',
    baseUrl: 'https://api.siliconflow.cn/v1',
    fallbackModels: ['Qwen/Qwen2.5-72B-Instruct', 'deepseek-ai/DeepSeek-V3'],
    hintKey: 'ai.provider.siliconflow.hint',
  },
  {
    id: 'gemini',
    nameKey: 'ai.provider.gemini',
    group: 'aggregator',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    fallbackModels: [],
    hintKey: 'ai.provider.gemini.hint',
  },
  {
    id: 'xai',
    nameKey: 'ai.provider.xai',
    group: 'aggregator',
    baseUrl: 'https://api.x.ai/v1',
    fallbackModels: [],
    hintKey: 'ai.provider.xai.hint',
  },
  {
    id: 'groq',
    nameKey: 'ai.provider.groq',
    group: 'aggregator',
    baseUrl: 'https://api.groq.com/openai/v1',
    fallbackModels: [],
    hintKey: 'ai.provider.groq.hint',
  },
  {
    id: 'mistral',
    nameKey: 'ai.provider.mistral',
    group: 'aggregator',
    baseUrl: 'https://api.mistral.ai/v1',
    fallbackModels: [],
    hintKey: 'ai.provider.mistral.hint',
  },
  {
    id: 'ai302',
    nameKey: 'ai.provider.ai302',
    group: 'aggregator',
    baseUrl: 'https://api.302.ai/v1',
    fallbackModels: [],
    hintKey: 'ai.provider.ai302.hint',
  },
  {
    id: 'ollama',
    nameKey: 'ai.provider.ollama',
    group: 'local',
    baseUrl: 'http://localhost:11434/v1',
    fallbackModels: ['qwen2.5:14b', 'llama3.1:8b'],
    hintKey: 'ai.provider.ollama.hint',
  },
  {
    id: 'lmstudio',
    nameKey: 'ai.provider.lmstudio',
    group: 'local',
    baseUrl: 'http://127.0.0.1:1234/v1',
    fallbackModels: [],
    hintKey: 'ai.provider.lmstudio.hint',
  },
  {
    id: 'custom',
    nameKey: 'ai.provider.custom',
    group: 'local',
    baseUrl: '',
    fallbackModels: [],
    hintKey: 'ai.provider.custom.hint',
  },
];

/** 分组的显示顺序 */
export const PROVIDER_GROUPS: ProviderGroup[] = ['main', 'aggregator', 'local'];

export const DEFAULT_AI_SETTINGS: AISettings = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  temperature: 0.8,
  contextLimit: 60,
  vision: true,
  modelByProvider: {},
  baseUrlByProvider: {},
  recentModels: [],
  probeLimit: PROBE_LIMIT,
  probeUnlimited: false,
  maxTokens: 0,
  topP: 1,
  stream: true,
  jsonMode: 'auto',
  extraHeaders: '',
  extraBody: '',
};

export function presetOf(id: string): ProviderPreset | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** 最近用过的型号最多记几个 —— 再多面板顶上那一组就比主清单还长了 */
export const MAX_RECENT_MODELS = 8;

/** 把一个型号记进「最近用过」，去重、最新在前、超长截断。纯函数，便于单测。 */
export function rememberModel(list: string[] | undefined, model: string): string[] {
  const v = model.trim();
  if (!v) return list ?? [];
  return [v, ...(list ?? []).filter((m) => m !== v)].slice(0, MAX_RECENT_MODELS);
}

/**
 * 切服务商时该往设置里写什么。
 *
 * 三件事，每一件都是被真事逼出来的：
 *
 *   1. **先把当前这家的型号记到它名下**（`modelByProvider`）。原先的实现是直接
 *      `model: 新家.fallbackModels[0]`，于是「换一家试试看」再切回来，自己挑的型号
 *      已经没了 —— 而「来回来去换模型试」恰恰是最常做的动作。
 *   2. **地址只在新家有自带地址时才换**。「自定义」那一项的 `baseUrl` 是空的，
 *      照着写就会把作者填好的自建网关地址抹掉，这是最气人的一种「帮忙」。
 *      而**改过官方地址的预设**（指向中转站的常见做法）也一起记下来，否则切走再切回
 *      会静默还原成官方地址 —— 对够不到官方域名的人，那等于把配置弄坏了。
 *      只记「和官方不一样」的，所以没动过地址的人不会多出一堆垃圾记录。
 *   3. **新家既没记住过、也没有内置兜底时，把型号清空**。留着上一家的型号，
 *      请求就会拿着 `deepseek-chat` 去问 OpenRouter —— 报「模型不存在」比
 *      「请先填型号」难懂得多。
 */
export function switchProvider(ai: AISettings, id: string): Partial<AISettings> {
  const p = presetOf(id);
  if (!p || id === ai.provider) return {};

  const modelOf = { ...(ai.modelByProvider ?? {}) };
  const urlOf = { ...(ai.baseUrlByProvider ?? {}) };

  // 离开这一家之前，把它名下的两样东西记下来
  const cur = presetOf(ai.provider);
  const curModel = ai.model.trim();
  const curUrl = ai.baseUrl.trim();
  if (ai.provider && curModel) modelOf[ai.provider] = curModel;
  if (ai.provider && curUrl) {
    // 又填回官方地址了就取消这条「改过」的记录，免得它一直挂在那儿
    if (cur?.baseUrl && curUrl === cur.baseUrl) delete urlOf[ai.provider];
    else urlOf[ai.provider] = curUrl;
  }

  const remembered = (modelOf[id] ?? '').trim();
  const model = remembered || p.fallbackModels[0] || '';
  const baseUrl = (urlOf[id] ?? '').trim() || p.baseUrl;

  const patch: Partial<AISettings> = { provider: id, modelByProvider: modelOf, baseUrlByProvider: urlOf, model };
  if (baseUrl) patch.baseUrl = baseUrl;
  if (model) patch.recentModels = rememberModel(ai.recentModels, model);
  return patch;
}

/** 这一家的地址是不是被作者改过（和官方的不一样）。界面据此决定要不要摆「恢复官方地址」 */
export function urlOverridden(ai: AISettings): boolean {
  const p = presetOf(ai.provider);
  if (!p?.baseUrl) return false;
  return ai.baseUrl.trim() !== p.baseUrl;
}
