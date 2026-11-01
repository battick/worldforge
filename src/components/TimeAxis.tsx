/**
 * 时间轴 —— 「关系与时间」里的那一支。
 *
 * 主张：**排一条时间轴，第一步不该是填表。**
 *
 * 右边那块「还没排进去」，是这个世界里所有还没上轴的条目。把其中一条**拖到轴上**，
 * 它就在那个位置上了 —— 位置就是它的时间；点一下条目、再点轴上任意一处，也一样。
 * 要说得更准（「元年」「涨潮纪四十年」、一段、至今、纪元、分量、精确位置），
 * 选中它，在右边面板里直接改，改完立刻生效 —— 不必翻进条目编辑器翻到「时间」那一页。
 *
 * 轴上的东西仍然是**条目本身**（设了时间的那些，见 `Entry.time`），不是另一套「事件」实体：
 *   · 节点的名字就是条目名，点节点能开条目改 —— 一个东西只有一份；
 *   · 轴上不提供「删除」：删条目是条目库的事，这里只管「它落在时间上的哪儿」。
 *
 * 时间存两样东西（见 types.ts 的 EntryTime）：给眼睛看的 `from`/`to` 文本，和给轴用的 `at`。
 * 拖进来的条目**只有位置、没有文本** —— 这恰恰是诚实的：先后已经定死了，说法可以后补。
 * 所以这种节点的圈画成虚线，直到作者真的写下「元年」这三个字。界面绝不替他编一个日期出来。
 *
 * 两条轴距（沿用旧版）：
 *   · 按数值比例：间距反映 `at` 的差（历史有疏有密，这一点看得见）；
 *   · 均匀铺开：一条挨一条，用在「早期全挤在左边」的时候。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useToast } from './Toast';
import { Empty } from './Modal';
import {
  IcPlus,
  IcRefresh,
  IcLink,
  IcTrash,
  IcEdit,
  IcClock,
  IcClose,
  IcSearch,
  IcSparkles,
  IcTimeline,
} from './icons';
import { useT } from '../i18n';
import type { Entry, EntryTime, ID, ReviewItem, TimeWeight } from '../types';
import { TIME_WEIGHTS } from '../types';
import { clamp } from '../lib/id';
import { useTimelineLayout } from './useTimelineLayout';
import { useTimelineGuess } from './useTimelineGuess';

/**
 * 纪元配色 —— 同一段纪元共用一个色，图例、色带、列表里的点都用它。
 *
 * 导出是刻意的：编年视图（ChronicleView）画的是**同一条轴**，{@link eraColorOf}
 * 必须两处同源 —— 各自维护一份调色板，迟早会出现「同一段纪元在两张图上颜色不一样」。
 */
export const ERA_PALETTE = [
  '#2f6fb0',
  '#7c5cbf',
  '#17805a',
  '#b4720d',
  '#b5352b',
  '#0e7c8a',
  '#a1457b',
  '#4a6b2f',
];

const H = 300;
/** 主轴所在的 y */
const AXIS_Y = 142;
/** 轴两端的留白：最靠边的条目也不贴边，两端还得放得下「更早 / 更晚」 */
const PAD = 72;
/** 纪元色带的上下边界（包住轴上下的标签，但不吃到底部的添加带） */
const BAND_TOP = 44;
const BAND_BOTTOM = 216;
/** 底部「点这里加一条」的带子 */
const LANE_H = 40;
const LANE_Y = H - LANE_H - 10;

const NODE_R: Record<TimeWeight, number> = { major: 9, normal: 6.5, minor: 4.5 };
const WEIGHTS: TimeWeight[] = ['major', 'normal', 'minor'];
/** 疏密：把轴拉长，容器横向滚动。挤在一起时靠它看清单个节点 */
const ZOOMS = [1, 1.5, 2.5];
/** 「一段」没给终点数值时，横杠画这么长 —— 固定长度，且画成虚线 */
const SPAN_STUB = 72;
/** 池子一次最多列这么多行 —— 再多就该用搜索，而不是一路滚下去 */
const POOL_MAX = 60;

type ScaleMode = 'prop' | 'even';

const round1 = (n: number) => Math.round(n * 10) / 10;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** 同一位置上的第 j 个节点往哪儿让（0 = 就在轴上，之后上下交替） */
function laneOffset(j: number): number {
  if (j === 0) return 0;
  const k = Math.ceil(j / 2);
  return j % 2 === 1 ? -22 * k : 22 * k;
}

/**
 * 标签大概占多宽 —— 用来避免**两行字压在一起**。
 * 按字符估宽（汉字一个 ≈ 11.5px、其余 ≈ 6.2px）足够用：这里只是要一个「有没有撞上」的判据，
 * 精确测量得把 SVG 量一遍，代价远大于收益。
 */
function labelWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? 11.5 : 6.2;
  return w;
}

/**
 * 最多让这么深。轴高 300、轴在 142，再往下就压到底部那条「点这里添一条」的带子了。
 * 超过这个深度说明这几条本来就挤得看不清 —— 该做的是缩放或改位置，不是无限往下堆。
 */
const MAX_LANES = 6;

interface Props {
  onOpenEntry?: (id: string) => void;
  /** 没东西可排时，给它一个台阶去关系视图看看 */
  onGoRelations?: () => void;
  /** AI 排版方案已经躺在审查队列里了 —— 提了案，就得让人一眼看到案子在哪 */
  onGoReview?: () => void;
}

