import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useT, type TFunc } from '../i18n';
import { useToast } from './Toast';
import { MarkdownView } from './MarkdownView';
import { ACCEPT_ATTR, extractText, humanSize } from '../lib/files';
import { IMAGE_ACCEPT, isImageFile, prepareImage } from '../lib/images';
import { runIntake, runProposal, runProposalRevise, runSuggestAnswers } from '../ai/tasks';
import { pt } from '../ai/promptText';
import { uid, now } from '../lib/id';
import type { DraftMaterial, DraftQuestion, World, WorldDraft, WorldProposal } from '../types';
import { IcCheck, IcClose, IcPlus, IcRefresh, IcSparkles, IcTrash, IcWarn } from './icons';

const MAX_MATERIALS = 40;
const MAX_IMAGES = 8;
const MAX_TEXT_PER_MATERIAL = 200_000;

const COLORS = ['#5b7c99', '#2f6fb0', '#7c5cbf', '#17805a', '#b4720d', '#b5352b', '#0e7c8a', '#8a6d3b'];

/**
 * 新建世界。
 *
 * 设计立场：不做表单。用户不需要先想清楚再来 ——
 * 他把手上有的东西丢进来（旧文章、图片、随手写的规则都可以），
 * AI 负责读懂、追问、统筹成一份设定草案，最后由他一锤定音。
 * 在点下「确认创建」之前，库里不会有任何世界数据。
 */
