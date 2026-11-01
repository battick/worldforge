import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useToast } from '../components/Toast';
import { Empty } from '../components/Modal';
import { MarkdownView } from '../components/MarkdownView';
import {
  IcCheck,
  IcEdit,
  IcPlus,
  IcRefresh,
  IcSparkles,
  IcStop,
  IcTrash,
  IcWarn,
} from '../components/icons';
import { useAITask } from '../state/aiTasks';
import { useAgentRunner } from '../state/agentRunner';
import { runGenerate, runSuggest } from '../ai/tasks';
import { resolveAgentPage, toolLabel, type AgentPageView } from '../ai/agent/tools';
import { useT, type MsgKey } from '../i18n';
import { formatRelative } from '../lib/id';
import { autoLinkEntries } from '../lib/autoLink';
import type { AgentMode, AgentToolCall, Entry, ReviewItem } from '../types';

interface Props {
  /** 第二参是给「时间与关系」用的：agent 要那一支的**编年**视图时落到 graph + 'chronicle' */
  onNavigate: (route: string, view?: AgentPageView) => void;
  onOpenEntry: (id: string) => void;
}

const MODES: AgentMode[] = ['plan', 'hybrid', 'auto'];

/**
 * 一批生成结果 + 作者勾了哪几条。
 *
 * 两者必须**一起**活过页面卸载：结果存进了全局任务槽而勾选留在页面里的话，
 * 切页回来会看到「结果都在、勾全没了」—— 作者得重新点一遍全选，
 * 而且很容易直接点发送，把一大批自己没看过的候选送进审查。
 */
interface GenerateBatch {
  items: ReviewItem[];
  picked: string[];
}

/** 没配 AI、或库里还空着时的兜底示例 —— 正文在语言包里 */
const PRESET_KEYS: MsgKey[] = [
  'studio.preset.1',
  'studio.preset.2',
  'studio.preset.3',
  'studio.preset.4',
  'studio.preset.5',
];

const STEP_STATUS_KEY: Record<AgentToolCall['status'], string> = {
  pending: 'studio.agent.step.pending',
  done: 'studio.agent.step.done',
  failed: 'studio.agent.step.failed',
  skipped: 'studio.agent.step.skipped',
};

const STATUS_GLYPH: Record<AgentToolCall['status'], string> = {
  pending: '·',
  done: '✓',
  failed: '!',
  skipped: '–',
};

/** AI 设置填全了没有（与 useAITask 同判据，但这里失败要静默，不能弹错） */
function aiReady(ai: { baseUrl: string; apiKey: string; model: string }): boolean {
  return !!ai.baseUrl && !!ai.model && (!!ai.apiKey || /localhost|127\.0\.0\.1/.test(ai.baseUrl));
}

/**
 * AI 工作台。
 *
 * 这里的主角是一个能真正动手的 agent：它读得懂知识库，也改得动它。
 * 放手到什么程度由「放手程度」三档决定 —— 计划模式（先看计划）、
 * 混合（查直接做、改要先问）、直接执行。
 *
 * 页面下半部分保留原来的手动工具（批量生成候选等）：
 * 想让 agent 自己决定就用上面，想自己一步步来就用下面。两者共用同一个审查队列。
 */
