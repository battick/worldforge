/**
 * 开发期假上游：模拟一个 OpenAI 兼容的 /v1/chat/completions。
 * 用途：在不消耗真实 API Key 的情况下，端到端验证
 * 「AI 工作台生成 → 结构化解析 → 审查队列」整条链路，以及本机转发是否可用。
 *
 * 用法：node .dev/mock-upstream.mjs 5190
 */
import { createServer } from 'node:http';

const PORT = Number(process.argv[2] || 5190);
/** 加 --cors 时返回 CORS 头，用于验证「浏览器直连」路径；不加则强制走本地转发 */
const WITH_CORS = process.argv.includes('--cors');

const CORS_HEADERS = WITH_CORS
  ? {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    }
  : {};

/**
 * 控制端点（`/__mock-*`）**永远**带 CORS 头，不受 `--cors` 影响。
 *
 * 那些不是被验证的协议面，是脚本用来读统计、切场景的开发管道 —— 而 e2e 是从
 * **页面里**发这些请求的（跨端口就是跨域）。让它们跟着 `--cors` 走，就会得到
 * 「这个脚本只能配那种启动参数跑」这种谁也想不起来的耦合，白排查半天。
 * 真正的协议面（`/v1/chat/completions`、`/v1/models`）仍然按 `--cors` 走，
 * 「不带头时应用会不会退回本机转发」那条路径照样测得到。
 */
const CONTROL_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

/**
 * 护栏插话只在**历史消息**里，界面上根本不渲染 —— e2e 从 DOM 里看不到它们。
 * 但「它说的到底是哪一句」很要紧：是让模型「去问作者」，还是「把参数名改对」。
 * 两句给反了，模型就会去做一件解决不了当前问题的事，而那道护栏看着还挺正常。
 * 所以在这里数一份，e2e 读 /__mock-stats 来断言。
 */
const AGENT_MARKS = {
  /** 普通护栏：查不到就停下来问作者 */
  stuckNudge: '停下来问作者',
  /** 另一条：动作写错了，照参数名重写（不是去问作者） */
  badCallNudge: '不要再原样重试',
  /**
   * 清单上还剩东西、它却想收工 —— 循环追问的那一句。
   *
   * 取的是**只有这一句才有**的措辞：给作者看的收尾（`agent.err.todoLeft`）里
   * 也写着「但清单上还有 N 条没做完」，拿那句当判据会把「它放弃了」误记成「追问过」。
   */
  todoNudge: '这一轮你没有给动作，但清单上还有',
  /** 它说「我接下来还要做…」却没给动作 —— 循环说破的那一句 */
  promiseNudge: '这样它不会发生',
  /** 跨轮记忆那一段的标题（系统提示词里，界面上不显示） */
  historyHeading: '【我们之前聊过】',
};

function countAgentMarks(text) {
  for (const [k, s] of Object.entries(AGENT_MARKS)) {
    if (text.includes(s)) stats.marks[k] = (stats.marks[k] ?? 0) + 1;
  }
}

/**
 * 把「我们之前聊过」那一段抄一份下来。
 *
 * 它跟护栏插话是同一类东西：**只出现在发给模型的那份文本里，界面上一个字都不渲染**。
 * 不看这一眼，「它记不记得上一问」就只能靠感觉评价 —— 而这正是作者提的那条
 * 「这里的 AI 没有上下文记忆」。最近一次请求说算（覆盖式），要的是当下的状态。
 */
function recordHistory(text) {
  const i = text.indexOf(AGENT_MARKS.historyHeading);
  if (i < 0) return;
  const j = text.indexOf('\n\n', i);
  const block = j > i ? text.slice(i, j) : text.slice(i);
  stats.history = {
    chars: block.length,
    sample: block.replace(/\s+/g, ' ').slice(0, 400),
  };
}

/**
 * 每一次 agent 请求**这一轮带没带插话**，以及最后那条用户消息的尾巴。
 *
 * 为什么光有 `marks` 不够：`marks` 只数「见到过」，答不了「第几轮见到的、那时候应用
 * 到底说了什么」。踩过这个坑 —— 有一轮断言红在「循环没插那句承诺提醒」，而 marks 是空的，
 * 于是只能在「它没插」和「它插了别的」之间反复推演，推不出来。
 * 有了这一份，`/__mock-stats` 一眼就能看出是哪种。
 *
 * 只留 40 条：一趟 e2e 最多几百次请求，全存会把 stats 撑成一份日志。
 */
function recordAgentTurn(text, lastUser) {
  stats.agentTurns = stats.agentTurns ?? [];
  if (stats.agentTurns.length >= 40) return;
  stats.agentTurns.push({
    marks: Object.keys(AGENT_MARKS).filter((k) => text.includes(AGENT_MARKS[k])),
    tail: (lastUser || '').replace(/\s+/g, ' ').slice(-70),
  });
}

/* ---------------- 时间轴自动排版 ---------------- */

/**
 * 把排版提示词里「轴上那几条」**读回来**：标题 / 时间 / 纪元 / 位置。
 *
 * 造假数据造得像不难，难的是证实**提示词真的把现状交给了模型** ——
 * 一个看不见当前位置的模型根本排不了版。所以这里不但读，还把条数记进 stats，
 * 让 e2e 能断言「它手里确实有那几条的位置」。
 * 中英两种行格式都认（界面换语言，提示词跟着换）。
 */
function parseAxisLines(text) {
  const re =
    /^- (.+?)[（(][^）)]*[）)]\s*[｜|]\s*(?:时间|when)[：:](.+?)[｜|]\s*(?:纪元|era)[：:](.+?)[｜|]\s*(?:位置|position)[：:]\s*([\d.]+)/gm;
  const out = [];
  for (const m of text.matchAll(re)) {
    out.push({ title: m[1].trim(), when: m[2].trim(), era: m[3].trim(), at: Number(m[4]) });
  }
  return out;
}

/**
 * 头一次排版给出的方案。
 *
 * 位置用 111 / 222 / 333 这种一眼看得出是人给的值：它们跟 e2e 前面用的小整数
 * （10、20、40、7…）必定不同，所以「这是真改动」不靠碰运气。
 * 三条各验一件事：池子里的排进轴（原本没有位置）、分量改档、纪元补上。
 */
const LAYOUT_PLAN = {
  layout: [
    {
      title: '涨潮纪',
      at: 111,
      era: '涨潮纪',
      reason: '以海面第一次上涨为元年 —— 它是这套历法的起点，排在最前。',
    },
    { title: '潮汐槽', at: 222, weight: 'normal', reason: '海面下降才露出浅槽，晚于起潮。' },
    { title: '余烬教团', at: 333, weight: 'major', reason: '教团把持历法发生在历法成形之后。' },
  ],
  note: '按「涨潮纪 → 潮汐槽 → 余烬教团」的先后重排了一遍。',
};

/**
 * 第二次起：把**它刚读到的现状原样回**。
 *
 * 位置一个都没变，于是 `runTimelineLayout` 会算出「零处改动」——
 * 界面该说的是「它认为现在已经对了」，而不是再摆一份一模一样的方案出来。
 * 这条分支顺带证明了一件更要紧的事：**提示词里真的带着每条此刻的位置**。
 */
function layoutEcho(rows) {
  if (!rows.length) return LAYOUT_PLAN;
  return {
    layout: rows.map((r) => ({
      title: r.title,
      at: r.at,
      era: /^[（(](无|none)[）)]$/i.test(r.era) ? '' : r.era,
      reason: '现状就是对的。',
    })),
    note: '重看了一遍，现在的先后不用改。',
  };
}

/**
 * 按提示词里「要求的 JSON 根键」来路由，比关键词匹配可靠得多。
 * 返回 [分支名, 假响应对象]
 *
 * 新建世界那三个任务要放在最前面：它们的提示词里会内嵌整份草案 JSON，
 * 一旦被后面的规则先命中，路由就串了。
 */