export function WorldOnboarding({
  onClose,
  onGoSettings,
}: {
  /** 创建成功时回传新世界；用户中途退出则不传 */
  onClose: (created?: World) => void;
  onGoSettings: () => void;
}) {
  const store = useStore();
  const toast = useToast();
  const t = useT();

  const [draft, setDraft] = useState<WorldDraft>(() => store.draft ?? store.newDraft());
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [toldInput, setToldInput] = useState('');
  const [reviseText, setReviseText] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<'text' | 'rule'>('text');
  const [composer, setComposer] = useState('');
  const [noteFor, setNoteFor] = useState<string | null>(null);
  /** 正在为哪个问题重想候选答案（null = 没有在跑） */
  const [suggestBusyFor, setSuggestBusyFor] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const aiReady = useMemo(() => {
    const ai = store.settings.ai;
    return !!ai.baseUrl && !!ai.model && (!!ai.apiKey || /localhost|127\.0\.0\.1/.test(ai.baseUrl));
  }, [store.settings.ai]);

  /* ---- 草稿自动存盘：刷新/断电都不至于白干 ---- */
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (!dirtyRef.current) return;
    const t = setTimeout(() => {
      store.saveDraft(draft).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [draft, store]);

  const update = (patch: Partial<WorldDraft>) => {
    dirtyRef.current = true;
    setDraft((d) => ({ ...d, ...patch }));
  };

  const patchProposal = (patch: Partial<WorldProposal>) => {
    if (!draft.proposal) return;
    update({ proposal: { ...draft.proposal, ...patch } });
  };

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: 99999, behavior: 'smooth' });
    });
  };

  /* ---------------------------- 素材 ---------------------------- */

  const addMaterials = (items: DraftMaterial[]) => {
    if (!items.length) return;
    const next = [...draft.materials, ...items].slice(0, MAX_MATERIALS);
    update({ materials: next });
  };

  const handleFiles = async (files: FileList | File[] | null) => {
    if (!files || !files.length) return;
    const list = Array.from(files);
    const existingImages = draft.materials.filter((m) => m.kind === 'image').length;
    let imagesLeft = Math.max(0, MAX_IMAGES - existingImages);
    const added: DraftMaterial[] = [];
    const warns: string[] = [];

    for (const f of list) {
      if (added.length + draft.materials.length >= MAX_MATERIALS) {
        warns.push(t('world.err.maxMaterials', { n: MAX_MATERIALS }));
        break;
      }
      if (isImageFile(f)) {
        if (imagesLeft <= 0) {
          warns.push(t('world.err.maxImages', { n: MAX_IMAGES, name: f.name }));
          continue;
        }
        imagesLeft -= 1;
        const img = await prepareImage(f);
        added.push({
          id: uid('mt'),
          kind: 'image',
          name: f.name,
          text: '',
          dataUrl: img?.dataUrl,
          thumb: img?.thumb,
          size: f.size,
          warning: img ? undefined : t('world.err.imageFailed'),
          addedAt: now(),
        });
        continue;
      }
      const { text, warning } = await extractText(f);
      const clipped = text.slice(0, MAX_TEXT_PER_MATERIAL);
      added.push({
        id: uid('mt'),
        kind: 'file',
        name: f.name,
        text: clipped,
        chars: text.length,
        size: f.size,
        warning:
          warning ??
          (text.length > clipped.length
            ? t('world.err.tooLong', { n: MAX_TEXT_PER_MATERIAL })
            : undefined),
        addedAt: now(),
      });
    }

    addMaterials(added);
    warningsToToast([...warns, ...added.map((a) => a.warning).filter(Boolean) as string[]], toast, t);
  };

  const submitComposer = () => {
    const text = composer.trim();
    if (!text) return;
    addMaterials([
      {
        id: uid('mt'),
        kind: composerMode,
        name: t(
          composerMode === 'rule' ? 'world.material.ruleName' : 'world.material.noteName',
          { text: `${text.slice(0, 12)}${text.length > 12 ? '…' : ''}` },
        ),
        text,
        chars: text.length,
        addedAt: now(),
      },
    ]);
    setComposer('');
  };

  const removeMaterial = (id: string) =>
    update({ materials: draft.materials.filter((m) => m.id !== id) });

  const setNote = (id: string, note: string) =>
    update({ materials: draft.materials.map((m) => (m.id === id ? { ...m, note } : m)) });

  /** 作者单方面向 AI 交代的话（最高优先级），旧草稿可能没有该字段 */
  const toldList = draft.told ?? [];

  const submitTold = () => {
    const text = toldInput.trim();
    if (!text) return;
    update({ told: [...toldList, { id: uid('td'), text, createdAt: now() }] });
    setToldInput('');
  };

  const removeTold = (id: string) =>
    update({ told: toldList.filter((t) => t.id !== id) });

  /* ---------------------------- AI 动作 ---------------------------- */

  const guard = (): boolean => {
    if (!aiReady) {
      toast.error(t('world.err.aiNotReady'));
      return false;
    }
    return true;
  };

  /**
   * 「换一批」：只重想这一个问题的候选答案，问题本身不动。
   * 作者看着 AI 给的建议都不顺眼时用 —— 比让他自己从零开始写要省事。
   */
  const refreshSuggest = async (qid: string) => {
    if (!guard()) return;
    const q = draft.questions.find((x) => x.id === qid);
    if (!q) return;
    setSuggestBusyFor(qid);
    try {
      const list = await runSuggestAnswers(
        store.settings.ai,
        draft.materials,
        q.question,
        q.why,
        toldList.map((x) => x.text),
      );
      if (!list.length) {
        toast.warn(t('world.qa.suggestFailed'));
        return;
      }
      update({
        questions: draft.questions.map((x) => (x.id === qid ? { ...x, suggest: list } : x)),
      });
    } catch (e) {
      toast.error((e as Error).message || t('world.qa.suggestFailed'));
    } finally {
      setSuggestBusyFor(null);
    }
  };

  const doIntake = async (mode: 'first' | 'continue' | 'more') => {
    if (!guard()) return;
    if (!draft.materials.length) {
      toast.warn(t('world.err.needMaterials'));
      return;
    }

    // 「继续」时才把这一轮的回答归档
    const qa =
      mode === 'first'
        ? draft.qa
        : [...draft.qa, ...draft.questions.map((q) => ({
            question: q.question,
            answer: q.answer,
            delegated: q.delegated,
          }))];

    const round = mode === 'first' ? 1 : draft.round + 1;
    setBusy(mode === 'more' ? t('world.busy.more') : t('world.busy.reading'));
    setError('');

    try {
      const res = await runIntake(store.settings.ai, draft.materials, {
        round,
        followUp: mode !== 'first',
        extra:
          mode === 'more' ? pt('intakeAskMore') : undefined,
        told: toldList.map((t) => t.text),
        answers: qa,
      });

      dirtyRef.current = true;
      setDraft((d) => ({
        ...d,
        stage: res.questions.length ? 'align' : res.readyToDraft ? 'proposal' : 'align',
        qa,
        round,
        questions: res.questions.map((q) => ({
          id: uid('qs'),
          question: q.question,
          why: q.why,
          suggest: q.suggest,
          answer: '',
          delegated: false,
        })),
        understanding: res.understanding || d.understanding,
        observations: res.observations,
        readyToDraft: res.readyToDraft,
      }));
      if (res.imageWarning) toast.warn(res.imageWarning);
      scrollToBottom();
    } catch (e) {
      setError((e as Error).message || t('world.err.callFailed'));
    } finally {
      setBusy('');
    }
  };

  const doProposal = async () => {
    if (!guard()) return;
    setBusy(t('world.busy.proposal'));
    setError('');
    try {
      // 尚未提交的回答一并归档，避免丢失
      const qa = [
        ...draft.qa,
        ...draft.questions
          .filter((q) => q.answer.trim() || q.delegated)
          .map((q) => ({ question: q.question, answer: q.answer, delegated: q.delegated })),
      ];
      const res = await runProposal(
        store.settings.ai,
        draft.materials,
        qa,
        toldList.map((t) => t.text),
        undefined,
      );
      dirtyRef.current = true;
      setDraft((d) => ({
        ...d,
        qa,
        questions: [],
        proposal: res.proposal,
        stage: 'proposal',
        readyToDraft: true,
      }));
      if (res.imageWarning) toast.warn(res.imageWarning);
      scrollToBottom();
    } catch (e) {
      setError((e as Error).message || t('world.err.proposalFailed'));
    } finally {
      setBusy('');
    }
  };

  const doRevise = async () => {
    if (!guard() || !draft.proposal) return;
    const instruction = reviseText.trim();
    if (!instruction) {
      toast.warn(t('world.err.needRevise'));
      return;
    }
    setBusy(t('world.busy.revising'));
    setError('');
    try {
      const next = await runProposalRevise(
        store.settings.ai,
        draft.materials,
        draft.qa,
        toldList.map((t) => t.text),
        draft.proposal,
        instruction,
        draft.revisions.length,
      );
      dirtyRef.current = true;
      setDraft((d) => ({ ...d, proposal: next, revisions: [...d.revisions, instruction] }));
      setReviseText('');
      toast.success(t('world.toast.revised'));
      scrollToBottom();
    } catch (e) {
      setError((e as Error).message || t('world.err.reviseFailed'));
    } finally {
      setBusy('');
    }
  };

  const confirmCreate = async () => {
    if (!draft.proposal) return;
    const included = draft.proposal.entries.filter((e) => e.included && e.title.trim());
    if (!included.length) {
      toast.warn(t('world.err.needEntry'));
      return;
    }
    setBusy(t('world.busy.creating'));
    setError('');
    try {
      const world = await store.commitDraft(draft);
      toast.success(t('world.toast.created', { name: world.name }));
      onClose(world);
    } catch (e) {
      setError((e as Error).message || t('world.err.createFailed'));
      setBusy('');
    }
  };

  /**
   * 放弃创建：清掉当前草稿并退出。
   * 退出（onClose）只会留着进度，想从头来过得走这条 —— 否则旧草稿会一直挡在门口。
   */
  const handleAbandon = async () => {
    if (!confirm(t('world.confirm.abandon'))) return;
    await store.discardDraft(draft.id);
    toast.success(t('world.toast.deleted'));
    onClose();
  };

  /* ---------------------------- 渲染 ---------------------------- */

  const hasUnderstanding = !!draft.understanding;
  const answeredAll =
    draft.questions.length > 0 &&
    draft.questions.every((q) => q.answer.trim() || q.delegated);
  const includedCount = draft.proposal?.entries.filter((e) => e.included).length ?? 0;
  const materialText = draft.materials.filter((m) => m.kind !== 'image');
  const materialImages = draft.materials.filter((m) => m.kind === 'image');

  return (
    <div className="ob">
      <header className="ob-head">
        <div className="row" style={{ alignItems: 'center', gap: 12 }}>
          <div className="ob-mark">
            <IcSparkles size={16} />
          </div>
          <div>
            <div className="ob-title">{t('world.head.title')}</div>
            <div className="ob-sub">
              {t('world.head.sub')}
            </div>
          </div>
        </div>
        <div className="page-actions">
          <button
            className="btn sm ghost"
            onClick={handleAbandon}
            title={t('world.btn.abandon')}
          >
            <IcTrash size={14} /> {t('world.btn.abandon')}
          </button>
          <button className="btn sm ghost" onClick={() => onClose()}>
            <IcClose size={14} /> {t('world.btn.exit')}
          </button>
        </div>
      </header>

      <div className="ob-body">
        {/* ---------------- 左：素材 ---------------- */}
        <aside className="ob-left">
          <div className="ob-left-head">
            <div className="bold" style={{ fontSize: 13 }}>
              {t('world.left.title')}
            </div>
            <div className="muted tiny">
              {t('world.left.count', { text: materialText.length, img: materialImages.length })}
            </div>
          </div>

          <div
            className={`ob-drop ${dragging ? 'over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              handleFiles(e.dataTransfer?.files ?? null);
            }}
            onClick={() => fileRef.current?.click()}
          >
            <div style={{ fontSize: 20 }}>📥</div>
            <div className="bold small">{t('world.drop.title')}</div>
            <div className="muted tiny" style={{ marginTop: 3, lineHeight: 1.6 }}>
              {t('world.drop.formats')}
              <br />
              {t('world.drop.images')}
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            accept={`${ACCEPT_ATTR},${IMAGE_ACCEPT}`}
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = '';
            }}
          />

          <div className="ob-composer">
            <div className="ob-seg">
              <button
                className={composerMode === 'text' ? 'active' : ''}
                onClick={() => setComposerMode('text')}
              >
                {t('world.composer.text')}
              </button>
              <button
                className={composerMode === 'rule' ? 'active' : ''}
                onClick={() => setComposerMode('rule')}
              >
                {t('world.composer.rule')}
              </button>
            </div>
            <textarea
              className="textarea"
              style={{ minHeight: 76, fontSize: 13 }}
              value={composer}
              placeholder={
                composerMode === 'rule'
                  ? t('world.composer.rulePlaceholder')
                  : t('world.composer.textPlaceholder')
              }
              onChange={(e) => setComposer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitComposer();
              }}
            />
            <button className="btn sm" onClick={submitComposer} disabled={!composer.trim()}>
              <IcPlus size={13} /> {t('world.btn.addMaterial')}
              <span className="muted tiny" style={{ marginLeft: 4 }}>
                Ctrl+Enter
              </span>
            </button>
          </div>

          <div className="ob-mats">
            {draft.materials.length === 0 && (
              <div className="muted tiny" style={{ padding: '10px 2px', lineHeight: 1.7 }}>
                {t('world.left.empty')}
              </div>
            )}
            {draft.materials.map((m) => (
              <MaterialRow
                key={m.id}
                m={m}
                noteOpen={noteFor === m.id}
                onToggleNote={() => setNoteFor(noteFor === m.id ? null : m.id)}
                onNote={(v) => setNote(m.id, v)}
                onRemove={() => removeMaterial(m.id)}
              />
            ))}
          </div>
        </aside>

        {/* ---------------- 右：流程 ---------------- */}
        <section className="ob-right" ref={scrollRef}>
          {!aiReady && (
            <div className="banner warn">
              <IcWarn size={16} />
              <div>
                <span className="bold">{t('world.banner.aiOff.title')}</span>
                <div className="mt8">
                  {t('world.banner.aiOff.desc')}
                </div>
                <button className="btn sm mt8" onClick={onGoSettings}>
                  {t('world.banner.aiOff.btn')}
                </button>
              </div>
            </div>
          )}

          {store.pendingUpgrade && (
            <div className="banner warn">
              <IcWarn size={16} />
              <div>
                <span className="bold">{t('world.banner.upgrade.title')}</span>
                <div className="mt8">
                  {t('world.banner.upgrade.desc')}
                </div>
              </div>
            </div>
          )}

          {!hasUnderstanding && !busy && (
            <div className="ob-hello">
              <div className="ob-hello-title">
                {draft.materials.length ? t('world.hello.ready') : t('world.hello.wait')}
              </div>
              <div className="soft" style={{ lineHeight: 1.85, fontSize: 13.5 }}>
                {draft.materials.length ? (
                  <>
                    {t('world.hello.leftBefore')}
                    <span className="bold">{draft.materials.length}</span>
                    {t('world.hello.leftMid')}
                    <span className="bold">{t('world.hello.understood')}</span>
                    {t('world.hello.leftAfter')}
                  </>
                ) : (
                  <>
                    {t('world.hello.noneBefore')}
                    <span className="bold">{t('world.hello.understood')}</span>
                    {t('world.hello.noneAfter')}
                  </>
                )}
              </div>
            </div>
          )}

          {hasUnderstanding && (
            <div className="ob-card">
              <div className="ob-card-head">
                <span className="ob-step">{t('world.step.understanding')}</span>
                <button
                  className="btn xs ghost"
                  style={{ marginLeft: 'auto' }}
                  disabled={!!busy}
                  onClick={() => doIntake('continue')}
                >
                  <IcRefresh size={13} /> {t('world.btn.reread')}
                </button>
              </div>
              <MarkdownView content={draft.understanding} compact />
              {draft.observations.length > 0 && (
                <div className="ob-obs">
                  <div className="bold tiny" style={{ marginBottom: 4 }}>
                    {t('world.understanding.observations')}
                  </div>
                  {draft.observations.map((o, i) => (
                    <div key={i} className="ob-obs-row">
                      · {o}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {draft.questions.length > 0 && (
            <div className="ob-card">
              <div className="ob-card-head">
                <span className="ob-step">{t('world.step.questions', { n: draft.round })}</span>
                <span className="muted tiny" style={{ marginLeft: 'auto' }}>
                  {t('world.qa.answered', {
                    done: draft.questions.filter((q) => q.answer.trim() || q.delegated).length,
                    total: draft.questions.length,
                  })}
                </span>
              </div>
              <div className="muted tiny" style={{ marginBottom: 10, lineHeight: 1.7 }}>
                {t('world.qa.hint')}
              </div>
              {draft.questions.map((q) => (
                <QuestionRow
                  key={q.id}
                  q={q}
                  suggestBusy={suggestBusyFor === q.id}
                  onRefreshSuggest={() => void refreshSuggest(q.id)}
                  onChange={(patch) =>
                    update({
                      questions: draft.questions.map((x) => (x.id === q.id ? { ...x, ...patch } : x)),
                    })
                  }
                />
              ))}
            </div>
          )}

          {hasUnderstanding && !draft.proposal && (
            <div className="ob-card">
              <div className="ob-card-head">
                <span className="ob-step">{t('world.step.told')}</span>
                {toldList.length > 0 && (
                  <span className="pill" style={{ marginLeft: 'auto' }}>
                    {t('world.told.count', { n: toldList.length })}
                  </span>
                )}
              </div>
              <div className="muted tiny" style={{ marginBottom: 10, lineHeight: 1.7 }}>
                {t('world.told.descBefore')}
                <span className="bold">{t('world.told.descStrong')}</span>
                {t('world.told.descAfter')}
              </div>
              {toldList.length > 0 && (
                <div className="ob-told-list">
                  {toldList.map((td) => (
                    <div key={td.id} className="ob-told">
                      <div className="grow" style={{ minWidth: 0, whiteSpace: 'pre-wrap' }}>
                        {td.text}
                      </div>
                      <button
                        className="ob-ico-btn"
                        title={t('world.btn.deleteThis')}
                        style={{ flexShrink: 0, alignSelf: 'flex-start' }}
                        onClick={() => removeTold(td.id)}
                      >
                        <IcTrash size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                className="textarea"
                style={{ minHeight: 62, fontSize: 13 }}
                value={toldInput}
                placeholder={t('world.told.placeholder')}
                onChange={(e) => setToldInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitTold();
                }}
              />
              <button
                className="btn sm mt8"
                disabled={!toldInput.trim()}
                onClick={submitTold}
              >
                <IcPlus size={13} /> {t('world.btn.remember')}
                <span className="muted tiny" style={{ marginLeft: 4 }}>
                  Ctrl+Enter
                </span>
              </button>
            </div>
          )}

          {draft.proposal && (
            <ProposalReview
              proposal={draft.proposal}
              revisions={draft.revisions}
              busy={!!busy}
              onChange={patchProposal}
            />
          )}

          {busy && (
            <div className="ob-card row" style={{ gap: 10, alignItems: 'center' }}>
              <div className="spinner dark" />
              <div className="soft small">{busy}</div>
            </div>
          )}

          {error && (
            <div className="banner danger">
              <IcWarn size={16} />
              <div style={{ wordBreak: 'break-word' }}>{error}</div>
            </div>
          )}

          {draft.proposal && (
            <div className="ob-card">
              <div className="ob-card-head">
                <span className="ob-step">{t('world.step.revise')}</span>
              </div>
              <div className="muted tiny" style={{ marginBottom: 8, lineHeight: 1.7 }}>
                {t('world.revise.hint')}
              </div>
              <textarea
                className="textarea"
                style={{ minHeight: 62, fontSize: 13 }}
                value={reviseText}
                placeholder={t('world.revise.placeholder')}
                onChange={(e) => setReviseText(e.target.value)}
              />
              <div className="row mt8" style={{ gap: 8 }}>
                <button className="btn sm" disabled={!!busy} onClick={doRevise}>
                  <IcRefresh size={13} /> {t('world.btn.revise')}
                </button>
                {draft.revisions.length > 0 && (
                  <span className="muted tiny" style={{ alignSelf: 'center' }}>
                    {t('world.revise.count', { n: draft.revisions.length })}
                  </span>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* ---------------- 底部动作条 ---------------- */}
      <footer className="ob-foot">
        <div className="grow small soft">
          {draft.proposal
            ? t('world.foot.proposalReady', {
                total: draft.proposal.entries.length,
                included: includedCount,
              })
            : hasUnderstanding
              ? draft.questions.length
                ? answeredAll
                  ? t('world.foot.allAnswered')
                  : t('world.foot.answerFirst')
                : t('world.foot.enough')
              : t('world.foot.putMaterials')}
        </div>

        {!hasUnderstanding && (
          <button className="btn primary" disabled={!!busy} onClick={() => doIntake('first')}>
            <IcSparkles size={14} /> {t('world.btn.readOnce')}
          </button>
        )}

        {hasUnderstanding && draft.questions.length > 0 && (
          <>
            <button className="btn sm" disabled={!!busy} onClick={() => doIntake('continue')}>
              {t('world.btn.answerContinue')}
            </button>
            <button className="btn primary" disabled={!!busy} onClick={doProposal}>
              {t('world.btn.writeDraft')}
            </button>
          </>
        )}

        {hasUnderstanding && !draft.questions.length && !draft.proposal && (
          <>
            <button className="btn sm" disabled={!!busy} onClick={() => doIntake('more')}>
              {t('world.btn.askMore')}
            </button>
            <button className="btn primary" disabled={!!busy} onClick={doProposal}>
              <IcSparkles size={14} /> {t('world.btn.genProposal')}
            </button>
          </>
        )}

        {draft.proposal && !confirmOpen && (
          <button className="btn primary" disabled={!!busy} onClick={() => setConfirmOpen(true)}>
            <IcCheck size={14} /> {t('world.btn.confirmCreate')}
          </button>
        )}

        {draft.proposal && confirmOpen && (
          <div className="ob-confirm">
            <div className="bold small" style={{ marginBottom: 6 }}>
              {t('world.confirm.title')}
            </div>
            {draft.proposal.openQuestions.length ? (
              <ul style={{ margin: '0 0 8px', paddingLeft: 18 }}>
                {draft.proposal.openQuestions.map((q, i) => (
                  <li key={i} className="small">
                    {q}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="small soft" style={{ marginBottom: 8 }}>
                {t('world.confirm.noOpenQuestions')}
              </div>
            )}
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn sm ghost" onClick={() => setConfirmOpen(false)}>
                {t('world.btn.reviseMore')}
              </button>
              <button className="btn success sm" disabled={!!busy} onClick={confirmCreate}>
                <IcCheck size={14} /> {t('world.btn.confirmNow', { name: draft.proposal.name })}
              </button>
            </div>
          </div>
        )}
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function warningsToToast(msgs: string[], toast: ReturnType<typeof useToast>, t: TFunc) {
  if (!msgs.length) return;
  toast.warn(
    msgs.slice(0, 3).join(t('world.toast.warnJoin')) +
      (msgs.length > 3 ? t('world.toast.warnMore', { n: msgs.length }) : ''),
  );
}

const KIND_META: Record<DraftMaterial['kind'], { icon: string }> = {
  file: { icon: '📄' },
  text: { icon: '✍️' },
  rule: { icon: '📐' },
  image: { icon: '🖼' },
};

function MaterialRow({
  m,
  noteOpen,
  onToggleNote,
  onNote,
  onRemove,
}: {
  m: DraftMaterial;
  noteOpen: boolean;
  onToggleNote: () => void;
  onNote: (v: string) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const meta = KIND_META[m.kind];
  return (
    <div className={`ob-mat ${m.warning ? 'has-warn' : ''}`}>
      <div className="ob-mat-main">
        {m.thumb ? (
          <img src={m.thumb} className="ob-mat-thumb" alt="" />
        ) : (
          <span className="ob-mat-ico">{meta.icon}</span>
        )}
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="ob-mat-name" title={m.name}>
            {m.name}
          </div>
          <div className="muted tiny">
            {m.kind === 'image'
              ? t('world.material.imageLabel')
              : t('common.charCount', { n: m.chars ?? m.text.length })}
            {m.size && m.kind === 'image'
              ? t('world.material.sizeSuffix', { size: humanSize(m.size) })
              : ''}
            {m.note ? t('world.material.noteSuffix') : ''}
          </div>
        </div>
        <button className="ob-ico-btn" title={t('world.material.addNote')} onClick={onToggleNote}>
          ✎
        </button>
        <button className="ob-ico-btn" title={t('common.remove')} onClick={onRemove}>
          <IcTrash size={13} />
        </button>
      </div>
      {m.warning && <div className="ob-mat-warn">{m.warning}</div>}
      {noteOpen && (
        <input
          className="input"
          style={{ marginTop: 6, fontSize: 12.5 }}
          autoFocus
          defaultValue={m.note ?? ''}
          placeholder={
            m.kind === 'image'
              ? t('world.material.noteImagePlaceholder')
              : t('world.material.notePlaceholder')
          }
          onBlur={(e) => {
            onNote(e.target.value);
            onToggleNote();
          }}
        />
      )}
    </div>
  );
}

function QuestionRow({
  q,
  suggestBusy,
  onRefreshSuggest,
  onChange,
}: {
  q: DraftQuestion;
  suggestBusy: boolean;
  onRefreshSuggest: () => void;
  onChange: (patch: Partial<DraftQuestion>) => void;
}) {
  const t = useT();
  return (
    <div className="ob-q">
      <div className="ob-q-title">{q.question}</div>
      {q.why && <div className="muted tiny" style={{ marginTop: 2 }}>{q.why}</div>}

      <div className="row" style={{ gap: 6, marginTop: 8, alignItems: 'center' }}>
        <span className="muted tiny">{t('world.qa.suggestLabel')}</span>
        <button
          className="btn xs ghost"
          data-role="ob-suggest-refresh"
          title={t('world.qa.suggestRefresh')}
          disabled={suggestBusy}
          onClick={onRefreshSuggest}
        >
          <IcRefresh size={12} />
          {suggestBusy ? t('world.qa.suggestBusy') : t('world.qa.suggestRefresh')}
        </button>
      </div>

      {q.suggest.length > 0 && (
        <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
          {q.suggest.map((s, i) => (
            <button
              key={i}
              className="ob-suggest"
              onClick={() => onChange({ answer: s, delegated: false })}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="row mt8" style={{ gap: 8, alignItems: 'flex-start' }}>
        <textarea
          className="textarea"
          style={{ minHeight: 44, fontSize: 13 }}
          value={q.delegated ? '' : q.answer}
          placeholder={q.delegated ? t('world.qa.delegatedPlaceholder') : t('world.qa.answerPlaceholder')}
          disabled={q.delegated}
          onChange={(e) => onChange({ answer: e.target.value })}
        />
        <button
          className={`btn sm ${q.delegated ? 'primary' : ''}`}
          style={{ flexShrink: 0 }}
          onClick={() => onChange({ delegated: !q.delegated, answer: '' })}
        >
          {q.delegated ? t('world.qa.delegatedBtn') : t('world.qa.letAiBtn')}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ProposalReview({
  proposal,
  revisions,
  busy,
  onChange,
}: {
  proposal: WorldProposal;
  revisions: string[];
  busy: boolean;
  onChange: (patch: Partial<WorldProposal>) => void;
}) {
  const t = useT();
  const [openEntry, setOpenEntry] = useState<string | null>(null);

  const patchEntry = (id: string, patch: Partial<WorldProposal['entries'][number]>) =>
    onChange({ entries: proposal.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) });

  const included = proposal.entries.filter((e) => e.included).length;
  const byCat = useMemo(() => {
    const map = new Map<string, WorldProposal['entries']>();
    for (const e of proposal.entries) {
      const key = e.category || t('world.proposal.uncategorized');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return map;
  }, [proposal.entries, t]);

  return (
    <div className="ob-card">
      <div className="ob-card-head">
        <span className="ob-step">{t('world.step.proposal')}</span>
        <span className="pill low">{t('world.proposal.included', { included, total: proposal.entries.length })}</span>
        {revisions.length > 0 && <span className="pill">{t('world.proposal.version', { n: revisions.length + 1 })}</span>}
      </div>

      {proposal.rationale && (
        <div className="review-rationale" style={{ marginBottom: 14 }}>
          <div className="bold tiny" style={{ marginBottom: 3 }}>
            {t('world.proposal.rationale')}
          </div>
          {proposal.rationale}
        </div>
      )}

      {/* 世界名片 */}
      <div className="ob-world-card" style={{ borderLeftColor: proposal.themeColor }}>
        <input
          className="ob-world-name"
          value={proposal.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <input
          className="ob-world-tag"
          value={proposal.tagline}
          placeholder={t('world.editor.tagline')}
          onChange={(e) => onChange({ tagline: e.target.value })}
        />
        <div className="row wrap mt8" style={{ gap: 6 }}>
          <div style={{ width: 168 }}>
            <input
              className="input"
              style={{ fontSize: 12.5 }}
              value={proposal.genre}
              placeholder={t('world.proposal.genrePlaceholder')}
              onChange={(e) => onChange({ genre: e.target.value })}
            />
          </div>
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => onChange({ themeColor: c })}
              style={{
                width: 22,
                height: 22,
                borderRadius: 6,
                background: c,
                cursor: 'pointer',
                border: proposal.themeColor === c ? '2px solid var(--text)' : '2px solid transparent',
              }}
            />
          ))}
        </div>
      </div>

      <Field label={t('world.editor.summary')}>
        <textarea
          className="textarea"
          style={{ minHeight: 88, fontSize: 13 }}
          value={proposal.summary}
          onChange={(e) => onChange({ summary: e.target.value })}
        />
      </Field>

      <Field label={t('world.proposal.tone')}>
        <textarea
          className="textarea"
          style={{ minHeight: 62, fontSize: 13 }}
          value={proposal.tone}
          onChange={(e) => onChange({ tone: e.target.value })}
        />
      </Field>

      <Field label={t('world.proposal.rules')}>
        {proposal.rules.map((r, i) => (
          <div key={i} className="row" style={{ gap: 6, marginBottom: 6 }}>
            <input
              className="input"
              style={{ fontSize: 13 }}
              value={r}
              onChange={(e) =>
                onChange({ rules: proposal.rules.map((x, j) => (j === i ? e.target.value : x)) })
              }
            />
            <button
              className="ob-ico-btn"
              onClick={() => onChange({ rules: proposal.rules.filter((_, j) => j !== i) })}
            >
              <IcTrash size={13} />
            </button>
          </div>
        ))}
        <button className="btn xs" onClick={() => onChange({ rules: [...proposal.rules, ''] })}>
          <IcPlus size={12} /> {t('world.btn.addRule')}
        </button>
      </Field>

      {/* 条目 */}
      <div className="divider" />
      <div className="bold small" style={{ marginBottom: 8 }}>
        {t('world.proposal.entries', { n: proposal.categories.length })}
      </div>

      {[...byCat.entries()].map(([cat, items]) => (
        <div key={cat} style={{ marginBottom: 12 }}>
          <div className="ob-cat-row">
            <span className="pill">
              {proposal.categories.find((c) => c.name === cat)?.icon ?? '📁'} {cat}
            </span>
            <span className="muted tiny">{t('world.proposal.itemCount', { n: items.length })}</span>
          </div>
          {items.map((e) => (
            <div key={e.id} className={`ob-entry ${e.included ? '' : 'off'}`}>
              <div className="ob-entry-head">
                <input
                  type="checkbox"
                  checked={e.included}
                  onChange={(ev) => patchEntry(e.id, { included: ev.target.checked })}
                />
                <input
                  className="ob-entry-title"
                  value={e.title}
                  onChange={(ev) => patchEntry(e.id, { title: ev.target.value })}
                />
                <button
                  className="btn xs ghost"
                  onClick={() => setOpenEntry(openEntry === e.id ? null : e.id)}
                >
                  {openEntry === e.id ? t('common.collapse') : t('common.expand')}
                </button>
                <button
                  className="ob-ico-btn"
                  title={t('world.btn.deleteEntry')}
                  onClick={() => onChange({ entries: proposal.entries.filter((x) => x.id !== e.id) })}
                >
                  <IcTrash size={13} />
                </button>
              </div>
              <div className="ob-entry-sum">{e.summary}</div>
              {openEntry === e.id && (
                <div className="mt8">
                  <div className="row wrap" style={{ gap: 6, marginBottom: 6 }}>
                    <select
                      className="select"
                      style={{ width: 150, fontSize: 12.5 }}
                      value={e.category}
                      onChange={(ev) => patchEntry(e.id, { category: ev.target.value })}
                    >
                      {proposal.categories.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    {e.tags.map((t, i) => (
                      <span key={i} className="tag">
                        {t}
                      </span>
                    ))}
                  </div>
                  <textarea
                    className="textarea"
                    style={{ minHeight: 66, fontSize: 12.5 }}
                    value={e.summary}
                    placeholder={t('world.proposal.summaryPlaceholder')}
                    onChange={(ev) => patchEntry(e.id, { summary: ev.target.value })}
                  />
                  <textarea
                    className="textarea mono mt8"
                    style={{ minHeight: 190, fontSize: 12 }}
                    value={e.content}
                    onChange={(ev) => patchEntry(e.id, { content: ev.target.value })}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      ))}

      {/* 关系 */}
      {proposal.relations.length > 0 && (
        <>
          <div className="divider" />
          <div className="bold small" style={{ marginBottom: 8 }}>
            {t('world.proposal.relations', { n: proposal.relations.length })}
          </div>
          {proposal.relations.map((r, i) => (
            <label key={i} className="ob-rel">
              <input
                type="checkbox"
                checked={r.included}
                onChange={(e) =>
                  onChange({
                    relations: proposal.relations.map((x, j) =>
                      j === i ? { ...x, included: e.target.checked } : x,
                    ),
                  })
                }
              />
              <span className="grow">
                <span className="bold">{r.from}</span>
                <span className="muted"> —{r.type}→ </span>
                <span className="bold">{r.to}</span>
                {r.note && <span className="muted tiny"> · {r.note}</span>}
              </span>
            </label>
          ))}
        </>
      )}

      {/* 待定 */}
      {proposal.openQuestions.length > 0 && (
        <>
          <div className="divider" />
          <div className="bold small" style={{ marginBottom: 6 }}>
            {t('world.proposal.openQuestions')}
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.8, lineHeight: 1.8 }}>
            {proposal.openQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
          <div className="muted tiny mt8">
            {t('world.proposal.openQuestionsHint')}
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      {children}
    </div>
  );
}
