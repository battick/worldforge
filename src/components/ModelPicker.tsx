import { useEffect, useMemo, useRef, useState } from 'react';
import type { AISettings } from '../types';
import { useT } from '../i18n';
import { IcCheck, IcChevron, IcClose, IcRefresh, IcSearch } from './icons';
import { presetOf, rememberModel } from '../ai/providers';
import {
  buildChoices,
  fetchModels,
  readModelCache,
  writeModelCache,
  type ModelChoice,
  type ModelInfo,
} from '../ai/models';
import {
  PROBE_LIMIT,
  PROBE_LIMIT_MIN,
  clearProbeCache,
  planProbe,
  probeCandidates,
  probeTitle,
  readProbeCache,
  resolveProbeLimit,
  runProbe,
  toneOf,
  writeProbeCache,
  type ProbeMap,
} from '../ai/probe';

interface Props {
  settings: AISettings;
  onChange: (patch: Partial<AISettings>) => void;
}

/** 「上次获取：3 小时前」 */
function useAgoText() {
  const t = useT();
  return (at: number): string => {
    const s = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (s < 90) return t('ai.models.agoJustNow');
    if (s < 3600) return t('ai.models.agoMinutes', { n: Math.round(s / 60) });
    if (s < 86400) return t('ai.models.agoHours', { n: Math.round(s / 3600) });
    return t('ai.models.agoDays', { n: Math.round(s / 86400) });
  };
}

/**
 * 型号选择器。
 *
 * **为什么不是一个 `<select>`。** 拉回来的清单动辄一两百条（OpenAI、OpenRouter 那种
 * 聚合站更多），`<select>` 里翻是不现实的；而候选又不能只有「拉到的」——
 * 自建网关的私有型号、厂商还没列出来的新模型，都得能手填。所以做成
 * **输入框 + 可搜索面板**：框里永远能直接敲，面板负责「从一大堆里挑一个」。
 *
 * 面板打开时会自动去拉一次（已有缓存就不拉），因为作者点开它的意图就是
 * 「让我看看有哪些」。拉失败时把厂商返回的原因原样摆出来 —— 那是排查的唯一线索。
 *
 * **拉完还会自动探一遍可用性**（见 `ai/probe.ts`）。清单只是账面，能不能真的跑通是另一回事：
 * 中转站的清单里常常躺着几个一用就回 `402 余额不足` 的型号，而作者是在已经坐下开始写之后
 * 才发现。结论就画在每一项左边那条小竖条上，鼠标停上去看原因。
 */
