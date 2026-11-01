import React, { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { useToast } from '../components/Toast';
import { Empty } from '../components/Modal';
import { IcLink, IcRefresh, IcTrash } from '../components/icons';
import { formatRelative } from '../lib/id';
import { useT } from '../i18n';
import type { OpActor, OpEntity, OpLog } from '../types';

interface Props {
  onOpenEntry: (id: string) => void;
  onNavigate: (route: string) => void;
}

/** 实体筛选 chip 的顺序（与 data-role 约定一致） */
const ENTITY_FILTERS: OpEntity[] = [
  'world',
  'category',
  'entry',
  'relation',
  'doc',
  'piece',
  'note',
  'settings',
];

/** 不可见占位符：先把 target 从整句里「挖」出来，渲染时再单独加粗 */
const TARGET_MARK = '\u0000';

export function ActivityLogPage({ onOpenEntry, onNavigate }: Props) {
  const store = useStore();
  const toast = useToast();
  const t = useT();

  // onNavigate 预留给后续「跳到资料/条目页」等入口
  void onNavigate;

  const [actorFilter, setActorFilter] = useState<'all' | OpActor>('all');
  const [entityFilter, setEntityFilter] = useState<'all' | OpEntity>('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  const ops = useMemo(
    () =>
      store.ops.filter(
        (o) =>
          (actorFilter === 'all' || o.actor === actorFilter) &&
          (entityFilter === 'all' || o.entity === entityFilter),
      ),
    [store.ops, actorFilter, entityFilter],
  );

  if (!store.activeWorld) {
    return (
      <div data-role="log-page">
        <Empty icon="🌍" title={t('log.noWorld')} />
      </div>
    );
  }

  /** 一条记录里可翻译的几个片段：谁、做什么、对哪种东西 */
  const parts = (o: OpLog) => ({
    actor: t.dyn('log.actor.' + o.actor),
    action: t.dyn('log.action.' + o.action),
    entity: t.dyn('log.entity.' + o.entity),
  });

  /** 纯文字版整句（撤销 toast 里「已撤销：…」用） */
  const lineText = (o: OpLog): string => {
    const p = parts(o);
    if (o.entity === 'note' || o.action === 'note') {
      return t('log.noteLine', { actor: p.actor, detail: o.detail });
    }
    if (o.target) {
      return t('log.lineWithTarget', {
        actor: p.actor,
        action: p.action,
        entity: p.entity,
        target: o.target,
      });
    }
    return t('log.line', { actor: p.actor, action: p.action, entity: p.entity });
  };

  /** 正文节点：有 target 时用 span 高亮，其余整句照译 */
  const lineNode = (o: OpLog): React.ReactNode => {
    const p = parts(o);
    if (o.entity === 'note' || o.action === 'note') {
      return t('log.noteLine', { actor: p.actor, detail: o.detail });
    }
    if (o.target) {
      // 用占位符拼一次，再把占位符替换成带样式的 target —— 整段文本与翻译完全一致
      const text = t('log.lineWithTarget', {
        actor: p.actor,
        action: p.action,
        entity: p.entity,
        target: TARGET_MARK,
      });
      const at = text.indexOf(TARGET_MARK);
      if (at < 0) return text;
      return (
        <>
          {text.slice(0, at)}
          <span className="log-target">{o.target}</span>
          {text.slice(at + TARGET_MARK.length)}
        </>
      );
    }
    return t('log.line', { actor: p.actor, action: p.action, entity: p.entity });
  };

  const runUndo = async (o: OpLog) => {
    setBusyId(o.id);
    try {
      await store.undoOp(o.id);
      toast.success(t('log.undone.toast', { what: lineText(o) }));
    } catch (e) {
      toast.error(t('log.undoFailed', { message: (e as Error).message }));
    } finally {
      setBusyId(null);
    }
  };

  const clear = async () => {
    if (!window.confirm(t('log.clearConfirm'))) return;
    await store.clearOps();
    toast.success(t('log.cleared'));
  };

  return (
    <div data-role="log-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('log.title')}</h1>
          <p className="page-desc">{t('log.desc')}</p>
        </div>
        <div className="page-actions">
          <button className="btn sm" data-role="log-clear" onClick={clear}>
            <IcTrash size={14} /> {t('log.clear')}
          </button>
        </div>
      </div>

      <div className="log-filters">
        <span className="muted tiny">{t('log.filter.actor')}</span>
        <button
          className={`chip ${actorFilter === 'all' ? 'active' : ''}`}
          data-role="log-filter-actor-all"
          onClick={() => setActorFilter('all')}
        >
          {t('log.filter.all')}
        </button>
        <button
          className={`chip ${actorFilter === 'user' ? 'active' : ''}`}
          data-role="log-filter-actor-user"
          onClick={() => setActorFilter('user')}
        >
          {t('log.actor.user')}
        </button>
        <button
          className={`chip ${actorFilter === 'agent' ? 'active' : ''}`}
          data-role="log-filter-actor-agent"
          onClick={() => setActorFilter('agent')}
        >
          {t('log.actor.agent')}
        </button>

        <span className="muted tiny" style={{ marginLeft: 8 }}>
          {t('log.filter.entity')}
        </span>
        <button
          className={`chip ${entityFilter === 'all' ? 'active' : ''}`}
          data-role="log-filter-entity-all"
          onClick={() => setEntityFilter('all')}
        >
          {t('log.filter.all')}
        </button>
        {ENTITY_FILTERS.map((e) => (
          <button
            key={e}
            className={`chip ${entityFilter === e ? 'active' : ''}`}
            data-role={`log-filter-entity-${e}`}
            onClick={() => setEntityFilter(e)}
          >
            {t.dyn('log.entity.' + e)}
          </button>
        ))}
      </div>

      <div className="muted tiny">{t('log.count', { n: ops.length })}</div>

      {ops.length === 0 ? (
        <Empty icon="🕘" title={t('log.empty')} desc={t('log.emptyDesc')} />
      ) : (
        <div className="log-list mt12">
          {ops.map((o) => {
            const canUndo = !!o.undo && !o.undone;
            return (
              <div
                key={o.id}
                className={`log-item ${o.actor}${o.undone ? ' undone' : ''}`}
                data-role="log-item"
              >
                <div className="log-badge">
                  {o.actor === 'user' ? t('log.actor.user').slice(0, 1) : t('log.actor.agent')}
                </div>

                <div className="log-main">
                  <div className={`log-line${o.undone ? ' log-strike' : ''}`}>{lineNode(o)}</div>
                  {/*
                    agent 当时给的理由。不显示的话，日志里只剩一个结论（「提议新增了 X」），
                    作者看不到它为什么这么提议 —— 这条记录的价值也就少了一半。
                  */}
                  {o.detail && o.action !== 'note' && (
                    <div className="log-why">{t('log.detail', { detail: o.detail })}</div>
                  )}
                  <div className="log-meta">
                    {formatRelative(o.createdAt)}
                    {o.fields && o.fields.length > 0
                      ? ` ${t('log.fields', { fields: o.fields.join(t('common.listSep')) })}`
                      : ''}
                    {o.worldId === null ? ` ${t('log.global')}` : ''}
                  </div>
                </div>

                <div className="log-actions">
                  {o.targetId && o.entity === 'entry' && (
                    <button
                      className="btn xs"
                      data-role="log-open"
                      title={t('log.openTip')}
                      onClick={() => onOpenEntry(o.targetId!)}
                    >
                      <IcLink size={13} /> {t('log.open')}
                    </button>
                  )}
                  {canUndo ? (
                    <button
                      className="btn xs"
                      data-role="log-undo"
                      title={t('log.undoTip')}
                      disabled={busyId === o.id}
                      onClick={() => runUndo(o)}
                    >
                      {busyId === o.id ? <span className="spinner" /> : <IcRefresh size={13} />}
                      {t('log.undo')}
                    </button>
                  ) : o.undone ? (
                    <span className="muted tiny" title={t('log.undoneHint')}>
                      {t('log.undone')}
                    </span>
                  ) : (
                    <span className="muted tiny">{t('log.undoUnavailable')}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