export function TimeAxis({ onOpenEntry, onGoRelations, onGoReview }: Props) {
  const store = useStore();
  const toast = useToast();
  const t = useT();

  const [selId, setSelId] = useState<ID | null>(null);
  const [scale, setScale] = useState<ScaleMode>('prop');
  const [onlyMajor, setOnlyMajor] = useState(false);
  const [eraFilter, setEraFilter] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [hoverId, setHoverId] = useState<ID | null>(null);
  const [ghostX, setGhostX] = useState<number | null>(null);

  /* ---------- 把条目放进轴：拖过去，或者点两下 ---------- */
  /** 正从池子里往外拖的那条：跟着指针的小卡片 + 它此刻落在轴的哪个 x（没在轴上就是 null） */
  const [carry, setCarry] = useState<{
    id: ID;
    title: string;
    x: number;
    y: number;
    axisX: number | null;
  } | null>(null);
  /** 点了池子里的一条，等着在轴上点一下落位 */
  const [pendingId, setPendingId] = useState<ID | null>(null);
  /** 池子里的搜索词 */
  const [poolQ, setPoolQ] = useState('');
  /** 这一次按下之后指针有没有真的移动过 —— 用它把「拖」和「点」分开 */
  const movedRef = useRef(false);

  const dragRef = useRef<{ id: ID; startX: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState<ID | null>(null);
  const [dragAt, setDragAt] = useState<number | null>(null);
  const dragAtRef = useRef<number | null>(null);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [boxW, setBoxW] = useState(0);

  /** 轴上的东西 = 设了时间的条目 */
  const all = store.timedEntries;

  const catName = useMemo(
    () => new Map(store.categories.map((c) => [c.id, c.name])),
    [store.categories],
  );

  /** 还没排进去的 = 这个世界里所有没设时间的条目（和轴上那些加起来正好是全部） */
  const pool = useMemo(() => {
    const q = poolQ.trim().toLowerCase();
    const hit = (e: Entry) =>
      !q ||
      e.title.toLowerCase().includes(q) ||
      e.aliases.some((a) => a.toLowerCase().includes(q)) ||
      e.tags.some((g) => g.toLowerCase().includes(q));
    const order = new Map(store.categories.map((c) => [c.id, c.order]));
    return store.entries
      .filter((e) => !e.time && hit(e))
      .sort(
        (a, b) =>
          (order.get(a.categoryId) ?? 0) - (order.get(b.categoryId) ?? 0) ||
          a.title.localeCompare(b.title),
      );
  }, [store.entries, store.categories, poolQ]);

  /* ---------- 轴有多宽：跟着容器走，疏密再乘一个倍数 ---------- */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setBoxW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = Math.round(Math.max(600, boxW) * zoom);
  const INNER = Math.max(1, W - PAD * 2);

  /* ---------- 纪元：按第一次出现的顺序定色，位置越靠前色越早 ---------- */
  const eras = useMemo(() => {
    const seen: string[] = [];
    for (const e of all) {
      const era = (e.time?.era ?? '').trim();
      if (era && !seen.includes(era)) seen.push(era);
    }
    return seen;
  }, [all]);
  const eraColor = useCallback(
    (era: string) => {
      const i = eras.indexOf(era.trim());
      return i < 0 ? 'var(--text-dim)' : ERA_PALETTE[i % ERA_PALETTE.length];
    },
    [eras],
  );

  /* ---------- 筛选只影响「给谁画」，不影响轴的比例 ----------
   * 用过滤后的条目去算比例的话，筛掉一半、剩下的会整条跳开 ——
   * 那就不是在读同一条时间轴，而是在读另一条。 */
  const list = useMemo(
    () =>
      all.filter(
        (e) =>
          (!onlyMajor || e.time?.weight === 'major') &&
          (!eraFilter || (e.time?.era ?? '').trim() === eraFilter),
      ),
    [all, onlyMajor, eraFilter],
  );

  const atOf = (e: Entry) => e.time?.at ?? 0;

  const domain = useMemo(() => {
    if (!all.length) return { lo: 0, hi: 10 };
    const min = atOf(all[0]);
    const max = atOf(all[all.length - 1]);
    // 线性映射：点哪儿就是哪儿，刻度上的数字与点击位置一一对应。
    // 只有一条时轴会退化成一个点，这时左右各撑开十格，别让它变成一根针。
    if (max > min) return { lo: min, hi: max };
    return { lo: min - 10, hi: min + 10 };
  }, [all]);

  /** 位置数值 → 轴上的 x（比例模式用） */
  const xOfOrder = useCallback(
    (order: number) => {
      const span = domain.hi - domain.lo;
      if (span <= 0) return PAD + INNER / 2;
      return PAD + ((order - domain.lo) / span) * INNER;
    },
    [domain, INNER],
  );

  /** 序号 → 轴上的 x（均匀模式用） */
  const xOfIndex = useCallback(
    (i: number) => (list.length <= 1 ? PAD + INNER / 2 : PAD + (i * INNER) / (list.length - 1)),
    [list.length, INNER],
  );

  /**
   * 轴上的 x → 位置数值。点轴、拖节点、从池子里拖进来，三条入口算出同一个答案。
   *
   * 两端的 2% 是「往后 / 往前添一条」：轴已经被现有条目占满，
   * 点最右边如果还落在线内，新条目就会和末尾那条叠在一起 ——
   * 作者的意思显然是「再往后一条」，所以这里给它一个明确的步长。
   */
  const atAt = useCallback(
    (x: number) => {
      const ratio = clamp((x - PAD) / INNER, 0, 1);
      if (scale === 'even') {
        const n = list.length;
        if (!n) return 10;
        // 均匀模式下轴被切成 n+1 个空隙：落在哪两个之间，就取它们的中点
        const k = Math.round(ratio * (n + 1));
        if (k <= 0) return round1(atOf(list[0]) - 10);
        if (k >= n + 1) return round1(atOf(list[n - 1]) + 10);
        return round1((atOf(list[k - 1]) + atOf(list[k])) / 2);
      }
      const span = domain.hi - domain.lo;
      const step = span > 0 ? span * 0.25 : 10;
      if (all.length && ratio >= 0.98) return round1(domain.hi + step);
      if (all.length && ratio <= 0.02) return round1(domain.lo - step);
      return round1(domain.lo + ratio * span);
    },
    [scale, list, domain, INNER, all.length],
  );

  const atAtRef = useRef(atAt);
  atAtRef.current = atAt;

  /* ---------- 摆位：先算出 x，再把会撞上的名字上下让开 ----------
   * 只按「位置数值完全相同」去避让是不够的：作者写小数时，
   * 9.99 与 10 是两条，画出来却叠在同一处 —— 看着像只有一条。
   * 但只按固定像素分槽也不够：两条相隔 68 像素，节点分得开，**名字却会压在一起**
   * （名字有十几个字宽）。所以这里按「标签占多宽」做首次适配：
   * 从轴往上、往下依次找第一条放得下的槽，放不下就再让一层。
   *
   * 参与占位的只有**默认就会显示名字**的节点（重大 / 一般）。悬停与选中是临时的，
   * 拿它们算分槽会让鼠标一划过整条轴就跳 —— 所以宁可让悬停时的小字偶尔压一下。 */
  const placed = useMemo(() => {
    let tied = false;
    const laneEnd: number[] = [];
    const items = list.map((en, i) => {
      const x = scale === 'even' ? xOfIndex(i) : xOfOrder(atOf(en));
      const tm = en.time!;
      const raw = (tm.from ? `${tm.from} · ` : '') + (en.title || t('common.untitled'));
      const occupies =
        tm.weight === 'major' || (tm.weight === 'normal' && list.length <= 20);
      const half = occupies ? labelWidth(clip(raw, 18)) / 2 + 8 : 10;
      let lane = laneEnd.findIndex((end) => x - half >= end);
      if (lane < 0) lane = Math.min(laneEnd.length, MAX_LANES);
      laneEnd[lane] = x + half;
      if (lane > 0) tied = true;
      return { en, x, lane, off: laneOffset(lane) };
    });
    return { items, tied };
  }, [list, scale, xOfIndex, xOfOrder, t]);

  /* ---------- 刻度：比例模式下把真实数值标在轴下 ---------- */
  const ticks = useMemo(() => {
    if (scale !== 'prop' || all.length < 2) return [];
    const min = atOf(all[0]);
    const max = atOf(all[all.length - 1]);
    if (max === min) return [];
    return [0, 0.25, 0.5, 0.75, 1].map((r) => {
      const v = round1(min + (max - min) * r);
      return { x: xOfOrder(v), label: String(v) };
    });
  }, [scale, all, xOfOrder]);

  const sel = useMemo(() => all.find((e) => e.id === selId) ?? null, [all, selId]);
  const nameOf = useCallback(
    (id: ID) => store.entries.find((e) => e.id === id)?.title || t('common.untitled'),
    [store.entries, t],
  );

  /** 有没有哪条只有位置、还没写下时间文本 —— 图例要有这一句，不然虚线没人看得懂 */
  const hasNoTimeText = useMemo(
    () => list.some((e) => !(e.time?.from ?? '').trim()),
    [list],
  );

  /** 还没设时间的条目数（池子那一行） */
  const poolCount = useMemo(() => store.entries.filter((e) => !e.time).length, [store.entries]);

  /* ---------- AI 自动排版：入队 → 出方案 → 进审查 ----------
   * 实现只有一份（`useTimelineLayout`）—— 「时间」与「编年」是同一份数据的两种读法，
   * 让 AI 排一遍这件事自然也只能有一套对账规则，否则同一个按钮在两页里会给出不同结果。 */
  const { job: layoutJob, plan: layoutPlan, run: runLayout } = useTimelineLayout();
  const { job: guessJob, plan: guessPlan, run: runGuess } = useTimelineGuess();
  const [aiMenu, setAiMenu] = useState(false);

  /* ---------- 进了「等着落位」又想退回，不该被迫去点某个位置 ---------- */
  useEffect(() => {
    if (!pendingId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPendingId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingId]);

  /* ---------- 写入 ---------- */

  /**
   * 把一条条目放到轴上某个位置 —— **这就是「排进时间轴」的全部动作**。
   *
   * 两条入口（从池子里拖过来、点两下）共用它，所以判重、默认值、怎么交代只有一份。
   * 只写 `at`：时间文本、纪元、分量一概不编 —— 位置是明确的，说法留给作者。
   * 真的要走 `store.setEntryTime`（而不是 `updateEntry({time})`）：补位置数值、
   * 按形态规整终结，只有那一处会做。
   */
  const placeAt = useCallback(
    async (id: ID, at: number) => {
      const en = store.entries.find((x) => x.id === id);
      if (!en) return;
      const had = !!en.time;
      await store.setEntryTime(id, { at });
      setPendingId(null);
      setSelId(id);
      toast.success(
        had ? t('time.toast.moved', { title: en.title, n: at }) : t('time.toast.placed', { title: en.title }),
      );
    },
    [store, toast, t],
  );

  const addAt = useCallback(
    async (at: number) => {
      const worldId = store.activeWorld?.id;
      const cat = store.categories[0];
      if (!worldId || !cat) return;
      const en = await store.createEntry({
        worldId,
        categoryId: cat.id,
        title: '',
        time: { kind: 'point', from: '', to: '', at, era: '', weight: 'normal' },
      });
      // 位置先落定，接着直接打开条目把话说清楚 —— 添完还要再点一次就太笨了
      onOpenEntry?.(en.id);
      toast.success(t('time.toast.added', { title: en.title }));
    },
    [store, onOpenEntry, toast, t],
  );

  const setAt = useCallback(
    async (id: ID, at: number) => {
      const en = all.find((x) => x.id === id);
      if (!en) return;
      await store.setEntryTime(id, { at });
      toast.success(t('time.toast.moved', { title: en.title, n: at }));
    },
    [all, store, toast, t],
  );

  const dropTime = useCallback(async () => {
    if (!sel) return;
    const title = sel.title;
    setSelId(null);
    await store.setEntryTime(sel.id, null);
    toast.success(t('time.toast.unset', { title }));
  }, [sel, store, toast, t]);

  /* ---------- 拖动 ---------- */
  const svgX = (clientX: number) => {
    const el = svgRef.current;
    if (!el) return 0;
    return clientX - el.getBoundingClientRect().left;
  };

  /** 指针在不在轴上？在的话对应哪个 x —— 拖进池子那一路的判断只有这一处 */
  const axisXAt = useCallback((clientX: number, clientY: number): number | null => {
    const el = svgRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
    return clamp(clientX - r.left, 0, r.width);
  }, []);

  /**
   * 从池子里把一条拖到轴上。
   *
   * 没有用 HTML5 的 dragstart/drop：那套拖的是浏览器自己画的半透明残影，落点在 SVG 里
   * 拿不到稳定坐标，而且**端到端脚本里没法如实模拟**。这里跟轴上拖节点是同一套做法 ——
   * 按下时把 move/up 挂到 window 上（不是挂 state 再等 effect，那样头几像素会掉在缝隙里），
   * 松开时算落点。
   *
   * 「拖」和「点」在**松开的那一刻**一次判完：落在轴上就落位，没落在轴上、指针又几乎没动，
   * 那就是「点了一下」。不留给随后的 click 事件去判 —— 那需要记住「上一次是不是拖」，
   * 而这个记忆会在「拖到轴上松手（click 落在别处）」之后一直挂着，
   * 把下一次真点击吃掉（要等到再按一次才复位）。
   */
  const onPoolDown = (en: Entry) => (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault(); // 别顺手选中一行字
    movedRef.current = false;
    const x0 = e.clientX;
    const y0 = e.clientY;
    setCarry({ id: en.id, title: en.title, x: x0, y: y0, axisX: axisXAt(x0, y0) });

    const move = (me: MouseEvent) => {
      if (Math.abs(me.clientX - x0) + Math.abs(me.clientY - y0) > 4) movedRef.current = true;
      const ax = axisXAt(me.clientX, me.clientY);
      setCarry((c) => (c && c.id === en.id ? { ...c, x: me.clientX, y: me.clientY, axisX: ax } : c));
    };
    const up = (me: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setCarry(null);
      const ax = axisXAt(me.clientX, me.clientY);
      if (ax !== null) {
        void placeAt(en.id, atAtRef.current(ax));
        return;
      }
      if (!movedRef.current) setPendingId((p) => (p === en.id ? null : en.id));
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  /** 池子里那一行：拖到轴上就落位；不拖、就在轴上等着一处点击 */
  const onPoolRowClick = (en: Entry) => (e: React.MouseEvent) => {
    // 指针点击（detail > 0）上面已经判过「拖还是点」了，这里只管键盘
    // （Enter / 空格不会走 mousedown/mouseup，只有这一条路）。
    if (e.detail !== 0) return;
    setPendingId((p) => (p === en.id ? null : en.id));
  };

  /**
   * 按下节点 → 就地挂上移动/松开的监听，松开时再摘掉。
   *
   * 没有走「先 setState，再由 effect 挂监听」那条路：effect 要等这一次渲染提交完
   * 才跑，而鼠标在按下之后**立刻**就可能移动 —— 那几像素的位移会落在监听还没挂上的
   * 空隙里，表现为「拖不动」。监听直接挂在 window 上，跟渲染无关。
   */
  const onNodeDown = (en: Entry) => (e: React.MouseEvent) => {
    e.stopPropagation();
    // 「等着落位」的时候，点哪个节点都是「放在这儿」
    if (pendingId) {
      void placeAt(pendingId, atAt(svgX(e.clientX)));
      return;
    }
    if (dragRef.current) return;
    dragRef.current = { id: en.id, startX: e.clientX, moved: false };
    dragAtRef.current = null;
    setDragging(en.id);
    setDragAt(null);

    const move = (me: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.moved && Math.abs(me.clientX - d.startX) < 4) return;
      d.moved = true;
      const next = atAtRef.current(svgX(me.clientX));
      dragAtRef.current = next;
      setDragAt(next);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      const d = dragRef.current;
      dragRef.current = null;
      const next = dragAtRef.current;
      dragAtRef.current = null;
      setDragging(null);
      setDragAt(null);
      if (!d) return;
      setSelId(d.id);
      // 拖了才算改；只是点一下就别写库（否则日志页会全是「改位置」）
      if (d.moved && next !== null) {
        const target = all.find((x) => x.id === d.id);
        if (target && atOf(target) !== next) void setAt(d.id, next);
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  /** 点轴上的空白：等着落位时就落位，否则就是取消选中 */
  const onAxisBlankDown = (clientX: number) => {
    if (pendingId) {
      void placeAt(pendingId, atAt(svgX(clientX)));
      return;
    }
    setSelId(null);
  };

  const bgW = Math.max(1, W);
  /** 幽灵：从池子里拖着时看指针，等着落位时看悬停 */
  const ghost = carry ? carry.axisX : ghostX;

  return (
    <>
      <div className="row tl-bar" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div className="tl-seg" data-role="tl-scale">
          <button
            className={`chip ${scale === 'prop' ? 'active' : ''}`}
            data-role="tl-scale-prop"
            title={t('time.scale.hintProportional')}
            onClick={() => setScale('prop')}
          >
            {t('time.scale.proportional')}
          </button>
          <button
            className={`chip ${scale === 'even' ? 'active' : ''}`}
            data-role="tl-scale-even"
            title={t('time.scale.hintEven')}
            onClick={() => setScale('even')}
          >
            {t('time.scale.even')}
          </button>
        </div>
        <label className="row small" style={{ gap: 6, alignItems: 'center' }}>
          <input
            type="checkbox"
            data-role="tl-only-major"
            checked={onlyMajor}
            onChange={(e) => setOnlyMajor(e.target.checked)}
          />
          {t('time.view.tool.onlyMajor')}
        </label>
        <div className="row" style={{ gap: 4 }}>
          <button
            className="btn sm"
            data-role="tl-zoom-out"
            disabled={zoom === ZOOMS[0]}
            title={t('time.view.tool.zoomOut')}
            onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])}
          >
            −
          </button>
          <span className="muted tiny" title={t('time.view.tool.density')}>
            {t('time.view.tool.density')} ×{zoom}
          </span>
          <button
            className="btn sm"
            data-role="tl-zoom-in"
            disabled={zoom === ZOOMS[ZOOMS.length - 1]}
            title={t('time.view.tool.zoomIn')}
            onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)])}
          >
            +
          </button>
        </div>
        <button
          className="btn sm"
          data-role="tl-relayout"
          title={t('time.view.tool.reset')}
          onClick={() => {
            setZoom(1);
            setEraFilter(null);
            setOnlyMajor(false);
          }}
        >
          <IcRefresh size={14} /> {t('time.view.tool.reset')}
        </button>
        <div className="chron-ai-wrap" data-role="tl-ai-menu">
          <button
            className="btn sm"
            data-role="tl-ai-toggle"
            title={t('time.aiMenu.hint')}
            aria-expanded={aiMenu}
            onClick={() => setAiMenu((v) => !v)}
          >
            <IcSparkles size={14} /> {t('time.aiMenu.label')}
          </button>
          {aiMenu && (
            <>
              <div
                className="chron-more-mask"
                data-role="tl-ai-mask"
                onClick={() => setAiMenu(false)}
              />
              <div className="chron-ai-pop" data-role="tl-ai-pop">
                <button
                  className="chron-ai-item"
                  data-role="tl-ai-layout"
                  title={t('time.layout.hint')}
                  disabled={!!layoutJob}
                  onClick={() => {
                    runLayout();
                    setAiMenu(false);
                  }}
                >
                  <span className="chron-ai-item-ico">
                    {layoutJob ? <span className="spinner" /> : <IcTimeline size={14} />}
                  </span>
                  <span className="chron-ai-item-body">
                    <span className="chron-ai-item-title">
                      {layoutJob ? t('time.layout.running') : t('time.layout.btn')}
                    </span>
                    <span className="muted tiny">{t('time.layout.shortHint')}</span>
                  </span>
                </button>
                <button
                  className="chron-ai-item"
                  data-role="tl-ai-guess"
                  title={t('time.guess.hint')}
                  disabled={!!guessJob}
                  onClick={() => {
                    runGuess();
                    setAiMenu(false);
                  }}
                >
                  <span className="chron-ai-item-ico">
                    {guessJob ? <span className="spinner" /> : <IcClock size={14} />}
                  </span>
                  <span className="chron-ai-item-body">
                    <span className="chron-ai-item-title">
                      {guessJob ? t('time.guess.running') : t('time.guess.btn')}
                    </span>
                    <span className="muted tiny">{t('time.guess.shortHint')}</span>
                  </span>
                </button>
              </div>
            </>
          )}
        </div>
        <button
          className="btn primary sm"
          style={{ marginLeft: 'auto' }}
          data-role="tl-add"
          onClick={() => addAt(atAtRef.current(W - PAD))}
        >
          <IcPlus size={14} /> {t('time.view.tool.add')}
        </button>
      </div>

      {/*
        方案已经躺在审查队列里了。这条横幅的存在理由很实在：
        「AI 排版」按下去之后，轴上**什么都不会变**（这是刻意的）——
        不说清楚，作者会以为它没干活。
      */}
      {layoutPlan && (
        <div
          className="banner info"
          style={{ marginBottom: 12 }}
          data-role="tl-layout-plan"
          data-count={layoutPlan.layoutDraft?.length ?? 0}
        >
          <IcSparkles size={15} />
          <div style={{ flex: 1 }}>
            {t('time.layout.pendingBanner', { n: String(layoutPlan.layoutDraft?.length ?? 0) })}
          </div>
          {onGoReview && (
            <button className="btn sm" data-role="tl-layout-go" onClick={onGoReview}>
              {t('time.layout.goReview')}
            </button>
          )}
        </div>
      )}

      {guessPlan && (
        <div
          className="banner info"
          style={{ marginBottom: 12 }}
          data-role="tl-guess-plan"
          data-count={guessPlan.guessDraft?.length ?? 0}
        >
          <IcSparkles size={15} />
          <div style={{ flex: 1 }}>
            {t('time.guess.pendingBanner', { n: String(guessPlan.guessDraft?.length ?? 0) })}
          </div>
          {onGoReview && (
            <button className="btn sm" data-role="tl-guess-go" onClick={onGoReview}>
              {t('time.guess.goReview')}
            </button>
          )}
        </div>
      )}

      {placed.tied && (
        <div className="banner info" style={{ marginBottom: 12 }} data-role="tl-ties">
          <IcLink size={15} />
          <div>{t('time.axis.samePosition')}</div>
        </div>
      )}

      {/* 落位态：说清楚这一下会落在哪儿、怎么退出去 */}
      {pendingId && (
        <div className="banner info" style={{ marginBottom: 12 }} data-role="tl-place-banner" data-id={pendingId}>
          <IcPlus size={15} />
          <div style={{ flex: 1 }}>{t('time.pool.pending', { title: nameOf(pendingId) })}</div>
          <button className="btn sm" data-role="tl-place-cancel" onClick={() => setPendingId(null)}>
            {t('time.pool.pendingCancel')}
          </button>
        </div>
      )}

      <div className="split" style={{ gridTemplateColumns: 'minmax(0,1fr) 340px' }}>
        <div style={{ minWidth: 0 }}>
          {/* ---------------- 轴：一直是落点，一条都没有时也在这儿等着 ---------------- */}
          <div className="card tl-card">
            <div className="tl-axis-scroll" ref={wrapRef}>
              <svg
                ref={svgRef}
                className={`tl-svg ${dragging ? 'dragging' : ''} ${
                  pendingId || (carry && carry.axisX !== null) ? 'placing' : ''
                }`}
                width={bgW}
                height={H}
                viewBox={`0 0 ${bgW} ${H}`}
                data-role="tl-axis"
                onMouseMove={(e) => {
                  if (pendingId) setGhostX(svgX(e.clientX));
                }}
                onMouseLeave={() => setGhostX(null)}
              >
                {/* 点空白处 = 落位 / 取消选中 */}
                <rect
                  x={0}
                  y={0}
                  width={bgW}
                  height={H}
                  fill="transparent"
                  data-role="tl-blank"
                  onMouseDown={(e) => onAxisBlankDown(e.clientX)}
                />

                {/* 纪元色带：同一段的时间连在一起看 */}
                {eras.map((era) => {
                  const inEra = list.filter((e) => (e.time?.era ?? '').trim() === era);
                  if (!inEra.length) return null;
                  const xs = inEra.map((e) => xOfOrder(atOf(e)));
                  const x1 = Math.max(0, Math.min(...xs) - 30);
                  const x2 = Math.min(bgW, Math.max(...xs) + 30);
                  return (
                    <g key={era} data-role="tl-band" data-era={era}>
                      <rect
                        x={x1}
                        y={BAND_TOP}
                        width={Math.max(24, x2 - x1)}
                        height={BAND_BOTTOM - BAND_TOP}
                        rx={12}
                        fill={eraColor(era)}
                        opacity={eraFilter === era ? 0.16 : 0.07}
                      />
                      <text x={x1 + 12} y={BAND_TOP + 18} className="tl-era-label" fill={eraColor(era)}>
                        {era}
                      </text>
                    </g>
                  );
                })}

                {/* 主轴与时间方向 */}
                <line
                  x1={PAD - 44}
                  y1={AXIS_Y}
                  x2={W - PAD + 34}
                  y2={AXIS_Y}
                  className="tl-axis-line"
                />
                <path
                  d={`M${W - PAD + 34} ${AXIS_Y} l-11 -5.5 v11 z`}
                  className="tl-axis-arrow"
                />

                {/* 刻度：把真实的位置数值标出来，轴距才不是玄学 */}
                {ticks.map((tk) => (
                  <g key={tk.x}>
                    <line x1={tk.x} y1={AXIS_Y} x2={tk.x} y2={AXIS_Y + 8} className="tl-tick" />
                    <text x={tk.x} y={AXIS_Y + 24} className="tl-tick-label">
                      {tk.label}
                    </text>
                  </g>
                ))}

                {/* 一条都没有：这条轴就是落点，说清楚该往哪儿拖 */}
                {!all.length && (
                  <text
                    x={W / 2}
                    y={AXIS_Y - 36}
                    className="tl-axis-hint"
                    textAnchor="middle"
                    data-role="tl-axis-hint"
                  >
                    {t('time.axis.dropHere')}
                  </text>
                )}

                {/* 条目节点 */}
                {placed.items.map(({ en, x: bx, off }) => {
                  const tm = en.time!;
                  const isDrag = dragging === en.id && dragAt !== null;
                  const x = isDrag ? clamp(xOfOrder(dragAt!), PAD - 20, W - PAD + 20) : bx;
                  const y = AXIS_Y + off;
                  const on = selId === en.id || hoverId === en.id || isDrag;
                  const r = NODE_R[tm.weight] + (on ? 1.5 : 0);
                  const above = off <= 0;
                  const label = (tm.from ? `${tm.from} · ` : '') + (en.title || t('common.untitled'));
                  const showLabel =
                    on || tm.weight === 'major' || (tm.weight === 'normal' && list.length <= 20);
                  const color = (tm.era ?? '').trim() ? eraColor(tm.era) : 'var(--primary)';
                  /** 只有位置、还没写下时间文本 —— 圈画成虚线，别假装它有个日期 */
                  const provisional = !(tm.from ?? '').trim();
                  /**
                   * 区间的横杠。
                   *   · 「一段」且给了终点数值 → 按比例画实线，长短就是真的跨度；
                   *   · 「一段」没给终点数值 → 画一段**固定长度的虚线**（长度不代表任何东西，
                   *     虚线就是这句话）；
                   *   · 「至今」→ 一直画到轴的右端，箭头收尾。
                   * 均匀铺开模式下比例没有意义，一律退化成虚线段。
                   */
                  const barEnd = (() => {
                    if (tm.kind === 'ongoing') return W - PAD + 26;
                    if (tm.kind !== 'range') return null;
                    if (scale === 'prop' && typeof tm.toAt === 'number') return xOfOrder(tm.toAt);
                    return Math.min(W - PAD + 20, x + SPAN_STUB);
                  })();
                  const barDashed = tm.kind === 'range' && !(scale === 'prop' && typeof tm.toAt === 'number');
                  return (
                    <g
                      key={en.id}
                      data-role="tl-node"
                      data-id={en.id}
                      data-x={Math.round(x)}
                      data-order={atOf(en)}
                      data-r={NODE_R[tm.weight]}
                      data-era={(tm.era ?? '').trim()}
                      data-kind={tm.kind}
                      data-notime={provisional ? '1' : '0'}
                      className="tl-node"
                      style={{ cursor: pendingId ? 'crosshair' : 'grab' }}
                      onMouseDown={onNodeDown(en)}
                      onMouseEnter={() => setHoverId(en.id)}
                      onMouseLeave={() => setHoverId((h) => (h === en.id ? null : h))}
                    >
                      {barEnd !== null && barEnd > x && (
                        <g pointerEvents="none" data-role="tl-span">
                          <line
                            x1={x}
                            y1={y}
                            x2={barEnd}
                            y2={y}
                            stroke={color}
                            strokeWidth={2.2}
                            strokeDasharray={barDashed ? '4 4' : undefined}
                            opacity={0.75}
                          />
                          <line
                            x1={barEnd}
                            y1={y - 5}
                            x2={barEnd}
                            y2={y + 5}
                            stroke={color}
                            strokeWidth={2.2}
                            opacity={barDashed ? 0.6 : 0.9}
                            strokeDasharray={barDashed ? '3 3' : undefined}
                          />
                        </g>
                      )}
                      {off !== 0 && (
                        <line
                          x1={x}
                          y1={AXIS_Y}
                          x2={x}
                          y2={y}
                          className="tl-stem"
                          stroke={color}
                        />
                      )}
                      {/* 热区：细节点不好按住，给一个更大的透明圆 */}
                      <circle cx={x} cy={y} r={Math.max(11, r + 8)} fill="transparent" />
                      <circle
                        cx={x}
                        cy={y}
                        r={r}
                        fill={on ? color : 'var(--panel)'}
                        stroke={color}
                        strokeWidth={tm.weight === 'major' ? 2.6 : 2}
                        strokeDasharray={provisional ? '3 2' : undefined}
                        pointerEvents="none"
                      />
                      {selId === en.id && (
                        <circle
                          cx={x}
                          cy={y}
                          r={r + 5}
                          fill="none"
                          stroke={color}
                          strokeWidth={1.4}
                          strokeDasharray="3 3"
                          pointerEvents="none"
                        />
                      )}
                      {showLabel && (
                        <text
                          x={x}
                          y={above ? y - 15 : y + 22}
                          className={`tl-node-label ${on ? 'on' : ''} ${above ? 'above' : 'below'}`}
                          fill={on ? 'var(--text)' : 'var(--text-soft)'}
                          pointerEvents="none"
                        >
                          {isDrag ? t('time.axis.dragging', { n: dragAt! }) : clip(label, 18)}
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* 幽灵：松手就落在这儿 */}
                {ghost !== null && (
                  <g pointerEvents="none">
                    <line
                      x1={ghost}
                      y1={BAND_TOP}
                      x2={ghost}
                      y2={AXIS_Y + 30}
                      className="tl-ghost-line"
                    />
                    <circle cx={ghost} cy={AXIS_Y} r={7} className="tl-ghost-dot" />
                    <text x={ghost} y={AXIS_Y - 16} className="tl-ghost-label">
                      {atAt(ghost)}
                    </text>
                  </g>
                )}
                <g
                  className="tl-lane"
                  data-role="tl-add-lane"
                  onMouseMove={(e) => setGhostX(svgX(e.clientX))}
                  onMouseLeave={() => setGhostX(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    void addAt(atAt(svgX(e.clientX)));
                  }}
                >
                  <rect x={PAD - 44} y={LANE_Y} width={W - PAD * 2 + 78} height={LANE_H} rx={10} />
                  <text x={W / 2} y={LANE_Y + LANE_H / 2 + 5} className="tl-lane-label">
                    + {t('time.axis.addHint')}
                  </text>
                </g>
              </svg>
            </div>
            <div className="tl-legend">
              <span className="muted tiny">{t('time.axis.dragHint')}</span>
              {hasNoTimeText && (
                <span className="muted tiny" data-role="tl-notime-legend">
                  {t('time.axis.notimeLegend')}
                </span>
              )}
              <div className="row" style={{ gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
                {eras.map((era) => (
                  <button
                    key={era}
                    className={`tl-era-chip ${eraFilter === era ? 'active' : ''}`}
                    data-role="tl-legend-era"
                    data-era={era}
                    onClick={() => setEraFilter((f) => (f === era ? null : era))}
                  >
                    <span className="tl-dot" style={{ background: eraColor(era) }} />
                    {era}
                  </button>
                ))}
                {eraFilter && (
                  <button
                    className="chip"
                    data-role="tl-legend-clear"
                    onClick={() => setEraFilter(null)}
                  >
                    <IcClose size={12} /> {t('time.legend.clear')}
                  </button>
                )}
                <span className="muted tiny" style={{ marginLeft: 6 }}>
                  {WEIGHTS.map((w) => (
                    <span key={w} title={t(`time.weight.${w}.hint`)} style={{ marginRight: 8 }}>
                      <span
                        className="tl-dot"
                        style={{
                          background: 'var(--text-dim)',
                          width: NODE_R[w] * 1.4,
                          height: NODE_R[w] * 1.4,
                          verticalAlign: 'middle',
                        }}
                      />
                      {t(`time.weight.${w}`)}
                    </span>
                  ))}
                </span>
              </div>
            </div>
          </div>

          {/* ---------------- 一条都没有时：说清楚这不是「坏了」，是还差一步 ---------------- */}
          {!all.length && (
            <div className="card" style={{ marginTop: 12 }}>
              <Empty
                icon="🕰️"
                title={t('time.empty.title')}
                desc={
                  store.entries.length
                    ? t('time.empty.hasNone', { n: String(store.entries.length) })
                    : t('time.empty.desc')
                }
                action={
                  <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
                    {store.entries.length > 0 && (
                      <button className="btn primary mt12" data-role="tl-empty-add" onClick={() => addAt(10)}>
                        <IcPlus size={14} /> {t('time.empty.action')}
                      </button>
                    )}
                    {onGoRelations && (
                      <button className="btn mt12" data-role="tl-empty-relations" onClick={onGoRelations}>
                        {t('time.empty.goRelations')}
                      </button>
                    )}
                  </div>
                }
              />
            </div>
          )}

          {/* ---------------- 轴上没有、轴下排开 ---------------- */}
          {!!all.length && (
            <div className="card" style={{ marginTop: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <strong>{t('time.list.heading')}</strong>
                <span className="muted tiny">{t('time.list.count', { n: String(list.length) })}</span>
              </div>
              {!list.length ? (
                <p className="muted small">{t('time.list.empty')}</p>
              ) : (
                <div className="tl-list">
                  {list.map((en) => (
                    <div
                      key={en.id}
                      className={`tl-list-row ${selId === en.id ? 'active' : ''}`}
                      data-role="tl-list-row"
                      data-id={en.id}
                      onClick={() => setSelId(en.id)}
                    >
                      <span
                        className="tl-dot"
                        style={{
                          background: (en.time?.era ?? '').trim()
                            ? eraColor(en.time!.era)
                            : 'var(--primary)',
                        }}
                      />
                      <span className="tl-list-when">
                        {en.time?.from?.trim() ? en.time.from : t('time.list.noFrom')}
                      </span>
                      <span className="tl-list-title">{en.title || t('common.untitled')}</span>
                      {en.time?.kind === 'range' && (
                        <span className="muted tiny">
                          {t('time.label.tailRange', {
                            to: en.time.to?.trim() || t('time.label.unknown'),
                          })}
                        </span>
                      )}
                      {en.time?.kind === 'ongoing' && (
                        <span className="muted tiny">
                          {t('time.label.tailOngoing', { until: t('time.axis.ongoingArrow') })}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ---------------- 右侧：选中的那条 + 还没排进去的池子 ---------------- */}
        <div style={{ minWidth: 0 }}>
          {!sel ? (
            <div className="card">
              <strong>{t('time.panel.title')}</strong>
              <p className="muted small" style={{ marginTop: 6 }}>
                {t('time.panel.hint')}
              </p>
              <div className="kv" style={{ marginTop: 10 }}>
                <div>
                  <span className="muted small">{t('time.panel.timed')}</span>
                  <b>{all.length}</b>
                </div>
                <div>
                  <span className="muted small">{t('time.panel.untimed')}</span>
                  <b>{poolCount}</b>
                </div>
              </div>
            </div>
          ) : (
            <div className="card" data-role="tl-panel" data-id={sel.id}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <strong style={{ minWidth: 0 }}>{sel.title || t('common.untitled')}</strong>
                <button className="btn sm" data-role="tl-panel-close" onClick={() => setSelId(null)}>
                  <IcClose size={13} />
                </button>
              </div>
              <div className="row small muted" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                <span data-role="tl-panel-when">
                  <IcClock size={12} /> {sel.time?.from?.trim() || t('time.list.noFrom')}
                  {sel.time?.kind === 'range' &&
                    t('time.label.tailRange', {
                      to: sel.time.to?.trim() || t('time.label.unknown'),
                    })}
                  {sel.time?.kind === 'ongoing' &&
                    t('time.label.tailOngoing', { until: t('time.axis.ongoingArrow') })}
                </span>
                <span>· {t(`time.weight.${sel.time?.weight ?? 'normal'}`)}</span>
                {!!(sel.time?.era ?? '').trim() && <span>· {sel.time!.era}</span>}
              </div>
              {!!sel.summary && <p className="small muted" style={{ marginTop: 8 }}>{sel.summary}</p>}

              {/* 说得更准：改完立刻生效，不必翻进条目编辑器翻到「时间」那一页 */}
              <QuickTime entry={sel} />

              <div className="row" style={{ gap: 8, marginTop: 12 }}>
                <button
                  className="btn sm"
                  data-role="tl-panel-open"
                  onClick={() => onOpenEntry?.(sel.id)}
                >
                  <IcEdit size={13} /> {t('time.panel.open')}
                </button>
                <button className="btn sm" data-role="tl-panel-unset" onClick={() => void dropTime()}>
                  <IcTrash size={13} /> {t('time.edit.unset')}
                </button>
              </div>
              {/* 它牵着的条目 —— 轴上看不见关系，但「这条和谁有关」往往正是下一步 */}
              <RelatedOf entryId={sel.id} onOpenEntry={onOpenEntry} onPick={setSelId} />
            </div>
          )}

          {/* 池子：这个世界里还没上轴的条目，拖上去就排好了 */}
          <div className="card" style={{ marginTop: 12 }} data-role="tl-pool">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>{t('time.pool.heading')}</strong>
              <span className="muted tiny" data-role="tl-pool-count">
                {t('time.list.count', { n: String(poolCount) })}
              </span>
            </div>
            <div className="field-hint" style={{ marginTop: 4 }}>
              {t('time.pool.hint')}
            </div>
            <div className="tl-pool-search">
              <IcSearch size={13} />
              <input
                className="input"
                data-role="tl-pool-search"
                value={poolQ}
                placeholder={t('time.pool.search')}
                onChange={(e) => setPoolQ(e.target.value)}
              />
            </div>
            {!pool.length ? (
              <div className="muted tiny" style={{ marginTop: 8 }} data-role="tl-pool-empty">
                {poolQ.trim() ? t('time.pool.noMatch') : t('time.pool.allPlaced')}
              </div>
            ) : (
              <div className="tl-pool-list">
                {pool.slice(0, POOL_MAX).map((en) => (
                  <button
                    key={en.id}
                    className="tl-pool-row"
                    data-role="tl-pool-row"
                    data-id={en.id}
                    data-carrying={carry?.id === en.id ? '1' : '0'}
                    title={t('time.pool.rowHint', { title: en.title || t('common.untitled') })}
                    onMouseDown={onPoolDown(en)}
                    onClick={onPoolRowClick(en)}
                  >
                    <span
                      className="tl-dot"
                      style={{
                        background: (en.time?.era ?? '').trim()
                          ? eraColor(en.time!.era)
                          : 'var(--primary)',
                      }}
                    />
                    <span className="tl-pool-title">{en.title || t('common.untitled')}</span>
                    <span className="muted tiny">{catName.get(en.categoryId) ?? ''}</span>
                  </button>
                ))}
              </div>
            )}
            {pool.length > POOL_MAX && (
              <div className="muted tiny" style={{ marginTop: 6 }} data-role="tl-pool-more">
                {t('time.pool.more', { n: String(pool.length - POOL_MAX) })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 拖着的那张小卡片 —— 跟着指针走，顺便说清松手会落在哪个数 */}
      {carry && (
        <div
          className="tl-carry"
          data-role="tl-carry"
          data-id={carry.id}
          style={{ left: carry.x + 14, top: carry.y + 16 }}
        >
          <span className="tl-carry-title">{carry.title || t('common.untitled')}</span>
          <span className="muted tiny">
            {carry.axisX !== null
              ? t('time.pool.dropAt', { n: String(atAt(carry.axisX)) })
              : t('time.pool.dropHint')}
          </span>
        </div>
      )}
    </>
  );
}

/**
 * 面板里把时间改细 —— 形态、起止、纪元、分量、轴上的位置。
 *
 * 逻辑一条都不在这里：写入仍然只有 `store.setEntryTime` 一处（它负责补上缺失的位置数值、
 * 按形态规整终结时间）。这里只负责**打得顺手** —— 文本改动在失焦/回车时才落库，
 * 免得每敲一个字就往日志里写一条；形态和分量是点一下的事，当场生效。
 */
export function QuickTime({ entry }: { entry: Entry }) {
  const store = useStore();
  const t = useT();
  const tm = entry.time;

  const [from, setFrom] = useState(tm?.from ?? '');
  const [to, setTo] = useState(tm?.to ?? '');
  const [era, setEra] = useState(tm?.era ?? '');
  const [atText, setAtText] = useState(tm?.at !== undefined ? String(tm.at) : '');

  /**
   * 库里那份变了（在轴上拖了、在别处改了）就跟上 —— 局部草稿只负责「正在打的字」。
   * 依赖是**存下来的值**，所以打字期间它不会触发，不会把光标下的字擦掉。
   */
  useEffect(() => {
    setFrom(tm?.from ?? '');
    setTo(tm?.to ?? '');
    setEra(tm?.era ?? '');
    setAtText(tm?.at !== undefined ? String(tm.at) : '');
  }, [entry.id, tm?.from, tm?.to, tm?.era, tm?.at]);

  const knownEras = useMemo(() => {
    const s = new Set<string>();
    store.timedEntries.forEach((e) => {
      const x = (e.time?.era ?? '').trim();
      if (x) s.add(x);
    });
    return [...s];
  }, [store.timedEntries]);

  if (!tm) return null;

  const commit = (p: Partial<EntryTime>) => {
    void store.setEntryTime(entry.id, p);
  };
  /**
   * 失焦时**读 DOM 里那个值**，而不是读闭包里的 `from`。
   *
   * 输入和失焦可能落在同一批事件里（`input` 与 `focusout` 是同一个任务里连着来的），
   * 那样闭包里的 state 还是这一帧渲染时的旧值 —— 拿着它去比「变了没有」会得出
   * 「没变」，于是这一笔就静默地丢了。DOM 里的值不会骗人。
   */
  const commitText = (field: 'from' | 'to' | 'era') => (e: React.FocusEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (v !== (tm![field] ?? '')) commit({ [field]: v } as Partial<EntryTime>);
  };
  const commitAt = (e: React.FocusEvent<HTMLInputElement>) => {
    const raw = e.target.value.trim();
    if (raw === '') {
      commit({ at: undefined });
      return;
    }
    const n = Number(raw);
    if (Number.isFinite(n)) commit({ at: n });
    else setAtText(tm!.at !== undefined ? String(tm!.at) : '');
  };
  const onEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
  };

  return (
    <div className="tl-quick" data-role="tl-quick">
      <span className="bold tiny soft">{t('time.panel.when')}</span>

      {/*
        形态做成显式三选一，而不是「看终结时间空不空」去猜：
        作者填过终结、后来又删掉，那份空白既可能是「至今」也可能是「就是个时间点」——
        猜错会让轴上凭空多出一段跨度。
      */}
      <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
        {(['point', 'range', 'ongoing'] as const).map((k) => (
          <button
            key={k}
            className={`chip ${tm.kind === k ? 'active' : ''}`}
            data-role={`tl-quick-kind-${k}`}
            title={t(`time.kind.hint.${k}`)}
            onClick={() => commit({ kind: k })}
          >
            {t(`time.kind.${k}`)}
          </button>
        ))}
      </div>

      <div className="tl-quick-row">
        <span className="muted tiny">{t('time.edit.from')}</span>
        <input
          className="input"
          data-role="tl-quick-from"
          value={from}
          placeholder={t('time.edit.fromPlaceholder')}
          onChange={(e) => setFrom(e.target.value)}
          onBlur={commitText('from')}
          onKeyDown={onEnter}
        />
      </div>
      {tm.kind === 'range' && (
        <div className="tl-quick-row">
          <span className="muted tiny">{t('time.edit.to')}</span>
          <input
            className="input"
            data-role="tl-quick-to"
            value={to}
            placeholder={t('time.edit.toPlaceholder')}
            onChange={(e) => setTo(e.target.value)}
            onBlur={commitText('to')}
            onKeyDown={onEnter}
          />
        </div>
      )}
      <div className="tl-quick-row">
        <span className="muted tiny">{t('time.edit.era')}</span>
        <input
          className="input"
          data-role="tl-quick-era"
          list="tl-era-list"
          value={era}
          placeholder={t('time.edit.eraPlaceholder')}
          onChange={(e) => setEra(e.target.value)}
          onBlur={commitText('era')}
          onKeyDown={onEnter}
        />
      </div>
      <div className="tl-quick-row">
        <span className="muted tiny">{t('time.edit.at')}</span>
        <input
          className="input"
          data-role="tl-quick-at"
          inputMode="numeric"
          value={atText}
          placeholder="—"
          onChange={(e) => setAtText(e.target.value)}
          onBlur={commitAt}
          onKeyDown={onEnter}
        />
      </div>

      {/*
        锁定开关：开了之后，位置和时间文字**焊在一起** ——
        改文字位置跟着走，拖位置文字跟着重写。这是编年「120 年 = 位置 120」的根基。
        默认开着（新建带时间的条目就锁定），作者可以在这里关掉，让两者各归各。
      */}
      <label className="row" style={{ gap: 7, alignItems: 'center', marginTop: 8, cursor: 'pointer' }}>
        <input
          type="checkbox"
          data-role="tl-quick-lock"
          checked={tm.locked !== false}
          onChange={(e) => commit({ locked: e.target.checked })}
        />
        <span className="small">{t('time.edit.lock')}</span>
      </label>
      <div className="field-hint" style={{ marginTop: 4 }}>
        {t('time.edit.lockHint')}
      </div>

      <div className="row wrap" style={{ gap: 6, marginTop: 8, alignItems: 'center' }}>
        <span className="muted tiny">{t('time.edit.weight')}</span>
        {TIME_WEIGHTS.map((w) => (
          <button
            key={w}
            className={`chip ${tm.weight === w ? 'active' : ''}`}
            data-role={`tl-quick-weight-${w}`}
            title={t(`time.weight.${w}.hint`)}
            onClick={() => commit({ weight: w })}
          >
            {t(`time.weight.${w}`)}
          </button>
        ))}
      </div>

      <div className="field-hint" style={{ marginTop: 8 }}>
        {t('time.panel.editHint')}
      </div>
      <datalist id="tl-era-list">
        {knownEras.map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
    </div>
  );
}

/** 选中条目牵着的关系：点一下就跳到那一条（如果它也在轴上，就顺带选中它） */
function RelatedOf({
  entryId,
  onOpenEntry,
  onPick,
}: {
  entryId: ID;
  onOpenEntry?: (id: string) => void;
  onPick: (id: ID) => void;
}) {
  const store = useStore();
  const t = useT();
  const rels = store.relations.filter(
    (r) => r.fromEntryId === entryId || r.toEntryId === entryId,
  );
  if (!rels.length) return null;
  return (
    <div style={{ marginTop: 12 }} data-role="tl-panel-relations">
      <span className="muted small">{t('time.panel.relations')}</span>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
        {rels.slice(0, 8).map((r) => {
          const otherId = r.fromEntryId === entryId ? r.toEntryId : r.fromEntryId;
          const other = store.entries.find((e) => e.id === otherId);
          if (!other) return null;
          return (
            <button
              key={r.id}
              className="chip"
              data-role="tl-panel-rel"
              title={`${r.type}${r.note ? ` · ${r.note}` : ''}`}
              onClick={() => {
                if (store.timedEntries.some((e) => e.id === other.id)) onPick(other.id);
                else onOpenEntry?.(other.id);
              }}
            >
              <span className="muted tiny">{r.type}</span> {other.title}
            </button>
          );
        })}
      </div>
    </div>
  );
}