function route(bodyText, ctx) {
  const text = bodyText || '';
  const has = (s) => text.includes(s);

  // 工作台 agent 必须排在第一位：它的系统提示词里带着整份条目索引和工具清单，
  // 很容易被下面任何一条关键词规则提前命中。
  if (has('world_overview') && has('"plan"')) {
    countAgentMarks(text);
    recordAgentTurn(text, ctx?.lastUser);
    recordHistory(text);
    return ['agent', agentPayload(text, ctx)];
  }

  if (has('世界观共创顾问')) return ['intake', intakePayload(ctx)];
  /*
   * 时间轴自动排版。判据是**它自己的 JSON 形状**（`"layout"` + `"toAt"`）而不是某句话：
   * `"layout"` 别的提示词里没有，`"toAt"` 更是这一支独有 —— 两样都在，就一定不是别的任务。
   */
  if (has('"layout"') && has('"toAt"')) {
    const rows = parseAxisLines(text);
    stats.layoutParsed = Math.max(stats.layoutParsed ?? 0, rows.length);
    const seen = stats.byBranch['timeline-layout'] ?? 0;
    return ['timeline-layout', seen === 0 ? LAYOUT_PLAN : layoutEcho(rows)];
  }
  if (has('统筹成一份完整、可用、自洽的世界设定草案')) {
    // 作者交代里带了「模拟截断」→ 故意返回写到一半的 JSON，验证前端的截断修复
    if (ctx.told && ctx.told.includes('模拟截断')) return ['proposal-truncated', null];
    return ['proposal', proposalPayload(ctx)];
  }
  if (has('已经看过你写的设定草案')) return ['proposal-revise', revisePayload(ctx)];

  // 「提示泡」类请求要排在 generate 之前：它们同样带着世界基础与已有设定，
  // 但要求的 JSON 根键不是 entries。
  if (has('提问助手') || has('question assistant')) {
    return ['suggest', pick(SUGGEST_BATCHES, stats.byBranch['suggest'] ?? 0)];
  }
  if (has('可以直接点选的答案') || has('candidate answers')) {
    return ['suggest-answers', pick(ANSWER_BATCHES, stats.byBranch['suggest-answers'] ?? 0)];
  }
  if (has('设定官') || has('world keeper')) return ['ask', ASK_ANSWER];

  if (has('consistencyScore')) return ['article-review', ARTICLE];
  // 「答非所问」：模型给了一段能解析、但没有列表的 JSON。真实模型偶尔就这么干，
  // 而界面必须报「没读懂」而不是替它宣布「没有问题」。触发词写在世界里。
  //
  // 但**必须和审计提示词自己的特征一起判**（`"issues"`）：世界名会出现在这个世界的
  // *所有*提示词里，只认世界名的话，同一个世界里随后跑的「生成修订」也会被这条规则截胡 ——
  // 一次修订请求收到一份「issues 列表」，产出的修订内容就等于原文（看起来像「AI 什么都没改」）。
  // 这个坑真踩过一次：审计能过，紧接着的修订全废。
  if (has('畸形返回') && has('"issues"')) return ['consistency-malformed', CONSISTENCY_MALFORMED];

  /**
   * 账本演出。**必须同时看到账本标记才认** —— 假上游默认是「一个不理会账本的模型」，
   * 照着老样子回那几条固定问题。这样既有的那几节不受影响；而这两条分支只认世界名里的触发词，
   * 于是 e2e 能证明的就不只是「界面显示了什么」，而是**账本真的进了提示词**：
   * 少一块【已审账本】，路由就会掉到下面那条老分支，断言全挂。
   */
  if (ledgerMarkOf(text) && has('"issues"')) {
    if (has('账本静默标记')) return ['consistency-ledger-silent', CONSISTENCY_LEDGER_SILENT];
    // 「漏网」那条：把账本里第一条标题**原样抄回来**当重复项 —— 这样 e2e 不必硬编码标题，
    // 验的就是「账本送到位了、里面写的正是那条老账」。
    if (has('账本漏网标记')) {
      const titles = ledgerTitles(text);
      return ['consistency-ledger-leak', ledgerLeakPayload(titles[0])];
    }
  }

  // 一次审计出好几条（含「两条盯同一个条目」与「指向不存在的条目」两种岔路）。
  if (has('多修订标记') && has('"issues"')) return ['consistency-many', CONSISTENCY_MANY];
  if (has('"issues"')) return ['consistency', CONSISTENCY];
  if (has('"confidence"')) return ['doc-extract', DOC_EXTRACT];
  if (has('"from"') && has('"to"')) return ['relations', RELATIONS];
  // 批量打磨要排在 expand 之前：它的返回里同样有 changeNote，规则先撞上 expand 就串了
  if (has('打磨一批已有条目') || has('polishing a **batch**')) {
    return ['polish', polishPayload(text)];
  }
  // 「全部生成修订方案」把同一个条目上的多条问题合并成**一次**请求。
  // 排在 expand 之前，才能把「合并版」和「单条版」分开统计（单条版走下面那条）。
  if (has('请一并修复同一个条目上的下列') || has('consistency issues on the same entry in one pass')) {
    return ['expand-many', expandManyPayload(text)];
  }
  // 单条的一致性修订（同一个入口的另一个分支）：也把收到的问题写回正文 ——
  // 这样脚本能证实「发过去的确实是这一条问题」，而不是笼统地看它有没有回包。
  if (
    has('请修复以下一致性问题并给出修订后的完整正文') ||
    has('Fix the following consistency issue and give the complete revised body')
  ) {
    return ['consistency-fix', consistencyFixPayload(text)];
  }
  if (has('changeNote') || has('"after"')) return ['expand', EXPAND];

  if (has('"entries"')) return ['generate', GENERATE];
  return ['unknown', GENERATE];
}

/* ---------------- 新建世界：读素材 → 提问 ---------------- */

function intakePayload(ctx) {
  const round = ctx.round;
  const imgNote = ctx.images
    ? `\n\n我看到了你给的 ${ctx.images} 张图，里面的**${ctx.imageHint}**我会当作视觉基调的参考。`
    : '';
  const toldNote = ctx.told
    ? `\n\n你单独交代的事（最高优先级）我记下了：会完全按它来，不会拿来跟你讨论。`
    : '';

  // 第二轮起（或已到了轮次上限）就不再追问，直接放行到起草
  if (round >= 2 || ctx.answered) {
    return {
      understanding:
        `# 我读到的世界\n\n这是一个**被水追着走**的世界：海面每年固定上涨，人只能不断往高处搬。` +
        `你给的边界很清楚 —— 水是**不可逆**的，谁也没法让它退回去，所以故事只会往「怎么活下去」这个方向长。\n\n` +
        `- 灯塔是最高的人工造物，因此它天然成为权力与秩序的象征（来自你粘贴的那段）\n` +
        `- 你说的「涨落由物候决定」已经是一条硬规则，不需要再讨论（来自你写的规则）` +
        imgNote +
        toldNote,
      observations: [
        '材料里没说清「如果水一直涨，最终会怎样」——这决定了这个世界是绝望结局还是有出路。',
        '「灯塔守」这个身份在材料里既像职业又像宗教职务，建议在设定里明确一下。',
      ],
      questions: [],
      readyToDraft: true,
    };
  }

  return {
    understanding:
      `# 我读到的世界\n\n一个**海面每年上涨三尺**的世界。所有叙事的前提是水不可逆，` +
      `于是「往高处搬」成了文明的唯一主线：城市在搬家，制度也在搬家。\n\n` +
      `- 灯塔是现存最高的人工建筑，因此它不只是航标，更是权力与信仰的落点（来自你粘贴的那段）\n` +
      `- 你写下的规则「水不可逆、涨落由物候决定」我会当成世界的物理定律（来自你现写的规则）` +
      imgNote +
      toldNote,
    observations: [
      '材料里没有说明「涨水是否会停」，这直接决定故事的结局方向。',
      '你把灯塔写得很有宗教感，但没说这是不是一种宗教 —— 这会影响势力结构。',
    ],
    questions: [
      {
        question: '水最终会停下来，还是永远不会停？',
        why: '这决定了这个世界是「苦撑待变」还是「注定沉没」，两种写法的基调完全不同。',
        suggest: ['会停，但没人知道什么时候', '永远不会停', '偶尔退一点，长期仍在涨'],
      },
      {
        question: '灯塔在政治上是谁的？',
        why: '你已经把灯塔写得很有权威感，但它的归属会直接决定势力版图。',
        suggest: ['一个把持航权与历法的教团', '几座城邦共管，常年为此开战', '无人拥有，谁住进去算谁的'],
      },
    ],
    readyToDraft: false,
  };
}

/* ---------------- 工作台 agent：say + plan ---------------- */

/** 结果回灌的标记句，用来区分「第一轮提问」和「执行完之后的续轮」 */
const AGENT_RESULT_MARK = '【上一批动作的执行结果】';
/** 纠正轮的标记句（对应 i18n 的 agent.sys.repair），中英各一份 */
const REPAIR_MARK = '没有按约定的 JSON 格式来';
const REPAIR_MARK_EN = 'did not follow the agreed JSON format';

/**
 * agent 的假回复。协议是 `{say, plan}`：
 * plan 为空 = 这一轮到此为止（刻意没有 done 字段，少一处能写错的地方）。
 *
 * 场景按「作者这句话里说了什么」来分派，而不是按调用次数 —— 次数依赖执行顺序，
 * 一旦 e2e 里多问一句就会串场。
 */
