/**
 * agent 的提示词组装。
 *
 * 与其它提示词一样只做「填模板」—— 所有文字都在 i18n 的 `agent.*` 命名空间里，
 * 所以英文界面下发给模型的就是英文提示词。
 *
 * 系统提示词每一轮都重新构建：agent 刚改完库，条目索引和最近操作就变了，
 * 拿旧的上下文继续问它，它会以为自己没做过那件事。
 */
import type { AgentMode, AgentTodoItem, AgentToolCall, Category, Entry, World } from '../../types';
import { existingIndex, worldBrief } from '../context';
import { tGlobal } from '../../i18n/translate';
import { renderToolList } from './tools';
import type { AgentAction } from './protocol';

export interface AgentSystemInput {
  world: World | null;
  entries: Entry[];
  categories: Category[];
  pendingReview: number;
  /**
   * 它自己给自己立的待办清单（这一次交代的账）。
   *
   * 每轮都印回去，理由很实在：「清点式」任务跨十几轮，模型看不见清单时，
   * 它的记忆就只剩「我好像读过几条」——于是它会在半路觉得「差不多了」。
   */
  todos: AgentTodoItem[];
  /** 最近的操作（时间倒序），用来避免重复劳动 */
  recentOps: { action: string; entity: string; target: string; detail: string }[];
  /**
   * 这一段会话里、**这次交代之前**聊过的话（时间正序）。
   *
   * 没有它，每次发问对它来说都是**第一次见面**：作者先说「导师是谁」，再问
   * 「他的真正动机是什么」——第二个「他」它就只能靠猜，因为上一轮不在它的眼里。
   * （真实反馈：「我发现这里的 AI 没有上下文记忆」。）
   *
   * 只带最近的几条、每条截一段：这是「接着聊」用的语境，不是让它背聊天记录。
   * 库的现状（条目索引、最近操作）才是它真正要依据的东西。
   */
  recentTurns: { role: 'user' | 'assistant'; content: string }[];
  mode: AgentMode;
}

const MODE_KEY: Record<AgentMode, string> = {
  plan: 'agent.sys.modePlan',
  auto: 'agent.sys.modeAuto',
  hybrid: 'agent.sys.modeHybrid',
};

export function buildAgentSystemPrompt(input: AgentSystemInput): string {
  const { world, entries, categories, pendingReview, todos, recentOps, recentTurns, mode } = input;

  const parts: string[] = [
    tGlobal('agent.sys.role'),
    [
      tGlobal('agent.sys.boundary'),
      tGlobal('agent.sys.readFirst'),
      tGlobal('agent.sys.byTitle'),
      tGlobal('agent.sys.batch'),
      tGlobal('agent.sys.sweep'),
      tGlobal('agent.sys.complete'),
      tGlobal('agent.sys.todo'),
      // 「答完就走」是被真实反馈骂出来的：作者问一句，它读完条目复述一遍、
      // 再抛两个「待确认」的问题，等于把活又推回给作者。这两条治它：
      // 能接着做的就摆出来（suggest），提到的名字库里没有就主动认领（associate）。
      tGlobal('agent.sys.suggest'),
      tGlobal('agent.sys.associate'),
      // 这两个键写好之后一直躺在语言包里没被接进提示词（孤儿键）。捡回来是因为
      // 它们正好补上另外两个毛病：该来事的时候等着被喂（proactive）、
      // 提问问得太空（askHow）——「你想怎么做？」这种问题等于没问。
      tGlobal('agent.sys.proactive'),
      tGlobal('agent.sys.askHow'),
      tGlobal('agent.sys.polish'),
      tGlobal('agent.sys.timeline'),
      tGlobal('agent.sys.explain'),
      // 这两段一直躺在语言包里却**没被接进提示词**（孤儿键）。捡回来是因为
      // 它们正好治观察到的两个毛病：凭空说「已经在审查队列里了」（reviewGate），
      // 以及查不到就换关键词接着查（noAnswer）。
      tGlobal('agent.sys.reviewGate'),
      tGlobal('agent.sys.noAnswer'),
      tGlobal('agent.sys.unsure'),
      tGlobal('agent.sys.delete'),
      tGlobal('agent.sys.noOps'),
      tGlobal('agent.sys.language'),
      tGlobal('agent.sys.noJsonInSay'),
      tGlobal('agent.sys.done'),
    ].join('\n'),
    tGlobal(MODE_KEY[mode]),
    tGlobal('agent.sys.protocol'),
    `${tGlobal('agent.sys.toolsHeading')}\n${renderToolList()}`,
  ];

  if (world) {
    const index = existingIndex(entries, categories, 90);
    parts.push(`${tGlobal('agent.sys.worldHeading')}\n${worldBrief(world)}`);
    parts.push(
      `${tGlobal('agent.sys.indexHeading')}\n${index || tGlobal('agent.sys.indexEmpty')}`,
    );
  }

  if (pendingReview > 0) {
    parts.push(tGlobal('agent.sys.pendingHeading', { n: pendingReview }));
  }

  // 清单摆在「你自己说过要做的」这一栏里，位置**在最近操作之前**：
  // 它是当前进度的账本，比「你过去干过什么」靠前一步。
  if (todos.length) {
    const open = todos.filter((t) => !t.done).length;
    const lines = todos
      .map((t) => tGlobal(t.done ? 'agent.sys.todoDoneLine' : 'agent.sys.todoOpenLine', { text: t.text }))
      .join('\n');
    parts.push(
      `${tGlobal('agent.sys.todosHeading', { total: todos.length, open })}\n${lines}`,
    );
  }

  if (recentOps.length) {
    const lines = recentOps
      .slice(0, 12)
      .map((o) =>
        tGlobal('agent.sys.opsLine', {
          action: `${tGlobal(`log.action.${o.action}`)}${tGlobal(`log.entity.${o.entity}`)}`,
          target: o.target,
          detail: o.detail ? ` — ${o.detail}` : '',
        }),
      )
      .join('\n');
    parts.push(`${tGlobal('agent.sys.opsHeading')}\n${lines}`);
  }

  // 「之前聊过」摆在最末：它是**对话的延续**，离这一轮作者的话越近越贴身。
  // 跟「最近操作」分工不同 —— 那边讲「你干过什么」（库里的痕迹），
  // 这边讲「你们说过什么」（作者的原话必须原样回来：他要的就是「接着刚才那句」）。
  if (recentTurns.length) {
    const lines = recentTurns
      .map((t) =>
        tGlobal(t.role === 'user' ? 'agent.sys.historyUser' : 'agent.sys.historyAi', {
          text: t.content,
        }),
      )
      .join('\n');
    parts.push(`${tGlobal('agent.sys.historyHeading')}\n${lines}`);
  }

  return parts.join('\n\n');
}