export function StudioPage({ onNavigate, onOpenEntry }: Props) {
  const store = useStore();
  const toast = useToast();
  const t = useT();
  // 手动工具区（批量生成候选）—— 状态在全局任务表里，切页回来结果还在
  const ai = useAITask<GenerateBatch>('studio.generate', 'studio');

  const world = store.activeWorld;
  const { threads, createThread, deleteThread, entries, categories, pieces } = store;

  const [threadId, setThreadId] = useState<string | null>(null);
  const creatingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 输入框的草稿提在这里：提示泡只负责「填进来」，发不发由作者按发送决定
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /* ---------------- 会话选择 ---------------- */

  useEffect(() => {
    if (!world) return;
    if (threads.length) {
      if (!threadId || !threads.some((th) => th.id === threadId)) setThreadId(threads[0].id);
      return;
    }
    if (creatingRef.current) return;
    creatingRef.current = true;
    createThread()
      .then((th) => setThreadId(th.id))
      .finally(() => {
        creatingRef.current = false;
      });
  }, [world, threads, threadId, createThread]);

  const thread = useMemo(
    () => threads.find((th) => th.id === threadId) ?? threads[0] ?? null,
    [threads, threadId],
  );
  const turns = thread?.turns ?? [];

  // 运行器是常驻的，页面只负责声明「我在看哪一段会话」
  const agent = useAgentRunner();
  const { attach } = agent;

  useEffect(() => {
    attach(thread?.id ?? null);
  }, [attach, thread?.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns.length, agent.stream, agent.pending]);

  /* ---------------- 它给的「下一步」 ---------------- */

  /**
   * 最后一条 AI 轮里、它自己给的下一步建议。
   *
   * 只从**最后一条** AI 轮里取：那一排按钮要贴在「刚说完的这句话」下面才有意义。
   * 翻上去点三步之前的建议，它早就不在当前这个话题里了。
   *
   * 定义在这儿（而不是渲染处）是因为下面那个「自动出题」的 effect 也要用它：
   * 模型自己给了建议的那一轮，不必再花一次请求去替它出题。
   */
  const lastAgentTurn = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].role === 'assistant') return turns[i];
    }
    return null;
  }, [turns]);
  const agentNext = lastAgentTurn?.suggest ?? [];

  /* ---------------- 建议问题 ---------------- */

  const fallback = useMemo(() => PRESET_KEYS.map((k) => t(k)), [t]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const askedRef = useRef('');

  const cfg = store.settings.ai;

  const refreshSuggestions = useCallback(
    async (history: { role: 'user' | 'assistant'; content: string }[]) => {
      if (!world) return;
      const nothingToChewOn = !entries.length && !pieces.length && !world.summary.trim();
      if (!aiReady(cfg) || nothingToChewOn) {
        setSuggestions(fallback);
        return;
      }
      setSuggestBusy(true);
      try {
        const list = await runSuggest(cfg, world, entries, categories, history);
        setSuggestions(list.length ? list : fallback);
      } catch {
        // 出题失败不值得打断作者：留着上一批，没有就退回内置示例
        setSuggestions((prev) => (prev.length ? prev : fallback));
      } finally {
        setSuggestBusy(false);
      }
    },
    [world, cfg, entries, categories, pieces, fallback],
  );

  // 每换一段会话、或这段会话又多了一轮，就照知识库重新出一批。
  //
  // 但**它自己给了建议的那一轮不用出**：模型刚读过那几条条目、比这个出题器更懂
  // 「现在接着做什么」，再花一次请求去造一批只会跟它打架（而且底部那一行也要让位）。
  const suggestKey = `${thread?.id ?? ''}:${turns.length}`;
  useEffect(() => {
    if (!thread || askedRef.current === suggestKey) return;
    askedRef.current = suggestKey;
    if (agentNext.length) {
      setSuggestions([]);
      return;
    }
    void refreshSuggestions(
      turns.slice(-6).map((x) => ({ role: x.role, content: x.content })),
    );
  }, [thread, suggestKey, turns, refreshSuggestions, agentNext.length]);

  /* ---------------- 把光标送进输入框 ---------------- */

  /**
   * 现在只剩「回它」那颗按钮用它 —— 让作者接着自己写。
   *
   * 提示泡、候选答案、它给的下一步，三处**都改成了点一下就发出去**
   * （作者的诉求是「点击后自动开始思考和构思」）。唯独「回它」不能：
   * 它旁边就是一个需要作者自己组织语言的问题，替他回答没有意义。
   */
  const fillDraft = useCallback((s: string) => {
    setDraft((prev) => (prev.trim() ? `${prev.replace(/\s+$/, '')}\n${s}` : s));
    // 光标落到末尾：接着改，或者直接回车
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const n = el.value.length;
      el.setSelectionRange(n, n);
    });
  }, []);

  /* ---------------- 它给的「下一步」 ---------------- */

  /** 刚点过的那颗按钮挂在哪条轮上 —— 挡住「点完到循环真的开跑」之间那一小段空档里连点第二下 */
  const [nextSentFrom, setNextSentFrom] = useState('');

  /**
   * 建议类按钮点下去的统一动作：**直接发起**。
   *
   * 这些按钮最早是「填进输入框、再按一次回车」。作者的原话是「我希望它给一些可选的按钮，
   * 点击后自动开始思考和构思」—— 填进去再让他按一次，等于把「接下来做什么」又推回给他。
   *
   * 直接发**不等于**直接改库：发出去之后照旧走「放手程度」那三道闸
   * （计划模式照样要他点一下「执行」），所以放心让它跑。
   */
  const runGoal = useCallback(
    (goal: string, from = '') => {
      const text = goal.trim();
      if (!text || !thread || agent.locked) return;
      if (from) setNextSentFrom(from);
      setDraft('');
      void agent.send(text, thread.id);
    },
    [thread, agent, setDraft],
  );

  /* ---------------- 手动工具（复用原有批量生成） ---------------- */

  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [count, setCount] = useState(3);
  const [instruction, setInstruction] = useState('');
  const [keywords, setKeywords] = useState('');
  const [allowRelations, setAllowRelations] = useState(true);
  // 结果与勾选都从全局任务槽里读（见 GenerateBatch 的注释）
  const batch = ai.result;
  const result = batch?.items ?? null;
  const picked = useMemo(() => new Set(batch?.picked ?? []), [batch]);
  const setPicked = (next: Set<string>) =>
    ai.setResult(batch ? { ...batch, picked: [...next] } : null);

  if (!world) return <Empty icon="🌍" title={t('studio.noWorld')} />;

  const cat = categories.find((c) => c.id === categoryId) ?? categories[0];

  const generate = async () => {
    if (!cat) {
      toast.warn(t('studio.toast.needCategory'));
      return;
    }
    ai.reset();
    const items = await ai.run((opts) =>
      runGenerate(cfg, world, entries, categories, cat, {
        instruction,
        count,
        keywords,
        allowRelations,
      }, opts),
    );
    if (!items) return;
    if (!items.length) {
      toast.warn(t('studio.toast.noItems'));
      return;
    }
    ai.setResult({ items, picked: items.map((i) => i.id) });
    toast.success(
      t('studio.toast.generated', { n: items.filter((i) => i.kind === 'create-entry').length }),
    );
  };

  const sendToReview = async () => {
    if (!result) return;
    const chosen = result.filter((i) => picked.has(i.id));
    if (!chosen.length) {
      toast.warn(t('studio.toast.needPick'));
      return;
    }
    await store.pushReview(chosen);
    toast.success(t('studio.toast.sentToReview', { n: chosen.length }));
    ai.reset();
    onNavigate('review');
  };

  const entryItems = (result ?? []).filter((i) => i.kind === 'create-entry');
  const relItems = (result ?? []).filter((i) => i.kind === 'relation');

  /* ---------------- 会话操作 ---------------- */

  const startNewThread = async () => {
    const th = await createThread();
    setThreadId(th.id);
  };

  const clearThread = async () => {
    if (!thread) return;
    await deleteThread(thread.id);
    const th = await createThread();
    setThreadId(th.id);
  };

  const openInternal = (name: string) => {
    const target = entries.find((e) => e.title === name);
    if (target) onOpenEntry(target.id);
    else toast.toast(t('ask.entryNotFound', { name }));
  };

  const suggestLabel = suggestBusy
    ? t('studio.suggest.generating')
    : turns.length
      ? t('studio.suggest.followUp')
      : t('studio.suggest.empty');

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('studio.title')}</h1>
          <p className="page-desc">{t('studio.desc')}</p>
        </div>
        <div className="page-actions">
          <button className="btn sm" data-role="studio-goto-log" onClick={() => onNavigate('log')}>
            {t('log.jump')}
          </button>
          <button className="btn sm" onClick={() => onNavigate('article')}>
            {t('studio.btn.article')}
          </button>
          <button className="btn sm" onClick={() => onNavigate('review')}>
            {store.stats.reviewPending
              ? t('studio.btn.reviewQueueCount', { n: store.stats.reviewPending })
              : t('studio.btn.reviewQueue')}
          </button>
        </div>
      </div>

      <div className="card" data-role="studio-agent">
        <div className="card-head">
          <h3 className="card-title">
            <IcSparkles size={16} /> {t('studio.agent.title')}
          </h3>
          <div className="page-actions" style={{ alignItems: 'center' }}>
            <span className="muted tiny">{t('agent.mode.label')}</span>
            <div className="ag-seg" data-role="agent-mode">
              {MODES.map((m) => (
                <button
                  key={m}
                  className={`ag-seg-btn ${agent.mode === m ? 'on' : ''}`}
                  data-role={`agent-mode-${m}`}
                  title={t.dyn(`agent.mode.${m}Hint`)}
                  disabled={agent.locked}
                  onClick={() => agent.setMode(m)}
                >
                  {t.dyn(`agent.mode.${m}`)}
                </button>
              ))}
            </div>
            <button
              className="btn xs ghost"
              data-role="agent-new-thread"
              disabled={agent.locked}
              onClick={() => void startNewThread()}
            >
              <IcPlus size={13} /> {t('studio.agent.newThread')}
            </button>
            <button
              className="btn xs ghost"
              data-role="agent-clear"
              disabled={agent.locked || !turns.length}
              onClick={() => void clearThread()}
            >
              <IcTrash size={13} /> {t('studio.agent.clear')}
            </button>
          </div>
        </div>

        <div className="field-hint" style={{ marginTop: -4, marginBottom: 8 }}>
          {t.dyn(`agent.mode.${agent.mode}Hint`)}
        </div>

        {/*
          交代清单：**它自己立的账**，不是界面替它演的进度条。
          摆在这里（对话区上方、常驻）而不是塞进某一轮里，是因为它跨轮存在 ——
          「把所有提到过、还没建的补全」那种活要跑十几轮，作者需要随时看得见还剩多少。
          清单没清空，就不算收工；循环那边也是按这个判的（见 useAgent）。
        */}
        {agent.todos.length > 0 && (
          <div
            className="ag-todos"
            data-role="agent-todos"
            data-total={agent.todos.length}
            data-open={agent.todos.filter((x) => !x.done).length}
          >
            <div className="ag-todos-head">
              <span className="ag-todos-title">{t('agent.todo.title')}</span>
              <span className="pill" data-role="agent-todos-count">
                {t('agent.todo.progress', {
                  done: agent.todos.filter((x) => x.done).length,
                  total: agent.todos.length,
                })}
              </span>
              {agent.todos.some((x) => !x.done) ? (
                <span className="muted tiny" data-role="agent-todos-open">
                  {t('agent.err.todoTag')}
                </span>
              ) : (
                <span className="muted tiny" data-role="agent-todos-clear">
                  {t('agent.todo.allDone')}
                </span>
              )}
            </div>
            <ul className="ag-todos-list">
              {agent.todos.map((td, i) => (
                <li
                  key={`${i}-${td.text}`}
                  className={td.done ? 'done' : ''}
                  data-role="agent-todo"
                  data-done={td.done ? '1' : '0'}
                >
                  <span className="ag-todo-box">{td.done ? '✓' : ''}</span>
                  <span>{td.text}</span>
                </li>
              ))}
            </ul>
            <div className="field-hint">{t('agent.todo.hint')}</div>
          </div>
        )}

        <div className="chat-scroll" ref={scrollRef}>
          {turns.length === 0 && !agent.busy && (
            <Empty
              icon="🪄"
              title={t('studio.agent.empty')}
              desc={t('studio.agent.emptyDesc')}
            />
          )}

          {turns.map((turn) => (
            <div
              key={turn.id}
              className={`chat-msg ${turn.role}`}
              data-role="agent-turn"
            >
              <div className={`chat-avatar ${turn.role === 'user' ? 'user' : 'ai'}`}>
                {turn.role === 'user' ? t('ask.me') : t('ask.ai')}
              </div>
              <div className="chat-bubble">
                {turn.role === 'assistant' ? (
                  <MarkdownView
                    content={autoLinkEntries(turn.content, entries)}
                    compact
                    onInternalLink={openInternal}
                  />
                ) : (
                  <div style={{ whiteSpace: 'pre-wrap' }}>{turn.content}</div>
                )}

                {/* 模型没按协议回的痕迹要露出来 —— 否则作者只会看到「它说完了就没下文」 */}
                {turn.protocolBroken && (
                  <div
                    className="ag-broken"
                    data-role="agent-broken"
                    data-kind={turn.protocolBroken}
                  >
                    {turn.protocolBroken === 'repaired'
                      ? t('agent.broken.repaired')
                      : turn.protocolBroken === 'retried'
                        ? t('agent.broken.hint')
                        : t('agent.broken.giveUp')}
                  </div>
                )}

                {/* 它查了半天没收获、被循环拦下来了。如实说，别让作者以为它还在忙。
                    上面那句正文已经把话说清了，这里只挂一个**不重复正文**的短标记 ——
                    但标记也得跟着分岔走，不然「动作写错了」又被合并回「没查到」。 */}
                {turn.stuck && (
                  <div className="ag-broken" data-role="agent-stuck">
                    {turn.stuck === 'badCall'
                      ? t('agent.err.stuckBadCallTag')
                      : t('agent.err.stuckTag')}
                  </div>
                )}

                {/*
                  它停下来了，但事情没做完 —— 这两种必须分开标，而且都不许写成「已完成」：
                  一种是清单上还剩几条，另一种是它嘴上说要接着做、再问一轮还是没有动作。
                  合成一句「已停下」的话，作者既不知道差多少，也不知道该不该继续等。
                */}
                {!!turn.todoLeft && (
                  <div className="ag-broken" data-role="agent-todo-left" data-n={turn.todoLeft}>
                    {t('agent.err.todoTag')}
                  </div>
                )}
                {turn.promised && (
                  <div className="ag-broken" data-role="agent-promised">
                    {t('agent.err.promisedTag')}
                  </div>
                )}

                {turn.cites && turn.cites.length > 0 && (
                  <div className="cite-list">
                    <span className="muted tiny" style={{ alignSelf: 'center' }}>
                      {t('ask.cite')}
                    </span>
                    {turn.cites.map((c) => (
                      <button
                        key={c.id}
                        className="pill pointer"
                        style={{ border: 'none', cursor: 'pointer' }}
                        onClick={() => onOpenEntry(c.id)}
                      >
                        {c.title}
                      </button>
                    ))}
                  </div>
                )}

                {turn.calls && turn.calls.length > 0 && (
                  <Steps
                    calls={turn.calls}
                    entries={entries}
                    ops={store.ops}
                    onUndo={(id) => void store.undoOp(id)}
                    onNavigate={onNavigate}
                    onOpenEntry={onOpenEntry}
                    onFill={fillDraft}
                    onRun={runGoal}
                  />
                )}

                {/*
                  它给的「下一步」—— 贴在这一句下面，不是塞到底部那一行里。
                  理由：这几颗按钮是**对这句话**的回应（「动机是…… ｜ 我可以：把这段补进正文、
                  构思『神祇的监管』条目」），离得越近越像「它伸过来的手」。
                  只有最后一条 AI 轮上的按钮可点：更早的那些已经翻页了。
                */}
                {turn.suggest && turn.suggest.length > 0 && (
                  <div
                    className="ag-next"
                    data-role="agent-next"
                    data-stale={turn.id === lastAgentTurn?.id ? '0' : '1'}
                  >
                    <span className="ag-next-label">{t('studio.agent.next.label')}</span>
                    {turn.suggest.map((s, i) => (
                      <button
                        key={`${i}-${s.label}`}
                        className="pill pointer"
                        style={{ border: '1px solid var(--border)' }}
                        data-role="agent-next-item"
                        title={s.goal}
                        disabled={
                          agent.locked ||
                          turn.id !== lastAgentTurn?.id ||
                          nextSentFrom === turn.id
                        }
                        onClick={() => runGoal(s.goal, turn.id)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                )}

                {agent.pending?.turnId === turn.id ? (
                  <PlanCard
                    calls={agent.pending.calls}
                    busy={agent.busy}
                    onRun={() => void agent.approve()}
                    onSkip={() => void agent.reject()}
                  />
                ) : turn.pending?.calls?.length ? (
                  /*
                   * 计划卡还在、但已经点不动了。只有一种来路：刷新或离开过页面，
                   * 运行态（连同已跑过的上下文）丢了。这时**不能说「被你跳过了」** ——
                   * 它压根没被跳过，是作废了。改批次状态时也不会再走到这里（那时 pending 会被清空）。
                   */
                  <div className="muted tiny" style={{ marginTop: 8 }}>
                    {t('studio.agent.plan.stale')}
                  </div>
                ) : null}
              </div>
            </div>
          ))}

          {agent.phase === 'thinking' && (
            <div className="chat-msg assistant">
              <div className="chat-avatar ai">{t('ask.ai')}</div>
              <div className="chat-bubble">
                {agent.stream ? (
                  <div className="ag-think">{agent.stream}</div>
                ) : (
                  <span className="muted small">{t('studio.agent.thinking')}</span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="divider" />

        {/*
          它自己给了「下一步」的时候，这一行让位。
          两排按钮叠在一起只会互相稀释：「接着可以让它…」是我们替作者出的题，
          而模型给的那几条是**对着刚说完的那句话**给的，明显更贴身。
        */}
        {agentNext.length === 0 && (
          <div className="ag-suggest" data-role="agent-suggest">
            <span className="muted tiny">{suggestLabel}</span>
            {suggestions.map((s, i) => (
              <button
                key={`${i}-${s}`}
                className="pill pointer"
                data-role="agent-suggest-item"
                style={{ border: '1px solid var(--border)' }}
                title={t('studio.suggest.run')}
                disabled={agent.locked || suggestBusy}
                onClick={() => runGoal(s)}
              >
                {s}
              </button>
            ))}
            <button
              className="btn xs ghost"
              data-role="agent-suggest-refresh"
              title={t('studio.suggest.refresh')}
              disabled={suggestBusy || agent.busy}
              onClick={() =>
                void refreshSuggestions(
                  turns.slice(-6).map((x) => ({ role: x.role, content: x.content })),
                )
              }
            >
              <IcRefresh size={13} />
            </button>
          </div>
        )}

        <AgentComposer
          busy={agent.locked}
          value={draft}
          onChange={setDraft}
          inputRef={inputRef}
          placeholder={t('studio.agent.placeholder')}
          sendLabel={t('studio.agent.send')}
          abortLabel={t('studio.agent.abort')}
          onSend={(text) => thread && void agent.send(text, thread.id)}
          onAbort={agent.abort}
        />
      </div>

      <details className="card" data-role="studio-manual" style={{ padding: 0 }}>
        <summary style={{ cursor: 'pointer', padding: '14px 18px', fontWeight: 600 }}>
          {t('studio.manual.title')}{' '}
          <span className="muted tiny" style={{ fontWeight: 400 }}>
            {t('studio.manual.desc')}
          </span>
        </summary>

        <div style={{ padding: '0 18px 16px' }}>
          <div className="card-head" style={{ paddingLeft: 0, paddingRight: 0 }}>
            <h3 className="card-title">{t('studio.card.generate')}</h3>
          </div>

          <div className="row wrap" style={{ gap: 10 }}>
            <div className="col" style={{ minWidth: 180 }}>
              <label className="field-label">{t('studio.field.category')}</label>
              <select
                className="select"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon} {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ width: 110 }}>
              <label className="field-label">{t('studio.field.count')}</label>
              <select className="select" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {[1, 2, 3, 5, 8].map((n) => (
                  <option key={n} value={n}>
                    {t('studio.option.count', { n })}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ minWidth: 180 }}>
              <label className="field-label">{t('studio.field.relation')}</label>
              <label className="row" style={{ gap: 7, alignItems: 'center', paddingTop: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={allowRelations}
                  onChange={(e) => setAllowRelations(e.target.checked)}
                />
                {t('studio.option.suggestRelations')}
              </label>
            </div>
          </div>

          <div className="field mt12">
            <label className="field-label">{t('studio.field.instruction')}</label>
            <textarea
              className="textarea"
              style={{ minHeight: 74 }}
              placeholder={t('studio.placeholder.instruction')}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />
          </div>

          <div className="row wrap" style={{ gap: 10 }}>
            <div className="col" style={{ minWidth: 220 }}>
              <label className="field-label">{t('studio.field.keywords')}</label>
              <input
                className="input"
                placeholder={t('studio.placeholder.keywords')}
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
              />
            </div>
            <div style={{ alignSelf: 'flex-end', display: 'flex', gap: 8 }}>
              <button className="btn primary" onClick={generate} disabled={ai.loading}>
                {ai.loading ? <span className="spinner" /> : <IcSparkles size={15} />}
                {ai.loading ? t('studio.btn.generating') : t('studio.btn.generate')}
              </button>
              {ai.loading && (
                <button className="btn" onClick={ai.abort}>
                  <IcStop size={14} /> {t('studio.btn.abort')}
                </button>
              )}
            </div>
          </div>

          <div className="field-hint" style={{ marginTop: 10 }}>
            {t('studio.hint.context')}
          </div>

          {ai.loading && (
            <div className="stream-box mt12">{ai.stream || t('studio.stream.thinking')}</div>
          )}

          {result && (
            <div className="mt16">
              <div className="card-head" style={{ paddingLeft: 0, paddingRight: 0 }}>
                <h3 className="card-title">{t('studio.result.title')}</h3>
                <span className="pill">{t('studio.result.entryPill', { n: entryItems.length })}</span>
                {relItems.length > 0 && (
                  <span className="pill">{t('studio.result.relPill', { n: relItems.length })}</span>
                )}
                <div className="page-actions">
                  <button
                    className="btn xs"
                    onClick={() =>
                      setPicked(
                        picked.size === result.length ? new Set() : new Set(result.map((i) => i.id)),
                      )
                    }
                  >
                    {picked.size === result.length ? t('studio.btn.selectNone') : t('common.selectAll')}
                  </button>
                  <button className="btn primary sm" onClick={sendToReview}>
                    <IcCheck size={14} /> {t('studio.btn.sendToReview', { n: picked.size })}
                  </button>
                </div>
              </div>

              <div className="grid" style={{ gap: 10 }}>
                {entryItems.map((item) => {
                  const d = item.entryDraft!;
                  const on = picked.has(item.id);
                  return (
                    <div
                      key={item.id}
                      className="review-item"
                      style={{
                        marginBottom: 0,
                        borderColor: on ? 'var(--primary)' : 'var(--border)',
                        opacity: on ? 1 : 0.55,
                      }}
                    >
                      <div className="review-head">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) => {
                            const next = new Set(picked);
                            // 关联项跟随其宿主条目一起勾选
                            const follow = result.filter(
                              (r) =>
                                r.kind === 'relation' &&
                                r.relationDraft?.fromEntryId === item.entryDraft?.id,
                            );
                            if (e.target.checked) {
                              next.add(item.id);
                              follow.forEach((f) => next.add(f.id));
                            } else {
                              next.delete(item.id);
                              follow.forEach((f) => next.delete(f.id));
                            }
                            setPicked(next);
                          }}
                        />
                        <span className="review-title">{d.title}</span>
                        {d.tags?.slice(0, 3).map((tag) => (
                          <span key={tag} className="tag">
                            {tag}
                          </span>
                        ))}
                      </div>
                      <div className="soft small mt8">{d.summary}</div>
                      <div
                        style={{
                          marginTop: 10,
                          borderTop: '1px dashed var(--border)',
                          paddingTop: 10,
                          maxHeight: 190,
                          overflowY: 'auto',
                        }}
                      >
                        <MarkdownView content={d.content ?? ''} compact />
                      </div>
                    </div>
                  );
                })}
              </div>

              {relItems.length > 0 && (
                <>
                  <div className="divider" />
                  <div className="bold small" style={{ marginBottom: 8 }}>
                    {t('studio.result.relationsHeading')}
                  </div>
                  {relItems.map((r) => (
                    <div key={r.id} className="row small" style={{ padding: '4px 0' }}>
                      <input
                        type="checkbox"
                        checked={picked.has(r.id)}
                        onChange={(e) => {
                          const next = new Set(picked);
                          if (e.target.checked) next.add(r.id);
                          else next.delete(r.id);
                          setPicked(next);
                        }}
                      />
                      <span className="grow soft">{r.title}</span>
                      <span className="pill tiny">{r.relationDraft?.type}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </details>

      <div className="card">
        <div className="card-head">
          <h3 className="card-title">{t('studio.cap.title')}</h3>
        </div>
        <div className="grid c2">
          <CapCard
            title={t('studio.cap.extract.title')}
            desc={t('studio.cap.extract.desc')}
            action={t('studio.cap.extract.action')}
            onClick={() => onNavigate('docs')}
          />
          <CapCard
            title={t('studio.cap.relations.title')}
            desc={t('studio.cap.relations.desc')}
            action={t('studio.cap.relations.action')}
            onClick={() => onNavigate('graph')}
          />
          <CapCard
            title={t('studio.cap.consistency.title')}
            desc={t('studio.cap.consistency.desc')}
            action={t('studio.cap.consistency.action')}
            onClick={() => onNavigate('consistency')}
          />
          <CapCard
            title={t('studio.cap.ask.title')}
            desc={t('studio.cap.ask.desc')}
            action={t('studio.cap.ask.action')}
            onClick={() => onNavigate('ask')}
          />
        </div>
      </div>

      <div className="banner info">
        <IcWarn size={16} />
        <div>
          <span className="bold">{t('studio.context.title')}</span>
          <div className="mt8">
            {t('studio.context.desc', {
              count: entries.length,
              limit: cfg.contextLimit,
            })}
          </div>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 输入区                                                              */
/* ------------------------------------------------------------------ */

function AgentComposer({
  busy,
  value,
  onChange,
  inputRef,
  placeholder,
  sendLabel,
  abortLabel,
  onSend,
  onAbort,
}: {
  busy: boolean;
  value: string;
  onChange: (text: string) => void;
  inputRef?: React.RefObject<HTMLTextAreaElement>;
  placeholder: string;
  sendLabel: string;
  abortLabel: string;
  onSend: (text: string) => void;
  onAbort: () => void;
}) {
  const submit = () => {
    const text = value.trim();
    if (!text) return;
    onSend(text);
    onChange('');
  };
  return (
    <div className="row" style={{ alignItems: 'flex-end' }}>
      <textarea
        ref={inputRef}
        className="textarea grow"
        data-role="agent-input"
        style={{ minHeight: 62, maxHeight: 180 }}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        disabled={busy}
      />
      {busy ? (
        <button className="btn" data-role="agent-abort" onClick={onAbort}>
          <IcStop size={14} /> {abortLabel}
        </button>
      ) : (
        <button
          className="btn primary"
          data-role="agent-send"
          onClick={submit}
          disabled={!value.trim()}
        >
          <IcSparkles size={15} /> {sendLabel}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 计划确认卡                                                          */
/* ------------------------------------------------------------------ */

function PlanCard({
  calls,
  busy,
  onRun,
  onSkip,
}: {
  calls: AgentToolCall[];
  busy: boolean;
  onRun: () => void;
  onSkip: () => void;
}) {
  const t = useT();
  return (
    <div className="ag-plan" data-role="agent-plan">
      <div className="ag-plan-head">
        <IcWarn size={14} />
        {t('studio.agent.plan.title')}
        <span className="muted tiny" style={{ fontWeight: 400 }}>
          {t('studio.agent.plan.count', { n: calls.length })}
        </span>
      </div>
      <div className="ag-plan-body">
        {calls.map((c, i) => (
          <div key={c.id} className="ag-plan-item">
            <span className="ag-plan-idx">{i + 1}</span>
            <span>
              <span className="bold">{c.tool}</span>
              <span className="muted"> {summarizeArgs(c.args, t('studio.agent.step.noArgs'))}</span>
              {c.why && <div className="ag-act-why">{t('studio.agent.step.why', { why: c.why })}</div>}
            </span>
          </div>
        ))}
      </div>
      <div className="ag-plan-foot">
        <span className="muted tiny grow">{t('studio.agent.plan.note')}</span>
        <button className="btn xs ghost" data-role="agent-plan-skip" disabled={busy} onClick={onSkip}>
          {t('studio.agent.plan.skip')}
        </button>
        <button className="btn primary sm" data-role="agent-plan-run" disabled={busy} onClick={onRun}>
          <IcCheck size={14} /> {t('studio.agent.plan.run')}
        </button>
      </div>
    </div>
  );
}

/** 把参数压成一行好看的东西：优先展示 title / name / entry 这类有意义的字段 */
function summarizeArgs(args: Record<string, unknown>, empty: string): string {
  const keys = ['title', 'name', 'entry', 'doc', 'piece', 'category', 'from', 'to', 'page', 'text'];
  const parts: string[] = [];
  for (const k of keys) {
    const v = args[k];
    if (typeof v === 'string' && v.trim()) {
      // 「」只是排版括号，与语言无关
      parts.push(k === 'page' ? v : `「${v.trim()}」`); // i18n-allow
      if (parts.length >= 3) break;
    }
  }
  if (!parts.length) {
    const ks = Object.keys(args);
    return ks.length ? ks.join(', ') : empty;
  }
  return parts.join(' · ');
}

/* ------------------------------------------------------------------ */
/* 工具回执                                                            */
/* ------------------------------------------------------------------ */

function Steps({
  calls,
  entries,
  ops,
  onUndo,
  onNavigate,
  onOpenEntry,
  onFill,
  onRun,
}: {
  calls: AgentToolCall[];
  entries: Entry[];
  ops: { id: string; undone: boolean }[];
  onUndo: (opId: string) => void;
  onNavigate: (route: string, view?: AgentPageView) => void;
  onOpenEntry: (id: string) => void;
  /** 把一句话填进输入框、光标落到末尾（「回它」那个按钮用它）—— 只填，不代发 */
  onFill: (text: string) => void;
  /** 点一下就交给它（提问的候选**答案**用它）—— 候选答案点下去就是要这么答，再让作者按一次回车是多余的 */
  onRun: (text: string) => void;
}) {
  const t = useT();

  return (
    <div className="ag-acts">
      {calls.map((c) => {
        const undone = c.opIds?.length
          ? c.opIds.every((id) => ops.find((o) => o.id === id)?.undone)
          : false;
        const undoable = !!c.opIds?.length && !undone;
        const jump = c.tool === 'navigate' && c.status === 'done' ? jumpTarget(c, entries) : null;

        // 提问单独一样子：它不是「做过的一件事」，是「它伸过来的一句话」。
        // 塞进动作清单里读起来会像它刚干了什么，反而更容易被划过去。
        if (c.tool === 'ask_author') {
          const question =
            c.result || (typeof c.args.question === 'string' ? c.args.question : '');
          const options = Array.isArray(c.args.options)
            ? c.args.options.filter((o): o is string => typeof o === 'string' && !!o.trim())
            : [];
          return (
            <div key={c.id} className="ag-askbox" data-role="agent-ask">
              <div className="ag-ask-head">
                <span className="ag-act-dot">{STATUS_GLYPH[c.status]}</span>
                <span className="ag-ask-title">{t('studio.agent.ask.title')}</span>
              </div>
              {question && (
                <div className="ag-ask-q" data-role="agent-ask-question">
                  {question}
                </div>
              )}
              {options.length > 0 && (
                <div className="ag-ask-opts">
                  {options.map((o) => (
                    <button
                      key={o}
                      className="pill pointer"
                      style={{ border: '1px solid var(--border)' }}
                      data-role="agent-ask-option"
                      title={t('studio.agent.ask.pick')}
                      onClick={() => onRun(o)}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              )}
              <div className="ag-ask-foot">
                <span className="muted tiny grow">{t('studio.agent.ask.pick')}</span>
                <button
                  className="btn xs ghost"
                  data-role="agent-ask-answer"
                  onClick={() => onFill('')}
                >
                  {t('studio.agent.ask.answer')}
                </button>
              </div>
            </div>
          );
        }

        return (
          <div key={c.id} className={`ag-act ${c.status}`} data-role="agent-step">
            <span className="ag-act-dot">{STATUS_GLYPH[c.status]}</span>
            <span className="ag-act-main">
              <span className="ag-act-what">
                {/* 显示的是「新建条目」而不是 create_entry：工具名是模型和代码的方言 */}
                <span className="ag-act-name">{toolLabel(c.tool)}</span>
                {' · '}
                <span>{c.result || t.dyn(STEP_STATUS_KEY[c.status])}</span>
              </span>
              {c.why && (
                <div className="ag-act-why">{t('studio.agent.step.why', { why: c.why })}</div>
              )}
            </span>
            <span className="ag-act-tools">
              {c.review && c.status === 'done' && (
                <button
                  className="btn xs ghost"
                  data-role="agent-step-review"
                  onClick={() => onNavigate('review')}
                >
                  {t('studio.agent.step.review')}
                </button>
              )}
              {jump && (
                <button
                  className="btn xs ghost"
                  data-role="agent-step-jump"
                  onClick={() =>
                    jump.entryId
                      ? onOpenEntry(jump.entryId)
                      : onNavigate(jump.page, jump.view)
                  }
                >
                  {t('studio.agent.step.jump')}
                </button>
              )}
              {undoable && (
                <button
                  className="btn xs ghost"
                  data-role="agent-step-undo"
                  title={t('studio.agent.step.undo')}
                  onClick={() => c.opIds!.forEach(onUndo)}
                >
                  {t('studio.agent.step.undo')}
                </button>
              )}
              {undone && <span className="muted tiny">{t('studio.agent.step.undone')}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * navigate 只记下「建议去哪个页面」，真正跳不跳由作者点。
 * 条目名在这里现解析成 id —— agent 当时解析的那个没有落库。
 *
 * 页面名也在这里现解析：模型写的可能是「时间线」这种**旧说法**（轴已经不是独立的一页了，
 * 它现在是关系图谱里的时间分支）。认出来的 `view` 一起交给外面，落点才准 ——
 * 只说「去 graph」的话，作者落到的是关系那一支，还得自己再切一下。
 */
function jumpTarget(
  call: AgentToolCall,
  entries: Entry[],
): { page: string; view?: AgentPageView; entryId?: string } | null {
  const raw = typeof call.args.page === 'string' ? call.args.page : '';
  const page = resolveAgentPage(raw);
  if (!page) return null;
  const title = typeof call.args.entry === 'string' ? call.args.entry.trim().toLowerCase() : '';
  if (!title) return { page: page.page, view: page.view };
  const hit =
    entries.find((e) => e.title.toLowerCase() === title) ??
    entries.find((e) => e.aliases.some((a) => a.toLowerCase() === title));
  return { page: page.page, view: page.view, entryId: hit?.id };
}

/* ------------------------------------------------------------------ */

function CapCard({
  title,
  desc,
  action,
  onClick,
}: {
  title: string;
  desc: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 14,
        background: 'var(--panel-alt)',
      }}
    >
      <div className="bold" style={{ fontSize: 13.5 }}>
        {title}
      </div>
      <div className="soft small mt8">{desc}</div>
      <button className="btn sm mt12" onClick={onClick}>
        {action}
      </button>
    </div>
  );
}