function agentPayload(allText, ctx) {
  /**
   * 调度只看**最后一条消息**，不看整份 transcript。
   *
   * 教训：结果回灌那句（AGENT_RESULT_MARK）和纠正指令（REPAIR_MARK）都会**留在历史里**，
   * 之后每一次请求都还带着它们。早先拿整份文本做判断，于是「纠正轮」被反复命中，
   * 每一轮都回一个带 plan 的答复 → 计划模式下永远在等拍板 → 输入框一直禁用。
   * 那不是应用的毛病，是这里调度错了。
   */
  const last = ctx?.lastUser ?? '';

  /**
   * 整份历程里的作者原话。
   * 用它而不是 `last`，是因为「打转」那个场景从第二轮起，最后一条消息就已经是
   * 结果回灌了 —— 只看最后一条会认不出这是哪个场景。
   */
  const goalAnywhere = (allText.match(/【作者的话】\n([\s\S]{0,300})/) || [])[1] || '';

  // 场景 6：打转 —— 一直用同一套参数查同一个不存在的东西。
  // 复现真实模型最恼人的那个毛病：查不到就换个说法再查，一轮一轮地试。
  // 执行循环该拦住重复、提醒它去问、最后直接停下。
  if (goalAnywhere.includes('反复查')) {
    return {
      say: '我再确认一次库里有没有「不祥的潮信」。',
      plan: [
        {
          tool: 'search_entries',
          args: { query: '不祥的潮信' },
          why: '再查一遍，说不定刚才漏了',
        },
      ],
    };
  }

  /**
   * 场景 10：模型把参数名写错 —— `entry` 写成 `title`。
   *
   * 真实模型极爱这么干：`read_entry` 的说明只说「参数用标题或别名」，根本没给键名。
   * 而工具内部只读 `args.entry`，读不到就等于没传 → 老实现报「缺少标题」，
   * 这句里又读不出「你的键名它不认识」，模型只能原样重试，攒够几次撞上打转护栏，
   * **整件事中止**（真实翻车：让 agent 补全缺失条目，连着 8 次读条目全废、一条也没补）。
   *
   * 这个场景盯两件事：
   *   ① 别名归一让它**第一次就通**（回执是成功的，不是「缺少标题」）；
   *   ② 读到之后它真的把缺的条目**提议**出来了（进审查队列，不直接落库）。
   */
  if (goalAnywhere.includes('补全缺席')) {
    /**
     * 按「回灌过几轮」决定走到哪一步。
     *
     * 不能只看 `last.includes(AGENT_RESULT_MARK)` —— 那句会**留在历史里**，
     * 之后每一轮都还带着它，于是「提议」那一步会被反复命中，看起来就像应用卡在
     * 「一直重复同一个动作」。（踩过：这里差点变成又一次错误的现场。）
     */
    const rounds = (allText.match(/【上一批动作的执行结果】/g) || []).length;
    if (rounds >= 2) {
      return { say: '补好了，都在审查队列里，你过一眼再定。', plan: [] };
    }
    if (rounds === 1) {
      return {
        say: '读完了。正文里提到的「守灯人阿棠」和「潮线石」库里都还没有，我一次把这两条骨架提上去，你过一眼。',
        plan: [
          {
            tool: 'create_entry',
            args: {
              title: '守灯人阿棠',
              category: '体系',
              summary: '潮汐槽的描线人，名字只出现在别的条目正文里',
              content: '## 内容\n\n正文里提到过，但一直没有单独建条目。',
            },
            why: '这是「提到却还没建」的典型 —— 补上它',
          },
          {
            tool: 'create_entry',
            args: {
              title: '潮线石',
              category: '体系',
              summary: '守塔人用来在潮汐槽上描线的石头',
              content: '## 内容\n\n只在[[守塔人]]的正文里被提过一句。',
            },
            why: '同一批里补第二件器物，验证一次能补一批',
          },
        ],
      };
    }
    return {
      say: '我先把这几条读一遍，看正文里都提到了谁。',
      plan: [
        // 故意用错的键名：它以为参数叫 title。
        // 一轮读两条 —— 「补全」这类活儿就是要把相关条目的正文都读进来，一次一条太慢。
        {
          tool: 'read_entry',
          args: { title: '潮汐槽' },
          why: '核对正文里提到、但还没建条目的人物',
        },
        {
          tool: 'read_entry',
          args: { title: '守塔人' },
          why: '同一批把相关的另一条也读了，别一条一条来',
        },
      ],
    };
  }

  /**
   * 场景 13：清点式补全 —— 一次把作者那趟翻车演全。
   *
   * 那一趟坏在三处，这一支逐个复现，好让 e2e 能钉住「修好了」：
   *   ① 20 条条目只读了 3 条就想收工，末了还说一句「接下来我将继续检查其他条目」；
   *   ② `create_entry` 用了不存在的分类「物品」（它把**内容类型**当成了分类名），
   *      连撞几次之后它自己新建了一个分类；
   *   ③ 分类建好之后**同一个 create_entry 被当成「做过了」拦下**，回执还说「结果一样」——
   *      它于是对作者宣称「这些条目的创建请求已经在审查队列中了」，而队列里一条都没有。
   *
   * 所以这一支盯的是三件事：清单上的账（todos）、**失败过的动作允许重试**、
   * 以及「说了要继续却没给动作」时循环会追问一句。
   *
   * 走法按**它已经说完几轮**（`ctx.turns`）来定，不数结果回灌 —— 第 2 轮那三个
   * 必然失败的 create_entry 会顶出一次护栏插话，数回灌会把轮次对错位。
   */
  if (goalAnywhere.includes('逐个清点')) {
    const turn = ctx?.turns ?? 0;
    const threeReads = [
      { text: '读「涨潮纪」', done: false },
      { text: '读「等重的代价」', done: false },
      { text: '把正文里提到、但没建条目的人名物件提上去', done: false },
    ];
    if (turn === 0) {
      return {
        say: '先数一下这个世界有多少条目要清点，再决定怎么走。',
        plan: [{ tool: 'search_entries', args: {}, why: '列出所有已有条目，看看要清点多少' }],
      };
    }
    if (turn === 1) {
      // 立账 + 一轮读两条（「把全部读一遍」就该成批来，一条一轮会拖十几轮）
      return {
        say: '一共 3 条条目。我先把账立起来，然后一条条读正文 —— 人名和器物通常只写在正文里。',
        todos: threeReads,
        plan: threeReads.slice(0, 2).map((t) => ({
          tool: 'read_entry',
          args: { entry: t.text.replace(/^读「|」$/g, '') },
          why: '读正文，看里面提到了哪些还没建条目的人名物件',
        })),
      };
    }
    if (turn === 2) {
      // 把「内容类型」当分类名用 —— 真实翻车的第一步
      return {
        say: '读完了，正文里提到三样还没建的东西，我这就提上去。',
        plan: ['诅咒之狼', '黑暗巨蛇', '幽魂'].map((title) => ({
          tool: 'create_entry',
          args: {
            title,
            category: '物品',
            summary: '潮水退去后才露出来的暗处生物，对任何外来者充满敌意。',
            content: '## 概览\n\n正文里提到过，但一直没有单独建条目。',
          },
          why: '条目正文里提到、库里却没有的生物，补上它',
        })),
      };
    }
    if (turn === 3) {
      return {
        say: '原来「物品」不是这个世界的分类，我先把分类建出来，再回来提这几条。',
        plan: [
          { tool: 'create_category', args: { name: '物品' }, why: '库里没有「物品」分类，先建出来' },
        ],
      };
    }
    if (turn === 4) {
      /*
       * 关键的一轮：**同样的调用重来一遍**。
       *
       * 三个 create_entry 与第 2 轮参数**一模一样**（它们上次全失败了）；
       * search_entries 与第 0 轮**一模一样**（它上次成功了，但此后库里写过东西 ——
       * 建了分类）。两次重来都必须放行，而且回执里**不许**出现「不重复执行」那种话。
       */
      return {
        say: '分类建好了，我把那三条重新提一遍，顺手再核一次总数。',
        plan: [
          { tool: 'search_entries', args: {}, why: '核一遍总数，确认没漏' },
          ...['诅咒之狼', '黑暗巨蛇', '幽魂'].map((title) => ({
            tool: 'create_entry',
            args: {
              title,
              category: '物品',
              summary: '潮水退去后才露出来的暗处生物，对任何外来者充满敌意。',
              content: '## 概览\n\n正文里提到过，但一直没有单独建条目。',
            },
            why: '上一次因为分类不存在没提上去，现在重提',
          })),
        ],
      };
    }
    if (turn === 5) {
      /*
       * 收尾 —— **复现作者那次真正的收场**：
       * 清单上还有没勾的，它却说「接下来我将继续检查其他条目」，plan 给 []。
       * 循环必须追问，不能让这一轮就这么收掉。
       */
      return {
        say: '接下来，我将继续检查其他条目，看看是否还有需要补全的人物和物品。',
        plan: [],
      };
    }
    // 被追问过之后终于照做：勾完清单、明说 done
    return {
      say: '清点完了：读了 2 条条目，新提了 3 条（都是暗处的生物），别的没有漏的。',
      todos: threeReads.map((t) => ({ ...t, done: true })),
      plan: [],
      done: true,
    };
  }

  /**
   * 场景 14：说了要做、却没给动作（没有清单时的那道兜底）。
   *
   * 清点式场景靠清单兜底；可模型不一定立账 —— 所以「我接下来还要做…」这句话本身
   * 也要能听懂。这一支演两种情况：
   *   - 第一次：说破它（循环插一句「你说要做，但一个动作都没有」）；
   *   - 第二次还是这样：**如实标出来**（那句话没兑现），别让作者一直等下去。
   */
  if (goalAnywhere.includes('说完就停')) {
    const turn = ctx?.turns ?? 0;
    if (turn === 0) {
      return {
        say: '我先看一眼这个世界的条目。',
        plan: [{ tool: 'search_entries', args: {}, why: '先看看有哪些条目' }],
      };
    }
    return {
      say: '接下来，我将继续检查其他条目，看看是否还有需要补全的人物和物品。',
      plan: [],
    };
  }

  /**
   * 场景 15：催两次也不做 —— 循环必须**如实交底**，而不是悄悄收尾。
   *
   * 清单上永远留着两条不勾，每轮都说「接下来我将继续」、plan 给 []。
   * 循环催满两轮之后不该继续干等：它得把「还剩几条」摆到作者面前。
   */
  if (goalAnywhere.includes('清点不完')) {
    const turn = ctx?.turns ?? 0;
    const ledger = [
      { text: '读「涨潮纪」', done: true },
      { text: '读「等重的代价」', done: false },
      { text: '读「守塔人」', done: false },
    ];
    if (turn === 0) {
      return {
        say: '先数一遍条目，再把这次要清的账立起来。',
        todos: ledger,
        plan: [{ tool: 'search_entries', args: {}, why: '先看看一共有多少条' }],
      };
    }
    return {
      say: '接下来，我将继续检查其他条目，看看是否还有需要补全的人物和物品。',
      plan: [],
    };
  }

  /**
   * 场景 16：日常问答 —— 答完要给**下一步**，而且**要记得上一句**。
   *
   * 两条真实反馈凑成了这一支：
   *   「我希望它能够给出建议，亦或者给一些可选的按钮给用户，比如说『构思 xxx 条目』，
   *     点击后自动开始思考和构思」——
   *   作者问「导师研究魔法与科技结合的真正动机是什么」，它读完条目复述一遍、
   *   再抛两个「待确认：…」，接着问什么得作者自己想。
   *   「我发现这里的 AI 没有上下文记忆」——第二问里的那个「他」是凭空的。
   *
   * 这一支演三件事，好让 e2e 逐个钉住：
   *   ① 第一轮**只读条目**，但**也顺手塞了一条建议**（`这条建议不该出现`）——
   *      那一轮还有动作要跑，循环必须把它丢掉：作者连结果都还没看到。
   *   ② 收工轮给出两条真建议，界面上是一排**点一下就发生**的按钮。
   *   ③ 点了之后发起新的一问 —— 那一次的请求里必须**带着第一问的原话**
   *      （`/__mock-stats` 的 `history.sample` 就是给它准备的眼睛）。
   */
  if (goalAnywhere.includes('真正动机')) {
    const rounds = (allText.match(/【上一批动作的执行结果】/g) || []).length;
    if (rounds === 0) {
      return {
        say: '我先在库里查一下「导师」这个条目。',
        // 这一条**不该**出现在界面上：手上还有动作要跑，作者连结果都还没看到
        suggest: ['这条建议不该出现'],
        plan: [
          {
            tool: 'search_entries',
            args: { query: '导师' },
            why: '先确认导师这个条目在不在库里',
          },
        ],
      };
    }
    return {
      say: '导师的动机是**增强帝国的力量** —— 他相信只有帝国强起来，神祇的意志和社会秩序才保得住。这件事一直在神祇的严格监管下进行。\n\n库里目前**还没有**「神祇的监管」这个条目，导师的正文里也没写这段动机。',
      suggest: [
        { label: '构思「神祇的监管」条目', goal: '构思「神祇的监管」条目' },
        { label: '把这段补进「导师」正文', goal: '把导师的动机补进「导师」的正文' },
      ],
      plan: [],
      done: true,
    };
  }

  // 场景 16 的第二步：作者点了那排按钮里的第一颗 —— 新的一问，一轮就收尾
  if (goalAnywhere.includes('构思「神祇的监管」')) {
    return {
      say: '好，「神祇的监管」的骨架我提上去了，在审查队列里等你看。',
      plan: [],
      done: true,
    };
  }

  /**
   * 场景 12：时间（条目上的「什么时候」）。
   *
   * 这一条盯的是「先看再写」和「时间进审查队列」两件事：
   *   ① 第一轮必须调 list_timeline —— 年代是已经定下的历史，不看就写一定会打架；
   *   ② 补的两条走 create_entry（顺手带 when/ongoing/era/weight），进审查队列，
   *      **轴上一点变化都没有**（时间不是另一张表，它就是条目上的一个字段）；
   *   ③ 三种形态里最容易被写歪的两种各来一次：「一段」靠 when+until，
   *      「至今」必须**明说** ongoing —— 不许靠「没给到哪天」去猜；
   *   ④ 位置（at）一个字都不给：模型无从知道轴排到哪儿了，硬猜一个数只会把它扔到十年之外。
   */
  if (goalAnywhere.includes('大事记')) {
    const rounds = (allText.match(/【上一批动作的执行结果】/g) || []).length;
    if (rounds >= 2) {
      return {
        say: '两条都提上去了，在审查队列里等你点头。采纳后它们会落在轴末尾，位置你拖一下就行。',
        plan: [],
      };
    }
    if (rounds === 1) {
      return {
        say: '轴上还空着，那我先把这两段摆上去：一件是真正的转折点，一件是起了头、还没结束的事。',
        plan: [
          {
            tool: 'create_entry',
            args: {
              title: '灯塔第一次点亮',
              category: '体系',
              summary: '守塔人第一次在夜里点灯，此后报时以灯为号。',
              when: '涨潮纪 12 年',
              era: '涨潮纪',
              weight: 'major',
            },
            why: '这是纪年里真正的分界点，配得上 major',
          },
          {
            tool: 'create_entry',
            args: {
              title: '潮线石的规矩',
              category: '体系',
              summary: '沿岸开始用石头记水痕，这条规矩一直用到现在。',
              when: '涨潮纪 41 年',
              ongoing: true,
              era: '涨潮纪',
              weight: 'normal',
            },
            why: '同一批里补一件「起了个头、还没结束」的，验证「至今」说得明明白白',
          },
        ],
      };
    }
    return {
      say: '写年代之前我先看一眼轴上已经有什么，免得写出打架的说法。',
      plan: [{ tool: 'list_timeline', args: {}, why: '先看已经定下的时间' }],
    };
  }

  /**
   * 场景 13：它一口气提两个动作，**每个动作对象少写一个收尾的 `}`**。
   *
   * 形状照抄作者贴过来的那次真实翻车：`args` 关上了、动作自己没关，整份 JSON 因此不合法。
   * 末尾逗号修不掉它、截断补齐也看不见它（少在中间，不在末尾），老实现只能整轮判废 ——
   * 界面上是「它没按约定的格式回，已请它重说一遍」，它照抄同一处错、再废一轮，
   * 作者的原话是「它根本就没补全」。
   *
   * 盯三件事：
   *   ① 解析层按结构把两个动作救回来（回执里看得见两步）；
   *   ② 界面上**如实**说一句「它少写了括号」，不是装作没事、也不是报成废品；
   *   ③ 落库照旧走审查队列 —— 修的是格式，不是替作者放行。
   */
  if (goalAnywhere.includes('少写括号')) {
    const rounds = (allText.match(/【上一批动作的执行结果】/g) || []).length;
    if (rounds >= 1) return { say: '这两条我提上去了，你过一眼再定。', plan: [] };
    // 故意少写每个动作对象的收尾 `}`（就照着真实那次的样子来）
    return (
      '{"say": "正文里提到的这两件都还没有条目，我一次提上去。", "plan": [' +
      '{"tool": "create_entry", "args": {"title": "潮纹灯", "category": "体系", "summary": "守塔人夜里用来照潮线的灯", "content": "## 内容\\n\\n只在[[守塔人]]的正文里被提过一句。"}' +
      ', {"tool": "create_entry", "args": {"title": "潮线尺", "category": "体系", "summary": "沿岸描潮线用的尺", "content": "## 内容\\n\\n同上，正文里提到过，一直没单独建。"}' +
      ']}'
    );
  }

  /**
   * 场景 11：参数名错到别名也救不回来 —— 验证报错「能照着重写」。
   *
   * 这个模型很轴，一直用 `thing` 当键名。重点不在它最后能不能改对，而在：
   *   ① 报错必须说清「缺哪个 / 这个工具认哪些 / 你给的是什么」；
   *   ② 护栏插的应该是「照参数名重写」那条，而**不是**「去问作者」那条 ——
   *      这件事压根还没开始查，问作者解决不了任何问题；
   *   ③ 最后停下来时说的也必须是「它把动作写错了」，不许冒充「没查到」。
   */
  if (goalAnywhere.includes('补全胡写')) {
    return {
      say: '我读一条看看。',
      plan: [
        {
          tool: 'read_entry',
          args: { thing: '潮汐槽' },
          why: '随便写了个键名，用来看报错够不够清楚',
        },
      ],
    };
  }

  // 场景 4：纠正轮 —— 上一轮没按格式回，useAgent 会补一条要求重说的消息（见 agent.sys.repair）。
  // 这一轮必须给合规 JSON，端到端据此断言「纠正轮真的发生了」。
  if (last.includes(REPAIR_MARK) || last.includes(REPAIR_MARK_EN)) {
    return {
      say: '（重说一遍）上一条没按约定格式来。那我先看一眼库里的情况。',
      plan: [
        { tool: 'world_overview', args: {}, why: '光在嘴上说要查不算数，得把动作写进 plan' },
      ],
    };
  }

  // 续轮：上一批动作已经跑完，收尾
  if (last.includes(AGENT_RESULT_MARK)) {
    const rejected = last.includes('作者点了「跳过」');
    return {
      say: rejected
        ? '好，那批我不动了。库里还是原样，你想改的时候再叫我。'
        : '上面这批已经落地了，你可以到操作日志里看到每一步。还要我接着做点什么，直接说。',
      plan: [],
    };
  }

  const goal = goalAnywhere;

  // 场景 5：故意不按格式回（整段散文，没有 JSON）。
  // 真实模型最常见的翻车方式之一，也是「说完就没下文」的典型现场 ——
  // 用来验证 useAgent 会不会补一轮纠正，而不是就此收工。
  if (goal.includes('散着说')) {
    return '我先看看你的库里都有什么，回头再告诉你。';
  }

  // 场景 9：批量打磨 —— 一次把几条丢给 polish_entries。
  // 验证「界面上能做的事 agent 也能做」，而且产出同样是提议（不落库）。
  if (goal.includes('打磨这几条')) {
    return {
      say: '这两条正文偏薄，一次提上去打磨。产出照样先进审查队列，你过一眼再定。',
      plan: [
        {
          tool: 'polish_entries',
          args: {
            entries: ['潮汐槽', '涨潮纪'],
            focus: ['detail'],
            instruction: '术语统一用「涨潮纪」',
          },
          why: '两条都缺细节，而且它们该互相关联',
        },
      ],
    };
  }

  // 场景 7：查不到就该问 —— 一个批次里「查了没结果 + 问作者 + 还打算接着建」。
  // 提问是终结性的：排在它后面的新建不该被执行（那是拿假设当事实）。
  if (goal.includes('拿不准')) {
    return {
      say: '库里没有叫「灰屿」的东西。这种名字我不敢硬编，先问你一句。',
      plan: [
        { tool: 'search_entries', args: { query: '灰屿' }, why: '先确认库里到底有没有' },
        {
          tool: 'ask_author',
          args: {
            question: '「灰屿」在你这里是什么？我好决定怎么记它。',
            options: ['一个被淹掉的旧城', '某个城邦的别名', '只是顺口提的，先别管'],
          },
          why: '查不到就是信息不够 —— 该问，不该猜',
        },
        {
          tool: 'create_entry',
          args: {
            title: '灰屿',
            category: '体系',
            summary: '（这条本来不该被执行）',
            content: '提问之后剩下的动作不该跑。',
          },
          why: '故意排在提问后面，验证它不会被执行',
        },
      ],
    };
  }

  // 场景 8：只想问一句 —— plan 里只有 ask_author。
  // 计划模式**不该**因为它弹计划卡：拦住一个提问，等于要作者先批准它提问。
  if (goal.includes('只问')) {
    return {
      say: '',
      plan: [
        {
          tool: 'ask_author',
          args: {
            question: '要我先从哪一块下手？',
            options: ['先把体系类补齐', '先理关系', '随便看看'],
          },
          why: '没头没尾地动手，不如先问一句',
        },
      ],
    };
  }

  // 场景 2：直接执行模式 —— 提一个条目 + 一条挂在它上面的关系。
  // 新建的条目要过审查，所以连关系也只能一起等：正是「会来事」那条链路。
  if (goal.includes('换算')) {
    return {
      say: '补在「水位线」下面比较合适，我加一条换算规则，顺手接到历法上。',
      plan: [
        {
          tool: 'create_entry',
          args: {
            title: '水位线换算',
            category: '体系',
            summary: '各地水位线之间的折算办法',
            content: '## 办法\n\n一切以灯塔刻线为基准，其余旧标记按差值折算。',
            tags: ['计量'],
          },
          why: '作者要的换算规则，补进体系分类',
        },
        {
          tool: 'create_relation',
          args: { from: '水位线换算', to: '涨潮纪', type: '依据', note: '历法以水位线为准' },
          why: '新条目得挂进图谱，否则它是个孤岛',
        },
      ],
    };
  }

  // 场景 3：不需要动手的一轮 —— plan 给 []，验证「这一轮到此为止」的终结语义：
  // 界面不该冒出计划卡，答案本身就该是最终答复。
  if (goal.includes('多少') || goal.includes('几条')) {
    return {
      say: '我看了一眼：分类只有「体系」一个，条目里有 [[涨潮纪]]、[[等重的代价]]、[[守塔人]]。\n\n要我把缺口补上吗？',
      plan: [],
    };
  }

  // 场景 1：读 + 写混合，用来验证计划卡、工具回执、撤销
  return {
    say: '我先看一眼库里现在有什么，顺手补一条缺的规则，再接上关系。',
    plan: [
      { tool: 'world_overview', args: {}, why: '先确认世界的底子和规模' },
      { tool: 'search_entries', args: { query: '潮' }, why: '核对已有条目，避免造出重复的东西' },
      {
        tool: 'create_entry',
        args: {
          title: '潮汐律',
          category: '体系',
          summary: '海面每年上涨三尺的固定节律',
          content:
            '## 内容\n\n海面每年上涨三尺，涨落由物候决定，不可逆、不可商议。\n\n## 用途\n\n历法与测绘都以它为基准。',
          tags: ['规则', '制度'],
        },
        why: '这是世界最底层的物理规则，库里只有历法、没有规则本身',
      },
      {
        tool: 'create_relation',
        args: { from: '潮汐律', to: '涨潮纪', type: '依据', note: '历法以潮汐律为基准' },
        why: '把新条目挂进现有图谱，否则它会是个孤岛',
      },
      {
        tool: 'note',
        args: { text: '建议再补一条「水位线」的换算规则' },
        why: '留个待办，不急着改',
      },
    ],
  };
}