/** 作者这一轮交代的话 */
export function buildGoalMessage(goal: string): string {
  return tGlobal('agent.sys.goal', { goal });
}

export interface StepResult {
  action: AgentAction;
  call: AgentToolCall;
  ok: boolean;
  /**
   * 这一步成功了，但什么都没捞到（零命中）。
   *
   * 必须在回灌里说破：模型看到 `{count: 0}` 时最常见的反应是「换个词再来一次」，
   * 而正确的反应是「这条信息库里没有，去问作者」。所以这里给它一句直白的提示，
   * 免得它自己把「没查到」理解成「我查得不对」。
   */
  empty?: boolean;
  /**
   * 这一步失败的原因是**调用写错了**（缺必填、参数名不认、工具名不存在）。
   *
   * 必须和「零命中」分开说：零命中意味着信息不够、该去问作者；
   * 调用写错意味着这件事根本还没开始，改对参数名就有结果，重试一模一样的东西毫无意义。
   */
  badCall?: boolean;
  /** 回灌给模型的原始数据 —— 只活在内存里，不落库（免得把聊天记录撑爆） */
  data?: unknown;
}

const renderDetail = (call: AgentToolCall, data: unknown, empty?: boolean, badCall?: boolean): string => {
  const head = call.result || '';
  if (data === undefined || data === null) return head;
  let body = '';
  try {
    body = JSON.stringify(data);
  } catch {
    body = '';
  }
  const tail = empty
    ? `\n${tGlobal('agent.sys.resultEmpty')}`
    : badCall
      ? `\n${tGlobal('agent.sys.resultBadCall')}`
      : '';
  return body ? `${head}\n${body}${tail}` : `${head}${tail}`;
};

/** 这一批是直接跑的，还是等作者点了「执行」才跑的，还是被跳过了 */
export type ResultPhase = 'auto' | 'approved' | 'skipped';

/**
 * 把一批动作的结果回灌给模型。
 *
 * `phase === 'skipped'` 表示整批被作者跳过 —— 这时一个动作都没执行，
 * 必须明确告诉它，否则它会以为自己已经改完了。
 *
 * `extra` 是附在末尾的一句补充（比如「你把 3 项没做的从清单上划掉了」）。
 * 单独一个参数而不是又拼进 results，是因为它讲的**不是这批动作**的事，
 * 混进去会让模型以为那是某一步的结果。
 */
export function buildResultMessage(
  results: StepResult[],
  phase: ResultPhase,
  extra?: string,
): string {
  const skipped = phase === 'skipped';
  const lines = results.map((r, i) =>
    tGlobal('agent.sys.resultItem', {
      n: i + 1,
      tool: r.action.tool,
      status: skipped
        ? tGlobal('agent.sys.resultSkipped')
        : r.ok
          ? tGlobal('agent.sys.resultOk')
          : tGlobal('agent.sys.resultFail'),
      detail: skipped ? '' : renderDetail(r.call, r.data, r.empty, r.badCall),
    }),
  );

  const head = phase === 'approved' ? [tGlobal('agent.sys.approved')] : [];
  const tail = skipped ? tGlobal('agent.sys.rejected') : tGlobal('agent.sys.resultContinue');
  return [...head, tGlobal('agent.sys.resultHeading'), ...lines, tail, extra || '']
    .filter(Boolean)
    .join('\n');
}