export function ModelPicker({ settings, onChange }: Props) {
  const t = useT();
  const agoText = useAgoText();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [fetched, setFetched] = useState<ModelInfo[]>([]);
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  /* ---- 可用性探测 ---- */
  const [probes, setProbes] = useState<ProbeMap>({});
  const [probing, setProbing] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  /** 上限输入框的草稿。`null` = 显示设置里的那个数；不是 null = 作者正在敲 */
  const [limitDraft, setLimitDraft] = useState<string | null>(null);
  /** 这一批正在探的型号。列表要据此把还没出结果的项画成「呼吸中」 */
  const [batch, setBatch] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  /**
   * 探测结果与运行状态都留一份 ref。
   *
   * 理由和 store 那条一样：回调里的 `probes` 是渲染期闭包抓的那一份，连点/连探时早就过期；
   * 判断「这条探过没有」必须读**当下这张表**，否则同一条会被探第二遍。
   */
  const probesRef = useRef<ProbeMap>({});
  const probingRef = useRef(false);

  const stopProbe = () => {
    abortRef.current?.abort();
  };

  // 换服务商 / 换地址就是换了一份清单，缓存跟着换；顺手把跑着的探测停掉
  const { provider, baseUrl } = settings;
  useEffect(() => {
    abortRef.current?.abort();
    probingRef.current = false;
    setProbing(false);
    setBatch([]);
    const c = readModelCache({ ...settings, provider, baseUrl });
    setFetched(c?.models ?? []);
    setAt(c?.at ?? 0);
    setErr(null);
    const p = readProbeCache({ ...settings, provider, baseUrl });
    probesRef.current = p;
    setProbes(p);
    setNote(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, baseUrl, settings.apiKey]);

  const doFetch = async () => {
    if (!settings.baseUrl) {
      setErr(t('ai.err.noBaseUrl'));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const list = await fetchModels(settings);
      setFetched(list);
      setAt(writeModelCache(settings, list).at);
      // 刚拉回来的就是最新的一份清单，直接接着探（旧结果按 key/地址隔离，不会串）
      void startProbe(list);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** 跑一轮探测。**每次只允许一轮在跑**：新一轮开始前先把上一轮停掉，否则两边会互相写乱 */
  const startProbe = async (list: ModelInfo[], opts: { force?: boolean } = {}) => {
    if (!list.length || !settings.baseUrl) return;
    if (opts.force) {
      clearProbeCache(settings);
      probesRef.current = {};
      setProbes({});
    }
    const plan = planProbe(list, probesRef.current, resolveProbeLimit(settings));
    if (!plan.ids.length) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    probingRef.current = true;
    setProbing(true);
    setNote(null);
    setDone(0);
    setTotal(plan.ids.length);
    setBatch(plan.ids);

    let n = 0;
    const out = await runProbe(settings, plan.ids, {
      signal: ac.signal,
      onOne: (id, r) => {
        n += 1;
        const next = { ...probesRef.current, [id]: r };
        probesRef.current = next;
        writeProbeCache(settings, next);
        setProbes(next);
        setDone(n);
      },
    });

    // 已经被更新的一轮顶掉了：这一轮的回执别再改界面
    if (abortRef.current !== ac) return;
    probingRef.current = false;
    setProbing(false);
    setBatch([]);
    if (out.aborted) {
      setNote(t('ai.probe.stopped', { done: n, total: plan.ids.length }));
    } else if (out.gaveUpUnreachable) {
      setNote(t('ai.probe.gaveUp'));
    }
  };

  // 打开面板：没清单就拉；有清单但还有没探过的，顺手补探
  useEffect(() => {
    if (!open || !settings.baseUrl) return;
    if (!fetched.length) {
      if (!busy) void doFetch();
      return;
    }
    if (!probingRef.current) void startProbe(fetched);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 关掉面板不清空结论（下次打开还要用），但**离场要停手** —— 让请求继续打下去
  // 既没人在看，也可能在作者已经换到别的服务商之后还在报错
  useEffect(() => {
    if (open) return;
    abortRef.current?.abort();
    probingRef.current = false;
    setProbing(false);
    setBatch([]);
  }, [open]);

  // 卸载时收干净
  useEffect(() => () => abortRef.current?.abort(), []);

  // 点外面 / 按 Esc 关掉
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choices = useMemo(
    () =>
      buildChoices({
        recent: settings.recentModels ?? [],
        builtin: presetOf(settings.provider)?.fallbackModels ?? [],
        fetched,
        query,
      }),
    [settings.recentModels, settings.provider, fetched, query],
  );
  const totalChoices = choices.recent.length + choices.fetched.length + choices.builtin.length;

  const pick = (id: string) => {
    onChange({ model: id, recentModels: rememberModel(settings.recentModels, id) });
    setOpen(false);
    setQuery('');
    // 作者挑中一个还没探过的型号 —— 这就是「选取型号时也要测一下」那一半。
    // 已经有整轮在跑时不插队：那一轮本来就会探到它，插进去只会互相 abort
    if (!probingRef.current && !probesRef.current[id]) {
      void startProbe([{ id, maybeNotChat: false }]);
    }
  };

  /** 手敲的型号也算「用过」—— 否则自建网关那种只能手填的型号永远进不了最近那组 */
  const commitTyped = () => {
    const v = settings.model.trim();
    if (v) onChange({ recentModels: rememberModel(settings.recentModels, v) });
  };

  const strip = (id: string) => {
    const r = probes[id];
    const tone = r ? toneOf(r.state) : probing && batch.includes(id) ? 'busy' : 'idle';
    return (
      <span
        className="mp-avail"
        data-role="model-avail"
        data-state={r ? r.state : 'idle'}
        data-tone={tone}
        title={r ? probeTitle(r) : probing && batch.includes(id) ? t('ai.probe.checking', { done, total }) : probeTitle(undefined)}
      />
    );
  };

  const group = (key: string, label: string, list: ModelChoice[]) =>
    list.length === 0 ? null : (
      <div className="mp-group" key={key} data-role="model-group" data-group={key}>
        <div className="mp-group-title">{label}</div>
        {list.map((c) => (
          <button
            key={c.id}
            className="mp-item"
            type="button"
            title={c.id}
            data-role="model-item"
            data-model-id={c.id}
            data-source={c.source}
            data-current={c.id === settings.model ? '1' : '0'}
            onClick={() => pick(c.id)}
          >
            {strip(c.id)}
            <span className="mp-id">{c.id}</span>
            {c.ownedBy && <span className="mp-owner">{c.ownedBy}</span>}
            {c.maybeNotChat && <span className="mp-tag">{t('ai.models.tagNotChat')}</span>}
            {c.id === settings.model && <IcCheck size={13} />}
          </button>
        ))}
      </div>
    );

  /* ---- 探测那一行的措辞 ---- */
  /**
   * 上限、以及「现在还剩多少没结论」，都**当场算**、不存 state。
   *
   * 存下来的话，作者把上限从 40 改成 200 之后，那行字还挂在上一次算出来的数字上
   * ——「一次最多探 40 个」而他明明刚填了 200，看着像设置没生效。
   *
   * 注意这里问的是 `probeCandidates(...).length`（**现在**还剩几条），不是
   * `planProbe(...).pending`（再探一轮之后还剩几条）—— 两者差一轮，用错了界面会自相矛盾。
   */
  const limit = resolveProbeLimit(settings);
  const remaining = useMemo(
    () => probeCandidates(fetched, probes).length,
    [fetched, probes],
  );
  const unlimited = !Number.isFinite(limit);

  const list = Object.values(probes);
  const okCount = list.filter((r) => r.state === 'ok').length;
  const badCount = list.filter((r) => toneOf(r.state) === 'bad' || toneOf(r.state) === 'warn').length;
  const hasResults = list.length > 0;
  const probeLine = probing
    ? t('ai.probe.checking', { done, total })
    : (note ??
      (hasResults
        ? t('ai.probe.summary', { ok: okCount, bad: badCount }) +
          (remaining
            ? ` · ${
                unlimited
                  ? t('ai.probe.moreAll', { n: remaining })
                  : t('ai.probe.more', { n: remaining, limit })
              }`
            : '')
        : null));

  /** 上限输入框：`type=number` 但值按字符串走，否则作者没法把框清空重敲 */
  const limitShown = limitDraft ?? String(settings.probeLimit ?? PROBE_LIMIT);
  const onLimitInput = (raw: string) => {
    setLimitDraft(raw);
    const n = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(n) && n >= PROBE_LIMIT_MIN) {
      onChange({ probeLimit: Math.floor(n) });
    }
  };

  return (
    <div className="mp" ref={boxRef}>
      <div className="row" style={{ gap: 6 }}>
        <div className="mp-field grow">
          <input
            className="input"
            data-role="model-input"
            value={settings.model}
            placeholder={t('settings.ai.modelPlaceholder')}
            autoComplete="off"
            onChange={(e) => onChange({ model: e.target.value })}
            onBlur={commitTyped}
          />
          {!!settings.model && (
            <button
              className="mp-clear"
              type="button"
              title={t('ai.models.clearModel')}
              data-role="model-clear"
              onClick={() => onChange({ model: '' })}
            >
              <IcClose size={12} />
            </button>
          )}
        </div>
        <button
          className={`btn ${open ? 'primary' : ''}`}
          type="button"
          data-role="model-toggle"
          onClick={() => setOpen((o) => !o)}
        >
          <IcChevron size={14} /> {t('ai.models.browse')}
        </button>
      </div>

      <div className="field-hint">{t('settings.ai.modelHint')}</div>

      {open && (
        <div className="mp-panel" data-role="model-panel">
          <div className="mp-head">
            <div className="mp-search">
              <IcSearch size={13} />
              <input
                data-role="model-search"
                value={query}
                placeholder={t('ai.models.searchPlaceholder')}
                autoFocus
                onChange={(e) => setQuery(e.target.value)}
              />
              {!!query && (
                <button className="mp-clear" type="button" onClick={() => setQuery('')}>
                  <IcClose size={12} />
                </button>
              )}
            </div>
            <button
              className="btn xs"
              type="button"
              data-role="model-refresh"
              disabled={busy || !settings.baseUrl}
              onClick={doFetch}
            >
              {busy ? <span className="spinner dark" /> : <IcRefresh size={13} />}
              {fetched.length ? t('ai.models.refresh') : t('ai.models.fetch')}
            </button>
          </div>

          <div className="mp-status" data-role="model-status">
            {err ? (
              <span className="mp-err">{err}</span>
            ) : busy ? (
              t('ai.models.fetching')
            ) : fetched.length ? (
              t('ai.models.counted', { n: fetched.length, ago: at ? agoText(at) : '' })
            ) : !settings.baseUrl ? (
              t('ai.err.noBaseUrl')
            ) : (
              t('ai.models.notFetched')
            )}
          </div>

          {fetched.length > 0 && (
            <div className="mp-tools">
              <div className="mp-probe" data-role="model-probe">
                <span className="mp-probe-text" data-role="model-probe-text">
                  {probeLine}
                </span>
                {probing ? (
                  <>
                    <span className="spinner dark" />
                    <button
                      className="btn xs"
                      type="button"
                      data-role="model-probe-stop"
                      onClick={stopProbe}
                    >
                      {t('ai.probe.stop')}
                    </button>
                  </>
                ) : (
                  <button
                    className="btn xs"
                    type="button"
                    data-role="model-probe-recheck"
                    onClick={() => void startProbe(fetched, { force: true })}
                  >
                    <IcRefresh size={13} /> {t('ai.probe.recheck')}
                  </button>
                )}
              </div>
              <div className="mp-limit" data-role="model-probe-limit">
                <label className="mp-limit-field" title={t('ai.probe.limitHint')}>
                  <span>{t('ai.probe.limitLabel')}</span>
                  <input
                    type="number"
                    className="input xs mp-limit-input"
                    data-role="model-probe-limit-input"
                    min={PROBE_LIMIT_MIN}
                    step={10}
                    value={limitShown}
                    disabled={unlimited}
                    onChange={(e) => onLimitInput(e.target.value)}
                    onBlur={() => setLimitDraft(null)}
                  />
                  <span>{t('ai.probe.limitUnit')}</span>
                </label>
                <label className="mp-limit-check" title={t('ai.probe.limitHintAll')}>
                  <input
                    type="checkbox"
                    data-role="model-probe-unlimited"
                    checked={!!settings.probeUnlimited}
                    onChange={(e) => onChange({ probeUnlimited: e.target.checked })}
                  />
                  <span>{t('ai.probe.unlimited')}</span>
                </label>
              </div>
              {/* 图例与「不限制」的代价提示同属说明文字，放一个容器里，只占一条底线 */}
              <div className="mp-legend" data-role="model-probe-legend">
                {unlimited && (
                  <div className="mp-legend-warn" data-role="model-probe-limit-warn">
                    {t('ai.probe.limitHintAll')}
                  </div>
                )}
                {t('ai.probe.hint')}
              </div>
            </div>
          )}

          <div className="mp-list">
            {group('recent', t('ai.models.groupRecent'), choices.recent)}
            {group('fetched', t('ai.models.groupFetched'), choices.fetched)}
            {group('builtin', t('ai.models.groupBuiltin'), choices.builtin)}
            {totalChoices === 0 && (
              <div className="mp-empty">{t('ai.models.noMatch', { q: query })}</div>
            )}
          </div>

          <div className="mp-foot">{t('ai.models.footHint')}</div>
        </div>
      )}
    </div>
  );
}