/* ---------------- 新建世界：统筹成草案 ---------------- */

const PROPOSAL = {
  name: '涨潮纪',
  tagline: '海每年上涨三尺，人把家一层层搬到塔上去',
  genre: '低魔海洋奇幻',
  tone: '克制、沉静，把灾难写成日常。禁止出现「拯救世界」式的情节；水不可逆，任何奇迹都必须付出等重的代价；命名偏海事与旧港口风格。',
  summary:
    '海面每年固定上涨三尺，已经持续了四百年。没有洪水、没有末日，只有持续不断、可被计算的失去：' +
    '港口搬成村落，村落搬成山顶，山顶又成了孤岛。文明的全部精力都花在「把什么带走、把什么留下」上。\n\n' +
    '灯塔是现存最高的人工建筑，也是唯一还在按旧历报时的地方。谁掌握它，谁就掌握「现在几点」。',
  themeColor: '#0e7c8a',
  rules: [
    '海面每年上涨三尺，涨落由物候决定，不可逆、不可商议。',
    '任何试图逆转海水的力量，必须以等重的失去作为代价。',
    '高度决定权力：住得越高的人，越不需要向别人解释自己。',
    '所有测绘与历法都以灯塔为准，除此之外的时间都是「私人的」。',
  ],
  categories: [
    { name: '地理', icon: '🌊', desc: '海域、岛屿、被淹的旧城' },
    { name: '势力', icon: '⚓', desc: '城邦、教团、搬迁队' },
    { name: '人物', icon: '👤', desc: '守塔人、测绘师、搬家人' },
    { name: '体系', icon: '⚙️', desc: '历法、计量、丧葬与财产制度' },
  ],
  entries: [
    {
      title: '涨潮纪',
      category: '体系',
      aliases: ['大水纪'],
      summary: '以海面第一次上涨为元年的历法',
      content:
        '## 元年的确定\n\n涨潮纪的元年不是某位君主的登基，而是旧港街市第一次被淹的那天。\n\n## 为什么还在用\n\n历法本身已经不准了，但没人敢改：改了就等于承认「水会一直涨」。守塔人每年报时，报的是同一个数字。',
      tags: ['历法', '制度'],
    },
    {
      title: '孤灯塔',
      category: '地理',
      aliases: ['塔'],
      summary: '现存最高的人工建筑，旧历的锚点',
      content:
        '## 外观\n\n原本是一座附属于港口的灯塔，如今它的基座沉在水下四十丈，露出水面的部分仍比任何新建物高。\n\n## 使用\n\n每天两次报时。塔身被历次搬迁者加建，像一棵被接了很多次的树。',
      tags: ['地标', '权力'],
    },
    {
      title: '守塔人',
      category: '人物',
      aliases: ['报时的'],
      summary: '负责报时与维护灯塔的人，通常由上一任指定',
      content:
        '## 职责\n\n报时、维修、记录水位线。水位线刻在塔身内侧，只有守塔人能看。\n\n## 处境\n\n他们知道水到底涨了多少，因此在所有城邦里都不受欢迎。',
      tags: ['职业', '见证者'],
    },
    {
      title: '搬迁队',
      category: '势力',
      aliases: ['搬家行'],
      summary: '专门负责把城镇从低处搬到高处的行会',
      content:
        '## 业务\n\n不只搬东西，还负责决定「什么可以被丢下」。这门生意让他们既被需要又被厌恶。\n\n## 规矩\n\n先搬碑，再搬人，最后搬门。这是行会几百年没改过的次序。',
      tags: ['行会', '秩序'],
    },
    {
      title: '等重的代价',
      category: '体系',
      aliases: [],
      summary: '这个世界唯一的超自然法则',
      content:
        '## 内容\n\n凡试图让海水退去者，其失去的分量必须与退回的海水相当。\n\n## 表现\n\n历史上仅有三次记载。三次都成功地退了水，也三次抹掉了施术者的一切痕迹——包括他们存在过的记录。',
      tags: ['规则', '低魔'],
    },
    {
      title: '水位线',
      category: '地理',
      aliases: ['线'],
      summary: '刻在各类建筑上的旧水面标记，成了通用的高度基准',
      content:
        '## 用途\n\n因为海面一直在变，旧的「海拔」彻底失效，人们改用「离某条水位线多高」来描述位置。\n\n## 副作用\n\n每个人衡量「高」的基准都不一样，导致契约纠纷常年不断。',
      tags: ['计量', '日常'],
    },
  ],
  relations: [
    { from: '守塔人', to: '孤灯塔', type: '守护', note: '守塔人的一切职责都围绕塔展开' },
    { from: '涨潮纪', to: '孤灯塔', type: '依据', note: '历法以塔上刻线为基准' },
    { from: '搬迁队', to: '水位线', type: '使用', note: '搬迁评估以水位线为标尺' },
    { from: '等重的代价', to: '涨潮纪', type: '限制', note: '这条法则让历法里几乎没有「奇迹年」' },
  ],
  openQuestions: [
    '我把「等重的代价」设定成有三次历史记载，如果你想让它更神秘，可以改成「只有传说」。',
    '「守塔人」我按职业写的，如果你想要宗教性，可以改成教团的祭司职。',
  ],
  rationale:
    '你给的材料里，水是唯一不可谈判的东西，所以我把它立成了世界的物理定律，而不是情节。' +
    '灯塔在你的原文里出现得很重，我把它抬成了「时间与权力的双重锚点」，这样它能同时挂住体系、地理和人物三类设定。' +
    '剩下没定的地方我替你做主了，都列在 openQuestions 里。',
};

