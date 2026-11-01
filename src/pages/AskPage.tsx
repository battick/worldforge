import React from 'react';
import { useStore } from '../state/store';
import { useToast } from '../components/Toast';
import { Empty } from '../components/Modal';
import { MarkdownView } from '../components/MarkdownView';
import { formatRelative } from '../lib/id';
import { autoLinkEntries } from '../lib/autoLink';
import { useT } from '../i18n';

interface Props {
  onOpenEntry: (id: string) => void;
  onNavigate: (route: string) => void;
}

/**
 * 问答存档。
 *
 * 提问已经整体搬进 AI 工作台，那里有一个能真正读写知识库的 agent；
 * 这个页面降级为只读：只把过去留下的会话按时间倒序重放一遍，不再有
 * 输入框，也不调用任何 AI。想继续问，就顺着顶部的引导条去工作台。
 */
export function AskPage({ onOpenEntry, onNavigate }: Props) {
  const store = useStore();
  const toast = useToast();
  const t = useT();

  if (!store.activeWorld) return <Empty icon="🌍" title={t('ask.noWorld')} />;

  /** 空会话（只有元数据、没有轮次）没有回看的价值，整段跳过 */
  const threads = store.threads.filter((thread) => thread.turns.length > 0);

  const openByTitle = (name: string) => {
    const target = store.entries.find((e) => e.title === name);
    if (target) onOpenEntry(target.id);
    else toast.toast(t('ask.entryNotFound', { name }));
  };

  return (
    <div data-role="ask-archive">
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('ask.title')}</h1>
          <p className="page-desc">{t('ask.desc')}</p>
        </div>
      </div>

      <div className="banner info" style={{ marginBottom: 14, alignItems: 'center' }}>
        <div className="grow">{t('ask.archive.banner')}</div>
        <button
          className="btn sm"
          data-role="ask-goto-studio"
          onClick={() => onNavigate('studio')}
        >
          {t('ask.archive.goStudio')}
        </button>
      </div>

      {threads.length === 0 ? (
        <Empty icon="💬" title={t('ask.archive.empty')} desc={t('ask.archive.emptyDesc')} />
      ) : (
        threads.map((thread) => (
          <div className="card" key={thread.id} data-role="ask-thread">
            <div className="card-head">
              <h3 className="card-title">{thread.title}</h3>
              <span className="muted tiny">{formatRelative(thread.updatedAt)}</span>
            </div>

            <div className="chat-scroll" style={{ height: 'auto', maxHeight: 480 }}>
              {thread.turns.map((turn) => (
                <div
                  className={`chat-msg ${turn.role}`}
                  key={turn.id}
                  data-role="ask-turn"
                >
                  <div className={`chat-avatar ${turn.role}`}>
                    {turn.role === 'user' ? t('ask.me') : t('ask.ai')}
                  </div>
                  <div className="chat-bubble">
                    {turn.role === 'assistant' ? (
                      <MarkdownView
                        content={autoLinkEntries(turn.content, store.entries)}
                        compact
                        onInternalLink={openByTitle}
                      />
                    ) : (
                      <div style={{ whiteSpace: 'pre-wrap' }}>{turn.content}</div>
                    )}

                    {turn.role === 'assistant' && !!turn.cites?.length && (
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

                    {turn.role === 'assistant' && !!turn.calls?.length && (
                      <div
                        className="col"
                        style={{
                          gap: 4,
                          marginTop: 10,
                          paddingTop: 9,
                          borderTop: '1px dashed var(--border)',
                        }}
                      >
                        {turn.calls.map((call) => (
                          <div
                            className="muted tiny"
                            key={call.id}
                            style={
                              call.status === 'failed'
                                ? { color: 'var(--danger)' }
                                : call.status === 'skipped'
                                  ? { color: 'var(--text-dim)' }
                                  : undefined
                            }
                          >
                            {call.status === 'failed' && (
                              <span className="bold">{t('ask.archive.stepFailed')}: </span>
                            )}
                            {call.result}
                          </div>
                        ))}
                      </div>
                    )}

                    {turn.role === 'assistant' && (turn.pending?.calls?.length ?? 0) > 0 && (
                      <div className="muted tiny" style={{ marginTop: 8 }}>
                        {t('ask.archive.skipped')}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