function proposalPayload(ctx) {
  const p = JSON.parse(JSON.stringify(PROPOSAL));
  // 作者交代的话以最高优先级反映进草案
  if (ctx.told) {
    const first = ctx.told.split('\n').find((l) => l.trim()) ?? '';
    p.rules = [...p.rules, `（作者交代，最高优先级）${first.replace(/^\d+\.\s*/, '').slice(0, 60)}`];
  }
  return p;
}

function revisePayload(ctx) {
  const p = JSON.parse(JSON.stringify(PROPOSAL));
  const ask = ctx.instruction || '（未读到意见）';
  p.rationale =
    `按你的意见改了这一版：「${ask.slice(0, 60)}」。改动范围只到相关的设定，其余部分保持原样。`;
  p.rules = [...p.rules, '（按意见新增）海水每年上涨的尺度在各地观测一致，不存在「这里涨得慢」的例外。'];
  p.entries = [
    ...p.entries,
    {
      title: '涨潮税',
      category: '体系',
      aliases: [],
      summary: '按淹没高度向高处居民征收的税',
      content:
        '## 由来\n\n城邦用「你比去年又高了多少」来计税，因为高度本身就是稀缺资源。\n\n## 争议\n\n越早搬上来的人交得越少，后来者要替前人补上差额。',
      tags: ['制度', '矛盾'],
    },
  ];
  p.openQuestions = [];
  return p;
}

const GENERATE = {
  entries: [
    {
      title: '闭城月',
      summary: '灰烬潮汐来袭时城邦全面封闭的三十天',
      content:
        '每年灰烬潮汐将至，城邦会举行闭城仪式：封死外城门、点亮长明烬灯、停止一切对外交易。\n\n## 仪式\n\n由余烬教团主持，先鸣三声烬钟，再以灰浆封门。\n\n## 权力真空\n\n闭城月也是最容易发生权力更替的时刻——外部的灰把所有人关在同一个屋檐下。',
      aliases: ['封城月'],
      tags: ['制度', '历法'],
      fields: { 周期: '每年冬至前后', 时长: '约三十天' },
      relations: [
        { toTitle: '烬落盆地', type: '位于', note: '闭城是盆地城邦的共同时俗' },
        { toTitle: '余烬教团', type: '主导', note: '仪式的解释权归教团' },
      ],
      reason: '补全历法与城邦制度之间的空缺，为后续情节提供时间锚点。',
    },
    {
      title: '长明烬灯',
      summary: '闭城月期间城邦中心不灭的巨型烬石灯',
      content:
        '长明烬灯是闭城月里唯一被允许持续燃烧的灯，由教团指定人员照料。\n\n## 代价\n\n每月耗费的烬石相当于一个中等家族半年的配额。灯若在闭城月内熄灭，被视作不祥，当任城主需在次年让位。',
      aliases: [],
      tags: ['器物', '信仰'],
      relations: [{ toTitle: '闭城月', type: '用于', note: '闭城月的核心象征' }],
      reason: '为仪式补一个可视化的核心物件，方便画面描写。',
    },
  ],
};

const EXPAND = {
  summary: '灰烬潮汐来袭时城邦全面封闭的三十天',
  content: '扩写后的正文内容示例。\n\n## 概览\n\n补充了更多细节。',
  tags: ['制度', '历法', '时令'],
  changeNote: '补充了仪式的具体步骤与违反后果。',
  relations: [],
};

/**
 * 批量打磨的假回包。
 *
 * 刻意**看正文**来决定回什么，而不是看「第几条」—— 这样脚本只要种一条厚条目、
 * 一条薄条目，就能同时验到两条纪律：够好的原样返回（不进队列），薄的真被补上。
 */
function polishPayload(text) {
  const summary = (/现有概述：([^\n]*)/.exec(text) || [])[1]?.trim() ?? '';
  const body = (/现有正文：\n([\s\S]*?)\n\n【/.exec(text) || [])[1] ?? '';

  // 答非所问：能解析、但没有 content/summary。界面必须报「没读懂」，
  // 而不是把「它没说话」当成「它说这条不用改」。
  if (body.includes('畸形打磨')) return POLISH_MALFORMED;

  // 已经够厚：原样返回，changeNote 留空 —— 验证「无需改动就不占审查队列的位置」
  if (body.replace(/\s/g, '').length >= 200) {
    return { summary, content: body, changeNote: '' };
  }

  // 薄的这条：补一节正文，并顺带补一条关联（验证关系提议也一起进队列）
  const head = summary && summary !== '（无）' ? summary : '打磨后补上的一句话概述';
  return {
    summary: head,
    content: `${body.trimEnd()}\n\n## 打磨补充\n\n补上了成因与代价两处细节，方便后续被引用。\n`,
    tags: [],
    aliases: [],
    changeNote: '补上了成因与代价两处细节',
    relations: [{ toTitle: '余烬教团', type: '相关', note: '打磨正文时补上的关联' }],
  };
}

/** 能解析、但没有 content/summary —— 用来验证「读不懂」不会冒充「无需改动」 */
const POLISH_MALFORMED = {
  note: '这条看起来还行，我没什么要说的。',
};

/**
 * 合并修订（一个条目上叠着好几条问题）的假回包。
 *
 * 把请求里收到的每一条问题**原样写回正文**。这样脚本只要看落库的修订内容，
 * 就知道模型到底收到了一条还是三条 ——「合并有没有静默丢掉其中一条」，
 * 这是唯一可靠的证据（光看条数看不出来）。
 */
function expandManyPayload(text) {
  const issues = [...text.matchAll(/【(?:问题|Issue) (\d+)】([^\n]*)/g)].map((m) => m[2].trim());
  return {
    summary: `已按 ${issues.length} 处一致性问题重新校对`,
    content:
      '## 概览\n\n修订后的正文（合并处理）。\n\n' +
      issues.map((x) => `- 已处理：${x}`).join('\n'),
    tags: [],
    aliases: [],
    changeNote: `合并修订了 ${issues.length} 处问题`,
    relations: [],
  };
}

/** 单条一致性修订的假回包：同样把收到的那条问题写回正文，好让脚本对得上号 */
function consistencyFixPayload(text) {
  const issue = (/【问题】([^\n]*)/.exec(text) || [])[1]?.trim() ?? '';
  return {
    summary: `已按一致性问题重新校对${issue ? `：${issue}` : ''}`,
    content: `## 概览\n\n修订后的正文（单条处理）。\n\n- 已处理：${issue}`,
    tags: [],
    aliases: [],
    changeNote: `修订了：${issue}`,
    relations: [],
  };
}

const RELATIONS = {
  relations: [
    { from: '余烬教团', to: '北方灰原', type: '敌对', note: '教团视灰原为不可踏足的禁地' },
    { from: '匠人同盟', to: '烬石', type: '依赖', note: '同盟以烬石锻造为业' },
  ],
};

const CONSISTENCY = {
  issues: [
    {
      title: '烬石储量与城邦规模不匹配',
      severity: 'medium',
      detail: '烬落盆地的人口规模需要远超当前描述的烬石产量才能维持。',
      suggestion: '补充一条地下深层矿脉，或调低盆地人口。',
      entryTitles: ['烬落盆地'],
    },
  ],
};

/**
 * 一次审计出好几条问题 —— 专门用来验「全部生成修订方案」。
 *
 * 五条问题是精心配的，把分组规划的几条岔路全铺到了：
 *   · 前两条盯着**同一个**条目（匠人同盟）→ 该被合并成一条修订，而不是两条互相打架的方案；
 *   · 第三条落在另一个条目（烬石）上 → 单独一条修订；
 *   · 第四条落在**已经被上一步单条修订占住**的条目（烬落盆地）上 → 该被先放过；
 *   · 第五条指向库里**根本没有**的条目 → 生成不了修订，界面要如实报出来而不是闷掉。
 * 于是「准备就绪的组」正好是 2 条 —— 刚好够得着「全部生成」这个入口的门槛。
 */
const CONSISTENCY_MANY = {
  issues: [
    {
      title: '匠人同盟的成立年份与涨潮纪对不上',
      severity: 'high',
      detail: '同盟条目说成立于涨潮纪 12 年，涨潮纪条目说那年还没有行会。',
      suggestion: '把成立年份挪到涨潮纪 30 年之后，或补一条特许状。',
      entryTitles: ['匠人同盟'],
    },
    {
      title: '同盟的成员数两处打架',
      severity: 'medium',
      detail: '同一条条目里，「二百余名匠人」与「不足四十人」先后出现过。',
      suggestion: '取一个说法并说明它算的是正式成员还是学徒。',
      entryTitles: ['匠人同盟'],
    },
    {
      title: '烬石的燃烧温度前后不一',
      severity: 'medium',
      detail: '一处说能熔化青铜，另一处说连陶土都烧不软。',
      suggestion: '统一温度量级，并说明它是否需要鼓风。',
      entryTitles: ['烬石'],
    },
    {
      title: '烬落盆地的人口规模与烬石产量不匹配',
      severity: 'medium',
      detail: '盆地的人口需要远超当前描述的烬石产量才能维持。',
      suggestion: '补充一条地下深层矿脉，或调低盆地人口。',
      entryTitles: ['烬落盆地'],
    },
    {
      title: '提到的「灰烬议会」还没有条目',
      severity: 'low',
      detail: '正文里多次出现这个机构，但库里查不到它。',
      suggestion: '给它建一个条目，或改用已有的机构名。',
      entryTitles: ['灰烬议会'],
    },
  ],
};

/**
 * 账本块的标记（中英各一份）。用它判别「这份审计提示词里带了账本没有」。
 * 改动 promptText 里的 `consistencyLedgerTitle` 就要同步这里，否则演出会静默失灵。
 */
const LEDGER_MARK_ZH = '【已审账本】';
const LEDGER_MARK_EN = '【audit ledger】';
const LEDGER_MARKS = [LEDGER_MARK_ZH, LEDGER_MARK_EN];
function ledgerMarkOf(text) {
  return LEDGER_MARKS.find((m) => text.includes(m)) || '';
}

/** 从【已审账本】块里抄出所有行的标题（去掉行尾的「涉及：…」） */
function ledgerTitles(text) {
  const mark = ledgerMarkOf(text);
  if (!mark) return [];
  return text
    .slice(text.indexOf(mark))
    .split('\n')
    .filter((l) => l.trimStart().startsWith('- '))
    .map((l) => {
      const row = l.trimStart().slice(2).trim();
      const cut = row.search(/（涉及| \(entries:| \(points at/);
      return (cut >= 0 ? row.slice(0, cut) : row).trim();
    })
    .filter(Boolean);
}

/** 账本在那儿、模型却照样把老账又报了一遍（外加一条真新的）—— 入库那道兜底就是为它准备的 */
function ledgerLeakPayload(repeated) {
  return {
    issues: [
      {
        title: repeated || '烬石储量与城邦规模不匹配',
        severity: 'high',
        detail: '（又一次报上来的老账）烬落盆地的人口规模需要远超当前描述的烬石产量。',
        suggestion: '补充一条地下深层矿脉。',
        entryTitles: ['烬落盆地'],
      },
      {
        title: '涨潮纪的纪年起点两处不一',
        severity: 'high',
        detail: '一处说以海面第一次上涨为元年，另一处说从大迁徙那年起算。',
        suggestion: '统一到「第一次上涨为元年」，并说明大迁徙在几年之后。',
        entryTitles: ['涨潮纪'],
      },
    ],
  };
}

/** 账本在、也确实没有新东西 —— 模型照纪律返回空列表（这是**正常结果**，不是失败） */
const CONSISTENCY_LEDGER_SILENT = { issues: [] };

/** 能解析、但没有列表 —— 用来验证「读不懂」不会冒充「没问题」 */
const CONSISTENCY_MALFORMED = {
  note: '设定看起来挺自洽的，我没有发现需要改动的地方。',
  summary: '整体没有明显冲突。',
};

const DOC_EXTRACT = {
  items: [
    {
      title: '灰烬潮汐',
      category: '地理',
      summary: '每年冬季灰云下沉形成的低空尘暴',
      content:
        '灰烬潮汐并非水流，而是灰云在低温下坍缩贴地形成的尘暴。\n\n每年冬至前后持续七到二十天，能见度降到三步以内。',
      tags: ['天候', '灾害'],
      aliases: ['灰潮'],
      confidence: 'high',
    },
  ],
  skipped: '未发现与现有设定冲突的内容',
};

const ARTICLE = {
  verdict: '整体贴合设定，但有一处力量尺度与世界观基调不符。',
  consistencyScore: 82,
  suggestions: [
    {
      severity: 'high',
      quote: '他一挥手，灰云便散开了。',
      issue: '此处接近高魔表现，与本世界「低魔、力量必须付出代价」的纪律冲突。',
      fix: '改为借助烬石装置排开灰云，并交代燃料代价。',
    },
  ],
  newEntityCandidates: [{ title: '闭城月', reason: '文中提到但设定集里没有，建议补一条。' }],
};

/* ---------------- 提示泡：建议提问 / 候选答案 ----------------
 * 按调用次数轮换三批 —— 这样端到端脚本点「换一批」时能观察到内容真的变了，
 * 而不是靠断言「有两个请求发出去了」这种弱证据。
 */

const SUGGEST_BATCHES = [
  {
    questions: [
      '水退下去的那三次，施术者到底失去了什么？',
      '守塔人是怎么被选出来的，能拒绝吗？',
      '搬迁队「先搬碑」里的碑，具体指什么？',
      '如果水一直涨，最后一批人要搬到哪里去？',
    ],
  },
  {
    questions: [
      '灯塔的燃料从哪来，谁负责运？',
      '各城邦用什么结算搬迁费用？',
      '水位线刻在私人房子上时，它归谁？',
      '有没有人拒绝往高处搬？他们后来怎样了？',
    ],
  },
  {
    questions: [
      '「等重的代价」有公开记载吗？谁在隐瞒？',
      '搬迁队说的「私人的时间」是什么意思？',
      '教团和城邦之间，谁说了算？',
      '在搬家途中出生的小孩，算哪里人？',
    ],
  },
];

const ANSWER_BATCHES = [
  {
    suggestions: [
      '会停，但没人知道是什么时候，所有历法都在赌这件事',
      '永远不会停，只是偶尔会慢下来',
      '有人在暗中让它退，代价就是那些人本身',
    ],
  },
  {
    suggestions: [
      '归教团，因为只有它能解释塔上刻线的来历',
      '归城邦共管，但每年为修塔的钱吵一次',
      '谁守着塔就算谁的，只是没人愿意接这个班',
    ],
  },
];

/** 世界问答：不是 JSON，就是一段 markdown 回答 */
const ASK_ANSWER =
  '按你的设定，水是**不可逆**的，所以「让它退」这件事在正史里只发生过三次（见 [[等重的代价]]）。\n\n' +
  '这三次的记载都只留下结果、不留下人：施术者的痕迹被一并抹掉，连名字都没进历法（见 [[涨潮纪]]）。\n\n' +
  '如果你要用这条线，建议先想清楚两件事：谁会去查这三次记录，以及查到之后他会不会成为第四次。';

/** 从批次数组里按序号循环取一份 */
function pick(list, n) {
  return list[n % list.length];
}

/** 供端到端脚本读取的统计（例如：图片是否真的送到了模型、有没有请求落到 unknown 分支） */
const stats = {
  total: 0,
  imagesMax: 0,
  byBranch: {},
  marks: {},
  /** agent 每一轮带了哪句插话（见 recordAgentTurn） */
  agentTurns: [],
  /**
   * 「我们之前聊过」那一段：**最近一次请求**里它有多长、开头长什么样。
   *
   * 为什么要专门记一份：跨轮记忆是一段**只发给模型、界面上一个字都不显示**的文字，
   * e2e 从 DOM 里根本看不到它 —— 而「这一问记不记得上一问」恰恰是作者最直接的体感。
   * 所以在这一层留一双眼睛（见 `recordHistory`）。
   */
  history: null,
  layoutParsed: 0,
  /** `/v1/models` 被拉了几次 —— 用来验「面板打开时不该重复拉」 */
  modelsFetched: 0,
  /** 收到过几次对话请求 —— 「点一下之后等它真的发出去了」靠它，别靠 sleep 猜 */
  chatCount: 0,
  /**
   * 最近一次对话请求：**剥掉 messages 之后的请求体**，外加请求头。
   *
   * 设置页里改的那些开关（token 上限、top_p、response_format、额外请求头/请求体）
   * 存进 localStorage 就算「改成功了」，而请求里到底带没带是另一回事。
   * 界面上看不出来，只有在这一层留一份才验得到。
   */
  lastBody: null,
  lastHeaders: null,
  /** 最近一次请求带了几条消息（只为证明额外请求体没把 messages 顶掉） */
  lastMessageCount: 0,
  /**
   * 型号可用性探测的计数与眼睛。
   *
   * 探测（`ai/probe.ts`）会**一次打几十条**对话请求，所以它**不进** `chatCount`/
   * `byBranch`/`total`/`unknownSamples` —— 进了的话，「哪个功能分支被调用了」
   * 和 `unknown === 0` 这类断言会被几十条探测整个淹掉。
   * `probeModels` 是唯一能证明「它到底探了哪几个型号」的东西（比如「非对话模型被跳过了」
   * 这条规矩，不看这个列表就只能靠推演）。
   */
  probeCount: 0,
  probeModels: [],
  /** 最近一次**探测**的请求体（剥掉 messages）。它固定带 `max_tokens: 1`，会顶掉 `lastBody` */
  probeLastBody: null,
};

/**
 * 每次回包前先等多久（毫秒）。
 *
 * 为什么需要它：假上游回得太快（几乎瞬时），而「AI 干活时切页」这个行为要验证的恰恰是
 * **中途**那一刻 —— 请求还没回来时的界面状态。没有延迟，脚本永远抓不到「正在跑」的窗口，
 * 只能靠碰运气 sleep 一个 magically-right 的时长。
 * `/__mock-delay?ms=900` 设，`?ms=0` 关。
 */
let responseDelayMs = 0;

/**
 * `GET /v1/models` 这一趟返回什么形状。`/__mock-models?mode=x` 设。
 *
 *   ok（默认）—— 一份带向量 / 语音模型的正常清单，用来验「能对话的排前面、其余的标出来」
 *   probe     —— 混进几个「账面有、实际用不了」的型号，专门验可用性探测的四种结论
 *   plain     —— 换成 `{ models: [...] }` 这种键名（各家写法真的不一样）
 *   empty     —— 一个型号都没有
 *   fail      —— 401，验报错文案
 *   html      —— 返回一坨非 JSON（网关的错误页就是这样），验 modelsBadShape
 */
let modelsMode = 'ok';

/**
 * 探测请求怎么回。`/__mock-probe?mode=x` 设。
 *
 *   ok（默认）—— 按型号名分派（见下面的分派表）
 *   down      —— 502 + 网关那句「连不上上游」。就是 Envoy / Istio 在目标不可达时回的那一条，
 *                真实且在应用侧会被判成「连不上渠道」。专门用来验那条护栏：
 *                连着几个都连不上就**别再往下打**了。
 *   kill      —— 直接把连接掐掉（比 down 更狠）。真实场景里也有，但**不适合用来数次数**：
 *                连接被掐会让浏览器重发，加上应用自己的转发兜底，一条探测能打到 2~3 次，
 *                于是「它到底试了几条」这个断言就变成掷骰子了。
 */
let probeMode = 'ok';

/** 假厂商的型号清单。刻意混进两个明显不是对话模型的，好让排序那条断言有个对照 */
const MOCK_MODELS = [
  { id: 'text-embedding-3-small', object: 'model', owned_by: 'mocklab' },
  { id: 'mock-ultra-9', object: 'model', created: 1_760_000_000, owned_by: 'mocklab' },
  { id: 'tts-1', object: 'model', owned_by: 'mocklab' },
  { id: 'mock-mini-3', object: 'model', created: 1_750_000_000, owned_by: 'mocklab' },
  { id: 'mock-ultra-9', object: 'model', owned_by: 'mocklab' },
];

/**
 * 探测专用清单：**账面有、实际用不了**的那种渠道。
 *
 * 这是真实场景的复刻 —— 中转站的 `/models` 把几十个型号都列出来，其中一部分一用就回
 * 402「余额不足」。四个坏型号各对应一种真实失败（余额 / 型号不存在 / 钥匙不对 / 限流），
 * 好让「四种结论的竖条颜色各不相同」这条能被端到端验到。
 */
const PROBE_MODELS = [
  { id: 'mock-ultra-9', object: 'model', created: 1_760_000_000, owned_by: 'mocklab' },
  { id: 'mock-mini-3', object: 'model', created: 1_750_000_000, owned_by: 'mocklab' },
  { id: 'mock-no-balance', object: 'model', created: 1_755_000_000, owned_by: 'mocklab' },
  { id: 'mock-missing-model', object: 'model', created: 1_754_000_000, owned_by: 'mocklab' },
  { id: 'mock-bad-key', object: 'model', created: 1_753_000_000, owned_by: 'mocklab' },
  { id: 'mock-throttled', object: 'model', created: 1_752_000_000, owned_by: 'mocklab' },
  { id: 'mock-empty-content', object: 'model', created: 1_751_000_000, owned_by: 'mocklab' },
  { id: 'tts-1', object: 'model', owned_by: 'mocklab' },
];

function serveModels(req, res) {
  stats.modelsFetched++;
  const send = (code, payload, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type, ...CORS_HEADERS });
    res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
  };
  if (modelsMode === 'fail') {
    return send(401, { error: { message: '{\'type\':\'invalid_request_error\'}' } });
  }
  if (modelsMode === 'html') {
    return send(200, '<html><body>502 Bad Gateway</body></html>', 'text/html; charset=utf-8');
  }
  if (modelsMode === 'empty') return send(200, { object: 'list', data: [] });
  if (modelsMode === 'probe') return send(200, { object: 'list', data: PROBE_MODELS });
  if (modelsMode === 'plain') {
    return send(200, { models: ['mock-mini-3', 'mock-ultra-9'] });
  }
  return send(200, { object: 'list', data: MOCK_MODELS });
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && (req.url || '').startsWith('/__mock-delay')) {
    const m = /[?&]ms=(\d+)/.exec(req.url || '');
    if (m) responseDelayMs = Number(m[1]);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...CONTROL_CORS });
    return res.end(JSON.stringify({ responseDelayMs }));
  }
  if (req.method === 'GET' && (req.url || '').startsWith('/__mock-models')) {
    // 让脚本控制「获取模型列表」这一趟返回什么形状 —— 正常 / 空 / 另一种键名 /
    // 非 JSON 的错误页 / 鉴权失败。这几条各自的界面表现都不一样，得能分别验。
    const m = /[?&]mode=(\w+)/.exec(req.url || '');
    if (m) modelsMode = m[1];
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...CONTROL_CORS });
    return res.end(JSON.stringify({ modelsMode }));
  }
  if (req.method === 'GET' && (req.url || '').startsWith('/__mock-probe')) {
    // 探测怎么回：正常 / 整条渠道断掉（验「探不动就别硬探」那条护栏）
    const m = /[?&]mode=(\w+)/.exec(req.url || '');
    if (m) probeMode = m[1];
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...CONTROL_CORS });
    return res.end(JSON.stringify({ probeMode }));
  }
  if (req.method === 'GET' && (req.url || '').startsWith('/__mock-stats')) {
    // 统计是跨脚本累加的。跑 e2e 前若不归零，上一个脚本的计数会污染下一个脚本的断言
    // （典型：onboarding 断言 unknown === 0，却被 agent 脚本留下的 unknown 绊倒）。
    if ((req.url || '').startsWith('/__mock-stats/reset')) {
      stats.total = 0;
      stats.imagesMax = 0;
      stats.byBranch = {};
      stats.marks = {};
      stats.layoutParsed = 0;
      stats.agentTurns = [];
      stats.history = null;
      stats.modelsFetched = 0;
      stats.chatCount = 0;
      stats.lastBody = null;
      stats.lastHeaders = null;
      stats.lastMessageCount = 0;
      stats.probeCount = 0;
      stats.probeModels = [];
      stats.probeLastBody = null;
      modelsMode = 'ok';
      probeMode = 'ok';
      delete stats.unknownSamples;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...CONTROL_CORS });
      return res.end(JSON.stringify({ ok: true }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...CONTROL_CORS });
    return res.end(JSON.stringify(stats));
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      return res.end();
    }
    if (/\/models/.test(req.url || '')) {
      return serveModels(req, res);
    }
    if (!/chat\/completions/.test(req.url || '')) {
      res.writeHead(404, { 'Content-Type': 'application/json', ...CORS_HEADERS });
      return res.end(JSON.stringify({ error: { message: 'mock: 只支持 /v1/chat/completions 与 /v1/models' } }));
    }

    let parsed = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      /* ignore */
    }
    /**
     * 型号可用性探测 —— 认得出来的话，在这里就分派掉。
     *
     * 形状是固定的：**一条 user 消息、内容是 `ping`、`max_tokens: 1`**（见 `ai/probe.ts`）。
     *
     * 为什么要专门认出来、而不是让它当普通对话请求往下走：
     *   1. 一次探几十条，进了 `byBranch`/`total` 会把「哪个分支被调用过」和
     *      `unknown === 0` 这类断言全部淹掉；
     *   2. 它固定带 `max_tokens: 1`，走到底会顶掉 `lastBody` —— 而 `lastBody` 存在的唯一
     *      理由就是回答「设置页那个开关到底进请求没有」，被顶掉就永远验不出来了。
     *
     * 所以它单独计数、单独留一份最近请求体（`probeCount` / `probeModels` / `probeLastBody`）。
     *
     * 位置很要紧：**必须摆在下面那个「记 lastBody / chatCount」的块之前**。
     * 摆在后面的话（一开始就是这么写的）探测会先被记进 `chatCount`、把 `lastBody` 顶成
     * `{max_tokens:1}`，于是「探测不污染对话计数」这条就成了假的 —— 而它恰恰是这里唯一
     * 值得验的东西。
     */
    const probeMsgs = Array.isArray(parsed.messages) ? parsed.messages : [];
    const probeText = (m) =>
      typeof m?.content === 'string'
        ? m.content
        : Array.isArray(m?.content)
          ? m.content.map((x) => (typeof x === 'string' ? x : (x?.text ?? ''))).join('\n')
          : '';
    if (
      parsed.max_tokens === 1 &&
      probeMsgs.length === 1 &&
      probeMsgs[0]?.role === 'user' &&
      probeText(probeMsgs[0]).trim().toLowerCase() === 'ping'
    ) {
      const model = String(parsed.model ?? '');
      stats.probeCount++;
      if (stats.probeModels.length < 80 && !stats.probeModels.includes(model)) {
        stats.probeModels.push(model);
      }
      const { messages: _omitProbe, ...probeRest } = parsed;
      stats.probeLastBody = probeRest;

      // 延时照样吃：验「探测中按停止」需要一个能抓得住的窗口
      if (responseDelayMs) await new Promise((r) => setTimeout(r, responseDelayMs));

      // 渠道整条断掉：连接直接掐，浏览器那边就是 Failed to fetch
      if (probeMode === 'kill') {
        res.destroy();
        return;
      }
      const answer = (code, payload) => {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS });
        return res.end(JSON.stringify(payload));
      };
      // 网关自己的话：连不上上游。**一样是 2xx 之外的回包**，所以浏览器不会重发，
      // 「试了几条」数得准（见 probeMode 的注释）
      if (probeMode === 'down') {
        return answer(502, {
          error: {
            message:
              'upstream connect error or disconnect/reset before headers. reset reason: connection failure',
          },
        });
      }
      // 按型号名分派四种真实的失败 —— 这是「账面有、实际用不了」的四种典型
      if (/no-balance|empty-account/i.test(model)) {
        return answer(402, {
          error: {
            message: 'Sorry, your account balance is insufficient.',
            type: 'insufficient_quota',
          },
        });
      }
      if (/missing-model|vanished/i.test(model)) {
        return answer(404, {
          error: { message: `The model \`${model}\` does not exist`, type: 'invalid_request_error' },
        });
      }
      if (/bad-key/i.test(model)) {
        return answer(401, {
          error: { message: 'Incorrect API key provided.', type: 'invalid_request_error' },
        });
      }
      if (/throttled/i.test(model)) {
        return answer(429, { error: { message: 'Rate limit reached for requests', type: 'requests' } });
      }
      // 2xx 但一条内容都没有 —— 「通了」和「说得上话」是两件事，
      // 这一条专验「只有真拿到回复才算可用」（它会掉进 chat() 的 badShape）
      if (/empty-content/i.test(model)) {
        return answer(200, { choices: [{ message: { role: 'assistant', content: '' } }] });
      }
      // 探通了 —— 这一版就是「可用」唯一的判据：真的回了内容
      return answer(200, { choices: [{ message: { role: 'assistant', content: 'ok' } }] });
    }


    /**
     * 「最近一次请求长什么样」—— 留一份给 e2e 断言用。
     *
     * 「设置页里改了某个开关，它到底有没有进请求」这件事，界面上是看不见的：
     * 开关存进 localStorage 就算成功，请求里带不带完全是另一回事。所以在这里把
     * **剥掉 messages 之后的请求体**原样存下来，外加请求头 —— 这是唯一能证明
     * 那条链路真的通了的地方。
     *
     * 摆在分支判定**之前**：任何分支（包括下面那个提前返回的连通性测试）都要记上。
     */
    {
      const { messages: _omit, ...rest } = parsed;
      stats.chatCount++;
      stats.lastBody = rest;
      // messages 本身太大（还带图片 base64），但「它还在不在」必须留个凭据 ——
      // 额外请求体是可以顶掉内置字段的，唯独不许把 messages 顶掉，这条得验得到
      stats.lastMessageCount = Array.isArray(parsed.messages) ? parsed.messages.length : 0;
      stats.lastHeaders = Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k, String(v).slice(0, 80)]),
      );
    }

    /** 只把文本部分拼起来做路由，别去扫 base64 图片数据 */
    const msgs = Array.isArray(parsed.messages) ? parsed.messages : [];
    const textOf = (m) =>
      typeof m?.content === 'string'
        ? m.content
        : Array.isArray(m?.content)
          ? m.content.map((p) => (typeof p === 'string' ? p : (p?.text ?? ''))).join('\n')
          : '';
    const allText = msgs.map(textOf).join('\n');
    // agent 的调度只看最后一条用户消息（见 agentPayload 的注释）
    const lastUser = (() => {
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i]?.role === 'user') return textOf(msgs[i]);
      }
      return '';
    })();

    /**
     * 「测试连接」发的是固定一句（见 `ai.test.user`）。给它一句正常的回话 ——
     * 不然它会掉进默认分支，拿回一坨 agent JSON，「连接成功，模型回复：{"entries":…」
     * 看着像是坏了（截图里尤其难看，而且容易让人误判自己的参数有问题）。
     */
    if (lastUser.includes('只回复两个字')) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS });
      return res.end(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: '可用' } }] }),
      );
    }

    const images = msgs.reduce(
      (n, m) =>
        n + (Array.isArray(m?.content) ? m.content.filter((p) => p?.type === 'image_url').length : 0),
      0,
    );
    const roundMatch = allText.match(/当前是第 (\d+) 轮/);
    const instrMatch = allText.match(/【作者的修改意见】\s*([\s\S]{0,300})/);
    const toldMatch = allText.match(
      /【作者单方面交代的话 —— 最高优先级】\n以下是作者亲口说的[^\n]*\n([\s\S]*?)\n这些话必须原样遵守/,
    );

    const ctx = {
      images,
      imageHint: '构图、色彩与服装细节',
      round: roundMatch ? Number(roundMatch[1]) : 1,
      answered: allText.includes('作者对上一轮问题的回答'),
      instruction: instrMatch ? instrMatch[1].trim().split('\n')[0] : '',
      told: toldMatch ? toldMatch[1].trim() : '',
      /** agent 调度用：最后一条用户消息（结果回灌 / 纠正指令都只在这条里判） */
      lastUser,
      /**
       * agent 调度用：**它已经说完几轮了**（assistant 消息条数）。
       *
       * 比「数结果回灌几句」可靠：护栏插话、纠正指令都是 user 消息，不占这个数；
       * 而结果回灌会被「分类报错」那类多失败批次带着一起插话，把轮次对错位。
       * 场景 13/15 就是靠它一步一步走的。
       */
      turns: msgs.filter((m) => m?.role === 'assistant').length,
    };

    const [branch, payload] = route(allText, ctx);
    // 截断模拟：把完整草案 JSON 砍到 60%，模拟被输出长度上限拦腰斩断
    const content =
      branch === 'proposal-truncated'
        ? JSON.stringify(PROPOSAL).slice(0, Math.floor(JSON.stringify(PROPOSAL).length * 0.6))
        : typeof payload === 'string'
          ? payload // 世界问答返回的是 markdown，不是 JSON
          : JSON.stringify(payload);
    const created = Math.floor(Date.now() / 1000);

    stats.total += 1;
    stats.byBranch[branch] = (stats.byBranch[branch] ?? 0) + 1;
    if (images > stats.imagesMax) stats.imagesMax = images;
    // 落到 unknown 说明「提示词里该有的标记」和「路由认的标记」对不上了。
    // 只记条数没法定位是哪条请求，留一份片段，排查时直接看 stats 就知道。
    if (branch === 'unknown') {
      stats.unknownSamples = stats.unknownSamples ?? [];
      if (stats.unknownSamples.length < 3) stats.unknownSamples.push(allText.slice(0, 400));
    }

    /*
     * agent 那几条请求额外带上「第几轮」和「这一轮带着哪句插话」。
     *
     * 这两个数是**从外面唯一能看见应用内部状态的东西**：护栏插话、清单、承诺提醒都只活在
     * 历史消息里，界面上不渲染。少了它们，一个「插话没生效」的红断言只能靠推演 ——
     * 推不出来（踩过：反复推了一刻钟，结论全错）。
     */
    const agentTag =
      branch === 'agent'
        ? ` turns=${ctx.turns} nudge=${Object.keys(AGENT_MARKS).filter((k) => allText.includes(AGENT_MARKS[k])).join('+') || '-'}`
        : '';

    /**
     * 最近一次请求「长什么样」—— 留一份给 e2e 断言用。
     *
     * 「设置页里改了某个开关，它到底有没有进请求」这件事，界面上是看不见的：
     * 开关存进 localStorage 就算成功，请求里带不带完全是另一回事。所以在这里把
     * **剥掉 messages 之后的请求体**原样存下来，外加请求头 —— 这是唯一能证明
     * 那条链路真的通了的地方。
     */
    {
      const { messages: _omit, ...rest } = parsed;
      stats.chatCount++;
      stats.lastBody = rest;
      // messages 本身太大（还带图片 base64），但「它还在不在」必须留个凭据 ——
      // 额外请求体是可以顶掉内置字段的，唯独不许把 messages 顶掉，这条得验得到
      stats.lastMessageCount = Array.isArray(parsed.messages) ? parsed.messages.length : 0;
      stats.lastHeaders = Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k, String(v).slice(0, 80)]),
      );
    }

    console.log(
      `[mock] ${req.method} ${req.url} model=${parsed.model} stream=${!!parsed.stream} auth=${req.headers.authorization ? 'yes' : 'no'} branch=${branch}${agentTag} images=${images} round=${ctx.round} bytes=${content.length}${responseDelayMs ? ` delay=${responseDelayMs}ms` : ''}`,
    );

    // 人为拖一会儿再回包，好让 e2e 稳稳地抓到「它正在跑」的那一刻
    if (responseDelayMs) await new Promise((r) => setTimeout(r, responseDelayMs));

    if (parsed.stream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        ...CORS_HEADERS,
      });
      // 分片推两次，模拟真实流式行为
      const half = Math.floor(content.length / 2);
      const parts = [content.slice(0, half), content.slice(half)];
      let i = 0;
      // 注意：这里不能用 req.on('close') 清理定时器 ——
      // 请求体读完后该事件会立刻触发，会把分片全掐掉。
      const timer = setInterval(() => {
        if (i >= parts.length) {
          clearInterval(timer);
          res.write('data: [DONE]\n\n');
          return res.end();
        }
        res.write(
          `data: ${JSON.stringify({
            id: 'chatcmpl-mock',
            object: 'chat.completion.chunk',
            created,
            model: parsed.model || 'mock-model',
            choices: [{ index: 0, delta: { content: parts[i] }, finish_reason: null }],
          })}\n\n`,
        );
        i++;
      }, 120);
      res.on('finish', () => clearInterval(timer));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS });
    res.end(
      JSON.stringify({
        id: 'chatcmpl-mock',
        object: 'chat.completion',
        created,
        model: parsed.model || 'mock-model',
        choices: [
          { index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
      }),
    );
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `[mock] 假上游已就绪：http://127.0.0.1:${PORT}/v1/chat/completions ｜ 型号清单 http://127.0.0.1:${PORT}/v1/models`,
  );
});
