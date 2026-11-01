/**
 * 编年 —— 「时间与关系」里的**第一入口**。
 *
 * 主张：**一条时间线，先要「读」得下去，才谈得上「编」。**
 *
 * 所以这一页从上到下是同一个时间轴的**四层读法**，共用同一套横坐标与同一个
 * 横向滚动条 —— 卡片在谁的正上方，底下那条横条就是从哪儿到哪儿，一眼能对上：
 *
 *   ① 纪元带 —— 这个世界分成几段、每段各占了多长；
 *   ② 卡片墙   —— 每一条的样子：分量、什么时候、叫什么、说了什么；
 *   ③ 甘特轨   —— 只留形状与跨度：点是一个菱形，一段是一条**真按比例长**的横条；
 *   ④ 刻度尺   —— 位置数值的标尺，轴距不是玄学。
 *
 * 轴上的东西仍然是**条目本身**（设了时间的那些，见 `Entry.time`），不是另一套实体：
 * 卡片的名字就是条目名，点一下开条目改 —— 一个东西只有一份。
 *
 * 几条不肯让步的规矩（与旧轴同源，见 `TimeAxis.tsx` 的开头）：
 *   · **位置就是时间**。拖到哪儿、点哪儿，就是它的 `at`；界面上不提供「删除」，
 *     删条目是条目库的事，这里只管「它落在时间上的哪儿」。
 *   · **轴距只是看法，不是数据**。切「比例 / 均匀」，`at` 一个字节都不动。
 *   · **没写下时间文字的那些，卡片如实标出来**，不替作者编一个日期。
 *   · **卡片绝不重叠**。挤在一处的（同一刻、或位置差极小）**就地紧贴着排开**，
 *     整组锚在它们位置的中心上：那几件事本来就没有可区分的先后，摊开读比叠起来
 *     猜要诚实 —— 而没挤的那些，一张都没动。
 *
 * 这一版已经**转正**：编年接管了从前「时间」那一支的位置（点轴那支还在，
 * 从这一页右下角的「旧的」链接进 —— 读的还是同一份数据，只是留着给作者对照）。
 * 写法上刻意只依赖 `store` 的公开读写（`setEntryTime` / `createEntry`），不碰任何私有结构。
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useToast } from './Toast';
import { Empty } from './Modal';
import {
  IcClock,
  IcClose,
  IcEdit,
  IcPlus,
  IcRefresh,
  IcSearch,
  IcSettings,
  IcSparkles,
  IcTimeline,
  IcTrash,
} from './icons';
import { useT } from '../i18n';
import type { Entry, ID, TimeWeight } from '../types';
import { clamp } from '../lib/id';
import { ERA_PALETTE, QuickTime } from './TimeAxis';
import { useTimelineLayout } from './useTimelineLayout';
import { useTimelineGuess } from './useTimelineGuess';

/* ------------------------------------------------------------------ */
/* 版式常量                                                            */
/*                                                                     */
/* 这些数字不是随便定的：卡片墙与甘特轨**共用同一套 x**，所以卡片的宽度   */
/* 直接决定了轴至少要有多长 —— 见 `minInner()`。改宽度就得连带想清楚     */
/* 「轴会变多长」。                                                      */
/* ------------------------------------------------------------------ */

/**
 * 卡片宽度与最小高度：分量越重，卡越大。这是这一页唯一的层级手段。
 *
 * 宽度是量出来的，不是挑好看的：摘要给两行（见 `.chron-summary`），
 * 一栏正文要放得下三十来个字，「一张卡说了什么」才读得完 ——
 * 再窄就会每张都收在「…」，那还不如把摘要去掉。
 */
const CARD_W: Record<TimeWeight, number> = { major: 340, normal: 280, minor: 232 };
/**
 * 卡片高度：**全墙一致**。
 *
 * 上一版是按分量给 `min-height`（188/168/146）再让内容自适应撑高 —— 撑出来的高度
 * 参差不齐，墙读不成一条线。作者看过之后点名两条：**统一卡片高度一致**、
 * **字体下方留出大概二倍字体高度的空间**。所以现在高度定死成一个数，
 * 内容从顶上排起，多出来的地方全留在卡的下沿（每张卡的内边距按各自标题字号
 * 给到约二倍，见渲染处的 `paddingBottom`）；悬停时浮现的「查看详情」也住在那里
 * —— 空白不是白留的，它正好是 hover 提示的位置。
 *
 * 数值是量出来的最坏情况：眉标 + 时间 + 两行标题 + 两行摘要 + 卡脚 + 上下内边距。
 */
const CARD_H = 260;
/**
 * 封面图（嵌入模式）占的高度。参照 Matrees 的牌面：图在上、字在下 ——
 * 图是这张卡的「引子」，不是主角，所以只给一截，其余仍留给文字。
 */
const COVER_H = 132;
/**
 * 卡片标题的字号 —— 宋体在大字号下才出味道，但**大不等于越大越好**。
 *
 * 上一版是 27/21/17。作者看过之后说「卡片和整体布局的比例中字体过大，有种头重脚轻的」——
 * 一张 340px 宽的卡上顶着 27px 的标题，先读到的是「这行字很大」，而不是这张卡说了什么。
 * 所以整体收一档（21/18/16），把腾出来的地方还给**留白**（内边距 20/22/18、摘要行距 1.75）：
 * 同一张卡上标题仍是最大的那个，层级一点没少，但不再压着正文。
 */
const TITLE_SIZE: Record<TimeWeight, number> = { major: 21, normal: 18, minor: 16 };
/** 点事件的菱形边长（对角线的 1/√2），与卡片大小是同一套层级 */
const NODE_W: Record<TimeWeight, number> = { major: 13, normal: 9, minor: 6 };

/**
 * 两端留白 = **半张最重的卡片** + 一点余量。
 *
 * 卡片是以它的位置为中心摆的，所以留白不足半张卡，第一个时间点的卡片就会
 * 从画布左边探出去（右边的「至今」条同理）。从 `CARD_W` 推出来，改宽度时不用记着改这里。
 */
const PAD = CARD_W.major / 2 + 12;
/**
 * 相邻两张卡片之间**不留空** —— 它们并成一条带，靠一根发丝接缝分开。
 *
 * 早先这里是 20px 的间隙，挤在一起的还会竖着错层叠起来（像一摞牌）。
 * 作者看过之后说：**卡片不可以重叠，最好都并上**，还点了一句
 * 「像历史博物馆里的时间线那样」—— 一整面墙，条目是印在墙上的，不是一张张浮起来的板。
 * 所以现在：不挤的地方照位置站，挤的地方就地一张挨一张铺开，一个像素都不叠。
 */
const GAP = 0;

/**
 * 纪元带的高度。
 *
 * 纪元名 15px×1.3 ≈ 20，色线 2 —— 加起来 30 上下，所以余下十来像素都是**空气**：
 * 这一行是墙头的一行题字，不是又一排内容，挤满了反而显得这一页没有喘息的地方。
 */
const BAND_H = 40;
/** 点事件落在这条基准线上 —— 那就是「轴」本身 */
const RAIL_BASE_Y = 16;
/** 第一条区间条离基准线多远：留出来的正是它名字那一行 */
const BAR_TOP = 26;
/** 区间一条一行：名字一行 + 一根细条 —— 刚好不打架即可，多出来的都是空 */
const RAIL_ROW = 30;
/** 窄到写不下名字的条，就别写了 —— 名字在正上方的卡片里，悬停也还有提示 */
const BAR_NAME_MIN = 40;
/** 底部「点这里，在这一刻新建一条」的带子 */
const ADD_H = 32;
const RULER_H = 34;

/** 疏密。1 已经是「卡片刚好不打架」的宽度，所以只往上放宽，不往下压 */
const ZOOMS = [1, 1.45, 2.1];
/** 池子一次最多列这么多行 —— 再多就该用搜索，而不是一路滚下去 */
const POOL_MAX = 60;
const WEIGHTS: TimeWeight[] = ['major', 'normal', 'minor'];

type ScaleMode = 'prop' | 'even';

/**
 * 这条轴要多宽：**理想值**与**上限**各算一个。
 *
 * 这是「卡片墙 + 甘特轨共用一套 x」这条设计的必要代价：轴不能由容器宽度说了算，
 * 得由**内容**说了算，否则早期的条目全挤在左边、卡片叠成一摞。
 *
 * 但也不能真的按「谁也不许压谁」去算：作者的 `at` 只要有一对挨得极近
 * （把两件事都记成 22 和 22.05 是常事），折算出来就会要求几万像素的轴 ——
 * 公式没错，结果没法用。所以给一个上限：
 *
 *   · `natural` —— 位置合理所需的宽度。两种轴距下它的意思不同（均匀：每一对都要
 *     摊到最挤的那一对的距离，所以是 `(n-1) × 最挤的一对`；比例：全部卡片并排），
 *     但都是「到这儿就够了」。
 *   · `desired` —— 按位置差折算的理想宽度；比例模式下密集的一段会要求更宽。
 *
 * 真正的宽度 = `clamp(desired, 容器宽, max(容器宽, natural))`。到了上限就不再撑，
 * 剩下的极端情况（真挨在同一刻的）交给 `placed` **就地铺开** —— 不重叠是硬要求。
 */
function axisPlan(
  list: Entry[],
  scale: ScaleMode,
  lo: number,
  hi: number,
): { desired: number; natural: number } {
  const n = list.length;
  if (n <= 1) return { desired: 420, natural: 420 };
  const w = (e: Entry) => CARD_W[e.time?.weight ?? 'normal'];
  const need: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    need.push(w(list[i]) / 2 + GAP + w(list[i + 1]) / 2);
  }
  const span = hi - lo;

  /* 均匀模式：相邻中心距一律等于 INNER/(n-1)，所以每一对都得按最挤的那一对来摊 */
  if (scale === 'even' || span <= 0) {
    const even = (n - 1) * Math.max(...need);
    return { desired: even, natural: even };
  }

  /* 比例模式：上限就是「把全部卡片一张挨一张排开」所需的宽度 —— 再宽也只是白滚 */
  const sideBySide = list.reduce((s, e) => s + w(e), 0) + (n - 1) * GAP;

  let out = 0;
  for (let i = 0; i < n - 1; i++) {
    const d = ((list[i + 1].time?.at ?? 0) - (list[i].time?.at ?? 0)) / span;
    if (d <= 0) continue;
    out = Math.max(out, need[i] / d);
  }
  return { desired: out || sideBySide, natural: sideBySide };
}

interface Props {
  onOpenEntry?: (id: string) => void;
  /** 没东西可排时，给它一个台阶去关系视图看看 */
  onGoRelations?: () => void;
  /** AI 排版方案已经躺在审查队列里了 —— 提了案，就得让人一眼看到案子在哪 */
  onGoReview?: () => void;
  /** 去旧的那支点轴（时间视图）—— 编年已经接管入口，旧的留着对照 */
  onOldView?: () => void;
}

export function ChronicleView({ onOpenEntry, onGoRelations, onGoReview, onOldView }: Props) {
  const store = useStore();
  const toast = useToast();
  const t = useT();

  const [scale, setScale] = useState<ScaleMode>('prop');
  const [onlyMajor, setOnlyMajor] = useState(false);
  const [eraFilter, setEraFilter] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  /** 封面图的两种画法：嵌在卡顶（加高）/ 垫在整卡底下（不加高） */
  const [coverMode, setCoverMode] = useState<'block' | 'bg'>('block');
  const [selId, setSelId] = useState<ID | null>(null);
  const [hoverId, setHoverId] = useState<ID | null>(null);
  const [poolQ, setPoolQ] = useState('');
  /** 「显示」浮层开着没有 —— 「看法」那一类控件收在这里，不再占正文上方的位置 */
  const [more, setMore] = useState(false);
  /**
   * 「点两下落位」：先点池子里的一条（不拖），再点画布任意一处。
   * 这是从旧轴原样搬来的第二条落位通道 —— 有人就是不愛拖拽，删了它就是删功能。
   */
  const [pendingId, setPendingId] = useState<ID | null>(null);

  /** 从池子里拖一条上轴：跟着指针的小卡片 */
  const [carry, setCarry] = useState<{ id: ID; title: string; x: number; y: number } | null>(null);
  /** 正在左右拖的那条（改先后）：卡片钉在指针上，松手才写库 */
  const dragRef = useRef<{ id: ID; startX: number; moved: boolean } | null>(null);
  const dragXRef = useRef<number | null>(null);
  const [dragging, setDragging] = useState<ID | null>(null);
  const [dragX, setDragX] = useState<number | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [boxW, setBoxW] = useState(0);

  /** 轴上的东西 = 设了时间的条目（store 已经按 `at` 排好） */
  const all = store.timedEntries;

  const catName = useMemo(
    () => new Map(store.categories.map((c) => [c.id, c.name])),
    [store.categories],
  );

  /** 杂物间索引 —— 封面图（Entry.cover 是一条 piece 的 id）从这里取缩略图 */
  const pieceOf = useMemo(
    () => new Map(store.pieces.map((p) => [p.id, p])),
    [store.pieces],
  );
  /** 这条有没有能画出来的封面（引用失效 / 非图片 → 没有，整块不出现） */
  const coverOf = useCallback(
    (en: Entry) => (en.cover ? pieceOf.get(en.cover)?.thumb ?? null : null),
    [pieceOf],
  );

  /* ---------- 容器的可用宽度 ---------- */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setBoxW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  /**
   * 轴的两端。
   *
   * 位置（`at`）之外，**「一段」的终点也算数**：它同样是一个坐标，轴不覆盖它，
   * 那条跨度就画不完 —— 要么被画布裁掉（等于撒谎说这段很短），要么把画布撑长
   * 一大截（滚动条尾巴上留出一块滚不到头的空白，那正是作者嫌「low」的那种手感）。
   * 所以轴要一直铺到最远的那个终点。
   */
  const domain = useMemo(() => {
    if (!all.length) return { lo: 0, hi: 10 };
    let lo = Infinity;
    let hi = -Infinity;
    for (const e of all) {
      const at = e.time?.at ?? 0;
      lo = Math.min(lo, at);
      hi = Math.max(hi, at);
      const to = e.time?.toAt;
      if (e.time?.kind === 'range' && typeof to === 'number') hi = Math.max(hi, to);
    }
    // 只有一条时轴会退化成一个点，左右各撑开十格，别让它变成一根针
    return hi > lo ? { lo, hi } : { lo: lo - 10, hi: lo + 10 };
  }, [all]);

  /** 轴内区宽度：按 `axisPlan` 的两条线夹出来，最后乘疏密 */
  const inner = useMemo(() => {
    const base = Math.max(600, boxW) - PAD * 2;
    if (base <= 0) return 420 * zoom;
    const { desired, natural } = axisPlan(list, scale, domain.lo, domain.hi);
    return clamp(desired, base, Math.max(base, natural)) * zoom;
  }, [list, scale, domain, boxW, zoom]);

  /** 位置数值 → 轴上的 x（比例模式） */
  const xOfOrder = useCallback(
    (at: number) => {
      const span = domain.hi - domain.lo;
      if (span <= 0) return PAD + inner / 2;
      return PAD + ((at - domain.lo) / span) * inner;
    },
    [domain, inner],
  );

  /** 序号 → 轴上的 x（均匀模式） */
  const xOfIndex = useCallback(
    (i: number) => (list.length <= 1 ? PAD + inner / 2 : PAD + (i * inner) / (list.length - 1)),
    [inner, list.length],
  );

  const xOf = useCallback(
    (e: Entry, i: number) => (scale === 'even' ? xOfIndex(i) : xOfOrder(e.time?.at ?? 0)),
    [scale, xOfIndex, xOfOrder],
  );

  /**
   * 轴上的 x → 位置数值。
   *
   * 两端 2% 是「再往后 / 再往前添一条」：轴已经被现有条目占满，点最右边如果还落在
   * 线内，新条目就会和末尾那条叠在一起 —— 作者的意思显然是「再往后一条」。
   */
  const atAt = useCallback(
    (x: number) => {
      const ratio = clamp((x - PAD) / inner, 0, 1);
      if (scale === 'even') {
        const n = list.length;
        if (!n) return 10;
        const at = (i: number) => list[i].time?.at ?? 0;
        const k = Math.round(ratio * (n + 1));
        if (k <= 0) return Math.round((at(0) - 10) * 10) / 10;
        if (k >= n + 1) return Math.round((at(n - 1) + 10) * 10) / 10;
        if (k >= n) return at(n - 1);
        return Math.round(((at(k - 1) + at(k)) / 2) * 10) / 10;
      }
      const span = domain.hi - domain.lo;
      const step = span > 0 ? span * 0.25 : 10;
      if (all.length && ratio >= 0.98) return Math.round((domain.hi + step) * 10) / 10;
      if (all.length && ratio <= 0.02) return Math.round((domain.lo - step) * 10) / 10;
      return Math.round((domain.lo + ratio * span) * 10) / 10;
    },
    [scale, list, domain, inner, all.length],
  );

  const atAtRef = useRef(atAt);
  atAtRef.current = atAt;

  /* ---------- 摆位：照实算，挤成一撮的就地铺开 ----------
   * 作者看过上一版之后撂下一句「**卡片不可以重叠，最好都并上**」—— 于是这里换了主张：
   *
   *   · 不挤的（绝大多数）：中心就是它的时间，一个像素不动；
   *   · 挤成一撮的（同一刻、或位置差极小）：**整组紧贴着铺开**，锚在那一撮的中心上。
   *
   * 为什么敢铺开：一撮里的那几件事在时间上本来就分不出先后 —— 摊开读，比叠起来
   * 让人猜「底下压着几张」要诚实；而锚在中心意味着**这一撮仍然站在它该站的地方**，
   * 不是被搬到轴的别处。谁被挪了、挪了几张，图例里如实报数（见 `placed.pushed`）。
   */
  const placed = useMemo(() => {
    type P = {
      en: Entry;
      i: number;
      /** 理想中心 —— 它才是「这条在时间上的位置」，甘特轨与悬停竖线都用它 */
      x: number;
      w: number;
      h: number;
      era: string;
      /** 实际左端（挤的时候与 `x - w / 2` 不同） */
      left: number;
      pushed: boolean;
    };
    const ideal: Omit<P, 'pushed'>[] = list.map((en, i) => {
      const w = CARD_W[en.time!.weight];
      const x = xOf(en, i);
      /* 嵌入模式的封面要占一截高度；背景模式不加高（图垫在字底下） */
      const cover = coverMode === 'block' && !!coverOf(en);
      return {
        en,
        i,
        x,
        w,
        h: CARD_H + (cover ? COVER_H : 0),
        era: (en.time!.era ?? '').trim(),
        left: x - w / 2,
      };
    });

    /*
     * 分簇：**理想位置下会碰到的**算一簇（紧贴也算）。一簇之内一律铺开，
     * 簇与簇之间照理想位置站 —— 于是「只有真挤的那几处被摊开」，其余一张都没动。
     * 判据就是理想矩形相交（含 GAP），不做近似：铺开只在真需要时发生。
     */
    const out: P[] = [];
    let i = 0;
    while (i < ideal.length) {
      let j = i;
      while (j + 1 < ideal.length && ideal[j + 1].left < ideal[j].left + ideal[j].w + GAP) j++;
      const cluster = ideal.slice(i, j + 1);
      const tot = cluster.reduce((s, c) => s + c.w, 0) + (cluster.length - 1) * GAP;
      /* 锚在首尾两张的**理想中心**的中点；再往后让一下，保证不越过前一簇
       * —— 卡片顺序就是时间顺序，任何时候都不许颠倒 */
      let cursor = (cluster[0].x + cluster[cluster.length - 1].x) / 2 - tot / 2;
      const prev = out[out.length - 1];
      if (prev) cursor = Math.max(cursor, prev.left + prev.w + GAP);
      for (const c of cluster) {
        out.push({ ...c, left: cursor, pushed: Math.abs(cursor - c.left) > 0.5 });
        cursor += c.w + GAP;
      }
      i = j + 1;
    }

    const last = out[out.length - 1];
    return {
      items: out,
      right: last ? last.left + last.w : PAD,
      /** 被就地铺开的张数 —— 界面要如实报出来 */
      pushed: out.filter((p) => p.pushed).length,
    };
  }, [list, xOf, coverMode, coverOf]);

  /**
   * 画布宽度 = 内区（`axisPlan` 算的那条轴）与**卡片实际铺到哪儿**取大的那个。
   *
   * 取大值这一步不能省：内区是位置坐标系自己的宽度，而「铺开」是在这套坐标里
   * 做位移 —— 最右一簇往后让过之后可能探出内区，不给它地方，卡片就被画布裁掉半张。
   */
  const W = Math.round(Math.max(PAD * 2 + inner, placed.right + PAD));

  /**
   * 纪元带的**分段**：一段接一段，铺满整条轴。
   *
   * 纪元是**首尾相接**的（涨潮纪接着前潮纪，不是各占一段、中间空着），所以墙沿那条线
   * 也该是分段的：颜色换一次，就是换了一个纪元。分界取「上一个纪元最后一张卡的下沿」
   * 与「这一个纪元第一张卡的上沿」的中点 —— 两段之间那段空白一个事件都没有，
   * 归谁都不算错，那就对半分。
   *
   * 万一纪元是交错出现的（`A … B … A`，第一次出现顺序与位置顺序对不上），
   * 后面那段只许落在前面那段之后：宁可让出一小截，也不许两段叠在一起。
   */
  const eraSpans = useMemo(() => {
    const seg = eras
      .map((era) => {
        const inEra = placed.items.filter((p) => p.era === era);
        if (!inEra.length) return null;
        return {
          era,
          first: Math.min(...inEra.map((p) => p.left)),
          last: Math.max(...inEra.map((p) => p.left + p.w)),
        };
      })
      .filter((s): s is { era: string; first: number; last: number } => !!s)
      .sort((a, b) => a.first - b.first);
    let prevEnd = 0;
    return seg.map((s, i) => {
      const x1 = i === 0 ? 0 : Math.max(prevEnd, (seg[i - 1].last + s.first) / 2);
      const x2 =
        i === seg.length - 1
          ? W
          : Math.max(x1 + 60, (s.last + seg[i + 1].first) / 2);
      prevEnd = x2;
      return { era: s.era, x1, x2 };
    });
  }, [eras, placed, W]);

  /**
   * 卡片墙的高度：卡片高度如今是定死的（`CARD_H`），但仍然**量出来**而不是直接写
   * `CARD_H` —— 量的是「最后一张的底沿」，将来卡片若再上下错层，这里不用改。
   */
  const wallRef = useRef<HTMLDivElement | null>(null);
  const [wallH, setWallH] = useState(200);
  useLayoutEffect(() => {
    const el = wallRef.current;
    if (!el) return;
    const measure = () => {
      let max = 0;
      for (const c of el.querySelectorAll<HTMLElement>('[data-role=chron-item]')) {
        max = Math.max(max, c.offsetTop + c.offsetHeight);
      }
      // 只在真的差出一像素以上时才写 state —— 否则「量 → 改高 → 再量」会自己转圈
      if (max > 0) setWallH((prev) => (Math.abs(prev - (max + 4)) < 1 ? prev : Math.ceil(max + 4)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const c of el.querySelectorAll<HTMLElement>('[data-role=chron-item]')) ro.observe(c);
    return () => ro.disconnect();
  }, [placed.items]);

  /* ---------- 甘特轨：区间分行走，点事件共用一条基准线 ----------
   * 区间条之间会横向重叠，所以给它们分行（贪心地「能放进哪行就放哪行」）；
   * 点事件没有长度，全部落在基准线上 —— 那正是「轴」本身。
   */
  const rail = useMemo(() => {
    const lanes: number[] = []; // 每行已经占到的最右 x
    const bars = placed.items
      .filter((p) => p.en.time!.kind !== 'point')
      .sort((a, b) => a.x - b.x)
      .map((p) => {
        const tm = p.en.time!;
        const x1 = p.x;
        const x2 =
          tm.kind === 'ongoing'
            ? W - PAD + 34
            : scale === 'prop' && typeof tm.toAt === 'number'
              ? xOfOrder(tm.toAt)
              : Math.min(W - PAD + 24, x1 + 104);
        const end = Math.max(x1 + 8, Math.min(x2, W - 4));
        let lane = lanes.findIndex((e) => x1 >= e + 10);
        if (lane < 0) {
          lanes.push(end);
          lane = lanes.length - 1;
        } else {
          lanes[lane] = end;
        }
        return {
          ...p,
          x1,
          x2: end,
          lane,
          /** 没给终点数值的「一段」：画成虚线，长度是画的、不代表任何东西 */
          dashed: tm.kind === 'range' && !(scale === 'prop' && typeof tm.toAt === 'number'),
        };
      });
    return { bars, lanes: Math.max(1, lanes.length) };
  }, [placed, scale, xOfOrder, W]);

  const railH = RAIL_BASE_Y + BAR_TOP + rail.lanes * RAIL_ROW + 8;

  /* ---------- 刻度尺 ----------
   * 刻度**按轴的实际长度定疏密**，不是固定五根。
   *
   * 这条轴动辄三四千像素（卡片不重叠的代价），固定五根的话一屏只能看到一根，
   * 尺子就等于没有。所以先按「大约每 520px 一根」折算出该走多少格，
   * 再把格子取成 1 / 2 / 5 ×10^k —— 数字整齐，读者不用心算。
   */
  const ticks = useMemo(() => {
    if (!all.length) return [];
    if (scale === 'even') return placed.items.map((p) => ({ x: p.x, label: String(p.i + 1) }));
    if (all.length < 2 || domain.hi === domain.lo) return [];
    const span = domain.hi - domain.lo;
    const raw = (span * 260) / Math.max(1, inner);
    const mag = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)));
    const step = [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? mag * 10;
    const out: { x: number; label: string }[] = [];
    /* 用整数格号累加，避免浮点加法把 0.30000000000000004 印到尺子上 */
    for (let k = Math.ceil(domain.lo / step); k * step <= domain.hi + 1e-9 && out.length < 24; k++) {
      const v = k * step;
      out.push({ x: xOfOrder(v), label: String(Math.round(v * 1000) / 1000) });
    }
    return out;
  }, [all.length, scale, placed, domain, xOfOrder, inner]);

  const sel = useMemo(() => all.find((e) => e.id === selId) ?? null, [all, selId]);

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

  const poolCount = useMemo(() => store.entries.filter((e) => !e.time).length, [store.entries]);

  /** 有没有哪条只有位置、还没写下时间文字 —— 卡片上要有这句，不然没人看得懂 */
  const hasNoTimeText = useMemo(() => list.some((e) => !(e.time?.from ?? '').trim()), [list]);

  /** 同一条轴上的「什么时候」，念成人话 */
  const whenOf = useCallback(
    (e: Entry) => {
      const tm = e.time;
      if (!tm) return '';
      const from = tm.from?.trim() || t('time.list.noFrom');
      if (tm.kind === 'ongoing') return t('time.label.ongoing', { from, until: t('time.axis.ongoingArrow') });
      if (tm.kind === 'range') {
        return t('time.label.range', { from, to: tm.to?.trim() || t('time.label.unknown') });
      }
      return from;
    },
    [t],
  );

  /* ---------- 写入 ---------- */

  /**
   * 把一条条目放到轴上某个位置 —— **这就是「排进时间轴」的全部动作**。
   * 只写 `at`：时间文本、纪元、分量一概不编 —— 位置是明确的，说法留给作者。
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
        had
          ? t('time.toast.moved', { title: en.title, n: at })
          : t('time.toast.placed', { title: en.title }),
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

  /* ---------- AI 自动排版：入队 → 出方案 → 进审查 ----------
   * 实现只有一份（见 `useTimelineLayout` 的文件头）—— 两种读法共用同一个按钮，
   * 就不能有两套对账规则。 */
  const { job: layoutJob, plan: layoutPlan, run: runLayout } = useTimelineLayout();
  const { job: guessJob, plan: guessPlan, run: runGuess } = useTimelineGuess();

  /** 「AI 行为」子菜单开合 */
  const [aiMenu, setAiMenu] = useState(false);

  /* ---------- 拖动 ---------- */

  /** 指针落在画布的哪个内容坐标 —— 拖池子、拖卡片共用这一处换算 */
  const canvasXAt = useCallback((clientX: number): number | null => {
    const el = canvasRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return clamp(clientX - r.left, 0, r.width);
  }, []);

  /** 「等着落位」的时候，点画布的哪里都是「放在这儿」—— 甘特轨那层也一样 */
  const placePending = useCallback(
    (clientX: number) => {
      const x = canvasXAt(clientX);
      if (x === null) return;
      void placeAt(pendingId!, atAtRef.current(x));
    },
    [pendingId, canvasXAt, placeAt],
  );

  /* 进了「等着落位」又想退回，不该被迫去点某个位置 */
  useEffect(() => {
    if (!pendingId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPendingId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingId]);

  /**
   * 从池子里把一条拖上轴。没有用 HTML5 的 dragstart/drop：那套拖的是浏览器画的
   * 半透明残影，落点拿不到稳定坐标，端到端脚本里也没法如实模拟。这里跟拖卡片是
   * 同一套 —— 按下就把 move/up 挂到 window 上（不是挂 state 再等 effect，那样头
   * 几像素会掉在缝隙里），松开时算落点。
   *
   * 「拖」和「点」在**松开的那一刻**一次判完（判法跟旧轴同源）：落在画布那一带
   * 就是拖上来了；没落在那、指针又几乎没动，那就是「点了一下」→ 进「等着落位」。
   */
  const onPoolDown = (en: Entry) => (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    setCarry({ id: en.id, title: en.title, x: x0, y: y0 });

    const move = (me: MouseEvent) => {
      if (Math.abs(me.clientX - x0) + Math.abs(me.clientY - y0) > 4) moved = true;
      setCarry((c) => (c && c.id === en.id ? { ...c, x: me.clientX, y: me.clientY } : c));
    };
    const up = (me: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setCarry(null);
      const el = canvasRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // 只有落在画布那一带的横向范围内才算「放上轴」——松手在右侧池子上不算
      if (me.clientX >= r.left && me.clientX <= r.right) {
        const ax = clamp(me.clientX - r.left, 0, r.width);
        void placeAt(en.id, atAtRef.current(ax));
        return;
      }
      if (!moved) setPendingId((p) => (p === en.id ? null : en.id));
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  /**
   * 池子里那一行：拖到轴上就落位；不拖、就在轴上等着一处点击。
   * 指针点击（`detail > 0`）上面 mousedown/up 那一路已经判过「拖还是点」了，
   * 这里只管键盘 —— Enter / 空格不会走 mousedown/mouseup，只有这一条路
   * （与旧轴同源：`e2e` 里 `.click()` 的 `detail === 0` 走的也是这条）。
   */
  const onPoolRowClick = (en: Entry) => (e: React.MouseEvent) => {
    if (e.detail !== 0) return;
    setPendingId((p) => (p === en.id ? null : en.id));
  };

  /**
   * 按下卡片/横条 → 左右拖，改先后。
   *
   * 拖动期间卡片**钉在指针上**（`dragX` 就是指针的内容坐标），松手才写库。
   * 只是点一下不算拖动，也就不写库 —— 卡片那一路（`clickOpens`）按作者点名的规矩
   * **点卡片 = 打开这条的详情**（条目编辑器）；甘特轨上的点与条只是「形状」，
   * 点一下仍只选中。卡的右栏面板仍在（拖完、关掉编辑器后它接着用），但「看这一条
   * 说了什么」不再需要先选中再去找按钮。
   * 监听直接挂在 window 上、与渲染无关：等 effect 挂的话，按下之后那几像素的
   * 位移会落在缝隙里，表现为「拖不动」。
   */
  const onGrab = (en: Entry, clickOpens = false) => (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    // 按下就掐掉原生选字 —— 不然拖动时会有一个闪烁的文本插入点跟着指针走
    // （池子那一路 `onPoolDown` 一直有这句，所以它从来不闪）。
    e.preventDefault();
    // 「等着落位」的时候，点哪张卡都是「放在这儿」
    if (pendingId) {
      placePending(e.clientX);
      return;
    }
    if (dragRef.current) return;
    dragRef.current = { id: en.id, startX: e.clientX, moved: false };
    dragXRef.current = null;
    setDragging(en.id);
    setDragX(null);

    const move = (me: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.moved && Math.abs(me.clientX - d.startX) < 4) return;
      const x = canvasXAt(me.clientX);
      if (x === null) return;
      d.moved = true;
      dragXRef.current = x;
      setDragX(x);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      const d = dragRef.current;
      const x = dragXRef.current;
      dragRef.current = null;
      dragXRef.current = null;
      setDragging(null);
      setDragX(null);
      if (!d) return;
      setSelId(d.id);
      if (!d.moved || x === null) {
        // 点一下（没拖）：卡片那一路 = 打开这一条（悬停时「查看详情」说的就是这件事）；
        // 轨上那一路 = 选中并把它上面的卡请到眼前 —— 轨是「索引」，卡才是「正文」。
        if (clickOpens) onOpenEntry?.(d.id);
        else revealCard(d.id);
        return;
      }
      const next = atAtRef.current(x);
      const target = all.find((it) => it.id === d.id);
      if (target && (target.time?.at ?? 0) !== next) void setAt(d.id, next);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  /* ---------- 选中 / 悬停的联动 ---------- */
  const hot = (id: ID) => selId === id || hoverId === id || dragging === id;

  /* placed 的最新一份 —— mouseup 的监听是按下那一刻挂上 window 的，
     闭包里捕获的 placed 会过期（拖动期间每帧都在重渲染） */
  const placedRef = useRef(placed);
  placedRef.current = placed;

  /**
   * 点了甘特轨上的段/点：把正上方那张卡滚到眼前，**并把它选中**。
   *
   * 轨与卡虽共用一套滚动条，却**不是同一个东西**：轨钉在条目的真实位置（`x`）上，
   * 卡片为了不重叠会被「就地铺开」挪到别处（`left`）—— 一撮挤在一起的卡能被摊出
   * 一两千像素远。所以点轨只是「看见了这个位置」，不代表看见那张卡。
   * 跳转按**卡片实际左端**算，跳到哪儿，哪儿就是那张卡本身。
   *
   * 同时 `setSelId`：作者点下方的段/点，要的就是「它和上面那张卡是一件事」——
   * 光把卡滚到眼前、右侧注记栏还停在别的条目上，上下还是对不上。
   */
  const revealCard = useCallback((id: ID) => {
    const sc = scrollRef.current;
    const p = placedRef.current.items.find((it) => it.en.id === id);
    setSelId(id);
    if (!sc || !p) return;
    const to = p.left + p.w / 2 - sc.clientWidth / 2;
    sc.scrollTo({
      left: clamp(to, 0, Math.max(0, sc.scrollWidth - sc.clientWidth)),
      behavior: 'smooth',
    });
  }, []);

  /**
   * 卡片的位置：**按铺开算出来的左端**（`dragX` 是指针的中心，所以拖的时候要减掉半个宽）。
   *
   * 与下面 `railLeftOf` 分开是有意的：卡片可以为了不重叠而铺开，**轨不能** ——
   * 轨画的是数据本身（长度就是真实跨度），它必须钉在真实位置上。两者挤的那一小段
   * 会有偏差，那是这一页唯一一处「看得见的取舍」，所以名字上就把它标出来。
   */
  const leftOf = (p: { left: number; w: number; en: Entry }) =>
    dragging === p.en.id && dragX !== null ? dragX - p.w / 2 : p.left;

  /** 轨上的点按**真实位置**摆（拖动时跟手） */
  const railLeftOf = (p: { x: number; en: Entry }) =>
    dragging === p.en.id && dragX !== null ? dragX : p.x;

  const hoverItem = hoverId ? (placed.items.find((p) => p.en.id === hoverId) ?? null) : null;

  /** 池子里「等着落位」的那条叫什么 —— 横幅里要念出它的名字 */
  const pendingTitle = pendingId
    ? (store.entries.find((e) => e.id === pendingId)?.title ?? t('common.untitled'))
    : '';

  return (
    <>
      {/* AI 排版按下去之后轴上什么都不会变（刻意的）—— 不说清楚，作者会以为它没干活 */}
      {layoutPlan && (
        <div
          className="banner info"
          style={{ marginBottom: 12 }}
          data-role="chron-layout-plan"
          data-count={layoutPlan.layoutDraft?.length ?? 0}
        >
          <IcSparkles size={15} />
          <div style={{ flex: 1 }}>
            {t('time.layout.pendingBanner', { n: String(layoutPlan.layoutDraft?.length ?? 0) })}
          </div>
          {onGoReview && (
            <button className="btn sm" data-role="chron-layout-go" onClick={onGoReview}>
              {t('time.layout.goReview')}
            </button>
          )}
        </div>
      )}

      {/* AI 猜时间同样是「只进审查、不落库」，也要有横幅说明 */}
      {guessPlan && (
        <div
          className="banner info"
          style={{ marginBottom: 12 }}
          data-role="chron-guess-plan"
          data-count={guessPlan.guessDraft?.length ?? 0}
        >
          <IcSparkles size={15} />
          <div style={{ flex: 1 }}>
            {t('time.guess.pendingBanner', { n: String(guessPlan.guessDraft?.length ?? 0) })}
          </div>
          {onGoReview && (
            <button className="btn sm" data-role="chron-guess-go" onClick={onGoReview}>
              {t('time.guess.goReview')}
            </button>
          )}
        </div>
      )}

      {/* 「点两下落位」的第二步：点画布任意一处（Esc 或「算了」退回） */}
      {pendingId && (
        <div
          className="banner info"
          style={{ marginBottom: 12 }}
          data-role="chron-place-banner"
          data-id={pendingId}
        >
          <IcPlus size={15} />
          <div style={{ flex: 1 }}>
            {t('time.pool.pending', { title: pendingTitle })}
          </div>
          <button
            className="btn sm"
            data-role="chron-place-cancel"
            onClick={() => setPendingId(null)}
          >
            {t('time.pool.pendingCancel')}
          </button>
        </div>
      )}

      {/*
        一整张纸：左半是展墙，右半是注记栏（选中的那条 / 还没排进去的池子）。
        两半**同底同高**，中间只有一根发丝线 —— 上一版右栏用的还是通用「卡片」
        （圆角 + 描边 + 投影），浮在展墙旁边像个外挂的控件。作者看过之后说：
        「最右侧的编年卡片不符合这个风格……和总体的布局都有些割裂」。
        现在的做法是：这一页只有**一个**块，块内分栏；栏与栏之间靠栏线与小节标题分层级，
        不再靠「把每条都装进一个盒子」。
      */}
      <div className="chron-sheet">
        <div className="chron-main">
          <div className="card chron-card" data-role="chron-stage">
            <div className="chron-scroll" ref={scrollRef}>
              <div className="chron-canvas" ref={canvasRef} style={{ width: W }}>
                {/* ---------------- ① 纪元带 ---------------- */}
                <div className="chron-band-row" style={{ height: BAND_H }}>
                  {eraSpans.map(({ era, x1, x2 }) => {
                    const on = eraFilter === era;
                    return (
                      <button
                        key={era}
                        className={`chron-era ${on ? 'on' : ''}`}
                        data-role="chron-era"
                        data-era={era}
                        style={
                          {
                            left: x1,
                            width: Math.max(56, x2 - x1),
                            '--era': eraColor(era),
                          } as React.CSSProperties
                        }
                        title={t('chron.era.filterHint', { era })}
                        onClick={() => setEraFilter((f) => (f === era ? null : era))}
                      >
                        <span className="chron-era-name">{era}</span>
                        <span className="chron-era-rule" />
                      </button>
                    );
                  })}
                  {eraFilter && (
                    <button
                      className="chip chron-era-clear"
                      data-role="chron-era-clear"
                      onClick={() => setEraFilter(null)}
                    >
                      <IcClose size={12} /> {t('time.legend.clear')}
                    </button>
                  )}
                </div>

                {/* ---------------- ② 卡片墙 ---------------- */}
                <div
                  className="chron-wall"
                  ref={wallRef}
                  data-role="chron-wall"
                  style={{ height: wallH }}
                  onMouseDown={(e) => {
                    // 「等着落位」时点墙面的空白 = 放在那儿；平时点空白 = 取消选中
                    if (pendingId) {
                      placePending(e.clientX);
                      return;
                    }
                    setSelId(null);
                  }}
                >
                  {placed.items.map((p) => {
                    const tm = p.en.time!;
                    const color = p.era ? eraColor(p.era) : 'var(--primary)';
                    const left = leftOf(p);
                    const on = hot(p.en.id);
                    const provisional = !(tm.from ?? '').trim();
                    const coverUrl = coverOf(p.en);
                    const bg = !!coverUrl && coverMode === 'bg';
                    return (
                      <article
                        key={p.en.id}
                        className={`chron-item ${on ? 'on' : ''} ${selId === p.en.id ? 'sel' : ''} ${
                          dragging === p.en.id ? 'dragging' : ''
                        } ${bg ? 'has-bg' : ''}`}
                        data-role="chron-item"
                        data-id={p.en.id}
                        data-weight={tm.weight}
                        data-kind={tm.kind}
                        data-era={p.era}
                        data-cover={coverUrl ? (coverMode === 'bg' ? 'bg' : 'block') : 'none'}
                        /* `data-x` 是**真实中心**（它的时间），`data-left` 是实际左端 ——
                           挤过的那些两者对不上，差多少正是「铺开了多少」 */
                        data-x={Math.round(p.x)}
                        data-left={Math.round(left)}
                        data-pushed={p.pushed ? '1' : '0'}
                        data-notime={provisional ? '1' : '0'}
                        style={
                          {
                            left,
                            width: p.w,
                            /* 高度全墙一致；下方留约二倍标题字号的空间（作者点名的留白） */
                            height: p.h,
                            paddingBottom: TITLE_SIZE[tm.weight] * 2,
                            zIndex: on ? 2 : 1,
                            '--era': color,
                          } as React.CSSProperties
                        }
                        onMouseDown={onGrab(p.en, true)}
                        onMouseEnter={() => setHoverId(p.en.id)}
                        onMouseLeave={() => setHoverId((h) => (h === p.en.id ? null : h))}
                      >
                        {/*
                          封面图两种画法（「显示」浮层里切换）：
                          · 嵌入 —— 图占卡顶一截（这张卡为此加高），像 Matrees 的牌面；
                          · 垫底 —— 图铺满整卡垫在字底下，高度不变。文字可读性靠
                            那层与墙同色的半透明蒙层保住（见 .chron-bgtint）。
                        */}
                        {coverUrl && coverMode === 'block' && (
                          <div className="chron-figure" data-role="chron-figure" style={{ height: COVER_H }}>
                            <img src={coverUrl} alt={p.en.title} loading="lazy" />
                          </div>
                        )}
                        {bg && (
                          <>
                            <img
                              className="chron-bgimg"
                              data-role="chron-bgimg"
                              src={coverUrl}
                              alt=""
                              aria-hidden
                            />
                            <span className="chron-bgtint" aria-hidden />
                          </>
                        )}
                        {/*
                          眉标只放「分量 · 形态」，**「什么时候」单独一行**。
                          挤在一行时，窄卡片上的时间会被压成「前潮纪…」——
                          而这一页最不该被截的就是时间。分开之后，
                          读的顺序也正了：分量 → 什么时候 → 叫什么 → 说了什么。
                        */}
                        <div className="chron-eyebrow">
                          <span className="chron-dot" style={{ background: color }} />
                          <b>{t(`time.weight.${tm.weight}`)}</b>
                          <span className="chron-sep">·</span>
                          <span className="chron-kind">{t(`time.kind.${tm.kind}`)}</span>
                        </div>
                        <div className="chron-when" title={whenOf(p.en)}>
                          <IcClock size={12} />
                          <span>{whenOf(p.en)}</span>
                        </div>
                        <h3 className="chron-title" style={{ fontSize: TITLE_SIZE[tm.weight] }}>
                          {p.en.title || t('common.untitled')}
                        </h3>
                        {!!p.en.summary && <p className="chron-summary">{p.en.summary}</p>}
                        <div className="chron-foot">
                          <span className="chron-cat">{catName.get(p.en.categoryId) ?? ''}</span>
                          {provisional && (
                            <span className="chron-provisional">{t('chron.card.noTimeText')}</span>
                          )}
                        </div>
                        {/*
                          悬停时浮出来的「查看详情」，住在下方留白里（平时看不见，
                          所以那片空白平时就只是空白）。点卡片会打开这一条 ——
                          这行字就是把这条规矩亮给作者看的。
                        */}
                        <span className="chron-view" data-role="chron-view-hint">
                          {t('chron.card.view')}
                        </span>
                      </article>
                    );
                  })}

                  {!list.length && !!all.length && (
                    <div className="chron-filter-empty" data-role="chron-wall-empty">
                      {t('time.list.empty')}
                    </div>
                  )}
                </div>

                {/* ---------------- ③ 甘特轨 ---------------- */}
                <div
                  className="chron-rail"
                  data-role="chron-rail"
                  style={{ height: railH }}
                  onMouseDown={(e) => {
                    if (pendingId) placePending(e.clientX);
                  }}
                >
                  {/*
                    刻度线**贯穿轨道**，不只是尺子上的一根短须。
                    没有它，轨道就是一大片浅色空白（区间分行摆，可见的行常常只有一两条），
                    看着像页面没画完；有了它，这块是「有刻度的区间带」——
                    条落在哪一年，顺着网格一读就知道。
                  */}
                  {ticks.map((tk, i) => (
                    <div
                      key={`g${i}`}
                      className="chron-gridline"
                      data-role="chron-gridline"
                      style={{ left: tk.x, height: railH }}
                    />
                  ))}
                  <div className="chron-rail-line" style={{ top: RAIL_BASE_Y }} />

                  {rail.bars.map((b) => {
                    const tm = b.en.time!;
                    const color = b.era ? eraColor(b.era) : 'var(--primary)';
                    const on = hot(b.en.id);
                    const w = b.x2 - b.x1;
                    const left = Math.min(
                      dragging === b.en.id && dragX !== null ? dragX : b.x1,
                      W - 20,
                    );
                    const top = RAIL_BASE_Y + BAR_TOP + b.lane * RAIL_ROW;
                    return (
                      <React.Fragment key={b.en.id}>
                        {/* 名字单独一个元素、宽度与条严丝合缝：条里塞不下它（overflow） */}
                        {w >= BAR_NAME_MIN && (
                          <div
                            className="chron-bar-name"
                            data-role="chron-bar-name"
                            style={{ left, top: top - 16, width: w }}
                          >
                            {b.en.title || t('common.untitled')}
                          </div>
                        )}
                        <div
                          className={`chron-bar ${on ? 'on' : ''} ${b.dashed ? 'dashed' : ''} ${
                            tm.kind === 'ongoing' ? 'ongoing' : ''
                          }`}
                          data-role="chron-bar"
                          data-id={b.en.id}
                          data-kind={tm.kind}
                          data-x={Math.round(left)}
                          style={{ left, width: w, top, '--era': color } as React.CSSProperties}
                          title={`${b.en.title || t('common.untitled')} · ${whenOf(b.en)}`}
                          onMouseDown={onGrab(b.en)}
                          onMouseEnter={() => setHoverId(b.en.id)}
                          onMouseLeave={() => setHoverId((h) => (h === b.en.id ? null : h))}
                        >
                          {tm.kind === 'ongoing' && <span className="chron-bar-arrow" />}
                        </div>
                      </React.Fragment>
                    );
                  })}

                  {/*
                    点事件：共用基准线，只画形状 —— 名字在卡片里已经有了，不重复。
                    位置用**真实中心**（`railLeftOf`），不是卡片铺开后的左端：轨画的是数据。
                  */}
                  {placed.items
                    .filter((p) => p.en.time!.kind === 'point')
                    .map((p) => {
                      const color = p.era ? eraColor(p.era) : 'var(--primary)';
                      const r = NODE_W[p.en.time!.weight];
                      const left = railLeftOf(p);
                      return (
                        <div
                          key={p.en.id}
                          className={`chron-node ${hot(p.en.id) ? 'on' : ''}`}
                          data-role="chron-node"
                          data-id={p.en.id}
                          style={
                            {
                              left,
                              top: RAIL_BASE_Y,
                              width: r,
                              height: r,
                              marginLeft: -r / 2,
                              marginTop: -r / 2,
                              '--era': color,
                            } as React.CSSProperties
                          }
                          onMouseDown={onGrab(p.en)}
                          onMouseEnter={() => setHoverId(p.en.id)}
                          onMouseLeave={() => setHoverId((h) => (h === p.en.id ? null : h))}
                        />
                      );
                    })}

                  {/* 悬停：一条竖线把卡片与轨串起来，一眼看出它们是一件事 */}
                  {hoverItem && (
                    <div
                      className="chron-guide"
                      data-role="chron-guide"
                      style={{
                        left: hoverItem.x,
                        top: -wallH,
                        height: wallH + railH,
                      }}
                    />
                  )}
                </div>

                {/* ---------------- ④ 刻度尺 ---------------- */}
                <div
                  className="chron-ruler"
                  data-role="chron-ruler"
                  style={{ height: RULER_H }}
                  onMouseDown={(e) => {
                    if (pendingId) placePending(e.clientX);
                  }}
                >
                  {ticks.map((tk, i) => (
                    <div key={i} className="chron-tick" style={{ left: tk.x }}>
                      <span className="chron-tick-label">{tk.label}</span>
                    </div>
                  ))}
                </div>

                {/* 一条都没有：这一页就是落点，说清楚该往哪儿拖 */}
                {!all.length && (
                  <div className="chron-drop-hint" data-role="chron-drop-hint">
                    {t('time.axis.dropHere')}
                  </div>
                )}
              </div>
            </div>

            {/*
              「在这一刻新建一条」的带子**不在滚动区里** —— 在滚动容器外面，
              所以横滚的时候它一步都不会动（作者的原话：「这个按钮会随着下方的
              滑动条移动也会移动，我觉得做成 fixed 比较好一点」）。
              落点照样讲究：点击处的 x 要按**滚动偏移**换算回画布内容坐标，
              所以这里用滚动容器的 rect 算，而不是按钮自己的。
              早先试过 `position: sticky` —— 它虽然也不动，却会把滚动区的可滚宽度
              撑出一大截（滚到尽头还有一大段空白），所以改成了现在这样。
            */}
            <button
              className="chron-addlane"
              data-role="chron-add-lane"
              style={{ height: ADD_H }}
              onClick={(e) => {
                const sc = scrollRef.current;
                if (!sc) return;
                const x = clamp(
                  e.clientX - sc.getBoundingClientRect().left + sc.scrollLeft,
                  0,
                  W,
                );
                // 「等着落位」时点它，放的是等着的那些一条，不是新建
                if (pendingId) {
                  void placeAt(pendingId, atAt(x));
                  return;
                }
                void addAt(atAt(x));
              }}
            >
              <span className="chron-addlane-chip">
                <IcPlus size={13} /> {t('time.axis.addHint')}
              </span>
            </button>

            {/*
             * 工具条在**画布下面**，不在上面 —— 这是作者点名要的。
             *
             * 原来那一排（比例 / 均匀、只看重大、疏密、重置、AI、新建）挤在页头与画布之间，
             * 还没读到内容就先撞见十个控件；作者的原话是「有些阻挡美感」。
             * 现在常显的只剩三个**动作**（新建 / AI 排版 / 显示），而且沉到底下；
             * 「看法」那一类（比例、只看重大、疏密）收进「显示」里 —— 调一次就不再碰的东西，
             * 不该占着正文上方的位置。
             *
             * 类名必须跟甘特轨的区间条分得开：那条叫 `.chron-bar`（绝对定位、9px 高、裁溢出）。
             * 名字撞上过一次 —— 工具栏被静默套上那套样式、压成一条线、按钮全被裁掉，
             * 而截图里只像「字叠在一起」。所以这里是 `.chron-tools`。
             */}
            <div className="chron-footbar" data-role="chron-footbar">
              {/* 浮层开着时工具条要恢复满不透明 —— 浮层长在这个节点里，会被那 55% 一起压暗 */}
              <div className={`chron-tools ${more ? 'open' : ''}`} data-role="chron-tools">
                <button
                  className="chron-tool"
                  data-role="chron-add"
                  onClick={() => void addAt(atAt(W - PAD))}
                >
                  <IcPlus size={13} /> {t('time.view.tool.add')}
                </button>

                {/* 「AI 行为」总菜单：排版 + 猜时间两条二级命令 */}
                <div className="chron-ai-wrap" data-role="chron-ai-menu">
                  <button
                    className="chron-tool"
                    data-role="chron-ai-toggle"
                    title={t('time.aiMenu.hint')}
                    aria-expanded={aiMenu}
                    onClick={() => setAiMenu((v) => !v)}
                  >
                    <IcSparkles size={13} /> {t('time.aiMenu.label')}
                  </button>
                  {aiMenu && (
                    <>
                      <div
                        className="chron-more-mask"
                        data-role="chron-ai-mask"
                        onClick={() => setAiMenu(false)}
                      />
                      <div className="chron-ai-pop" data-role="chron-ai-pop">
                        <button
                          className="chron-ai-item"
                          data-role="chron-ai-layout"
                          title={t('time.layout.hint')}
                          disabled={!!layoutJob}
                          onClick={() => {
                            runLayout();
                            setAiMenu(false);
                          }}
                        >
                          <span className="chron-ai-item-ico">
                            {layoutJob ? <span className="spinner dark" /> : <IcTimeline size={14} />}
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
                          data-role="chron-ai-guess"
                          title={t('time.guess.hint')}
                          disabled={!!guessJob}
                          onClick={() => {
                            runGuess();
                            setAiMenu(false);
                          }}
                        >
                          <span className="chron-ai-item-ico">
                            {guessJob ? <span className="spinner dark" /> : <IcClock size={14} />}
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
                  className={`chron-tool ${more ? 'on' : ''}`}
                  data-role="chron-tools-more"
                  aria-expanded={more}
                  title={t('chron.tools.moreHint')}
                  onClick={() => setMore((v) => !v)}
                >
                  <IcSettings size={13} /> {t('chron.tools.more')}
                </button>

                {more && (
                  <>
                    {/* 点别处就该收起来 —— 浮层没有关闭的余地，作者只能再点一次那个按钮 */}
                    <div
                      className="chron-more-mask"
                      data-role="chron-more-mask"
                      onClick={() => setMore(false)}
                    />
                    <div className="chron-more" data-role="chron-more">
                      {/* 一行一件事 —— 挤在一行时「疏密」会被压成竖排的两个字 */}
                      <div className="tl-seg" data-role="chron-scale">
                        <button
                          className={`chip ${scale === 'prop' ? 'active' : ''}`}
                          data-role="chron-scale-prop"
                          title={t('time.scale.hintProportional')}
                          onClick={() => setScale('prop')}
                        >
                          {t('time.scale.proportional')}
                        </button>
                        <button
                          className={`chip ${scale === 'even' ? 'active' : ''}`}
                          data-role="chron-scale-even"
                          title={t('time.scale.hintEven')}
                          onClick={() => setScale('even')}
                        >
                          {t('time.scale.even')}
                        </button>
                      </div>
                      <div className="chron-more-line">
                        <span className="chron-more-label" title={t('time.view.tool.density')}>
                          {t('time.view.tool.density')}
                        </span>
                        <div className="chron-more-zoom">
                          <button
                            className="btn sm"
                            data-role="chron-zoom-out"
                            disabled={zoom === ZOOMS[0]}
                            title={t('time.view.tool.zoomOut')}
                            onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])}
                          >
                            −
                          </button>
                          <span className="chron-more-zoom-val">×{zoom}</span>
                          <button
                            className="btn sm"
                            data-role="chron-zoom-in"
                            disabled={zoom === ZOOMS[ZOOMS.length - 1]}
                            title={t('time.view.tool.zoomIn')}
                            onClick={() =>
                              setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)])
                            }
                          >
                            +
                          </button>
                        </div>
                      </div>
                      <label className="chron-more-check">
                        <input
                          type="checkbox"
                          data-role="chron-only-major"
                          checked={onlyMajor}
                          onChange={(e) => setOnlyMajor(e.target.checked)}
                        />
                        {t('time.view.tool.onlyMajor')}
                      </label>
                      <button
                        className="btn sm"
                        data-role="chron-relayout"
                        title={t('time.view.tool.reset')}
                        onClick={() => {
                          setZoom(1);
                          setEraFilter(null);
                          setOnlyMajor(false);
                        }}
                      >
                        <IcRefresh size={13} /> {t('time.view.tool.reset')}
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/*
                图例这一行只留「怎么读」：拖拽提示早就写在页头那句说明里了，再来一遍是重复，
                而重复的东西在这儿只会把这一行撑长（作者的原话：别这么显眼）。
              */}
              <div className="chron-legend" data-role="chron-legend">
                {hasNoTimeText && (
                  <span className="muted tiny" data-role="chron-notime-legend">
                    {t('chron.card.noTimeText')}
                  </span>
                )}
                {/*
                  被就地铺开的张数要报出来：那几张的横坐标与「时间上的位置」不再重合，
                  不说，作者会以为它们本来就标在那儿 —— 这一页可以取舍，但不能有含糊。
                  字面只留「N 张就地铺开」，完整的那句放 title（说清楚为什么不重合）。
                */}
                {placed.pushed > 0 && (
                  <span
                    className="muted tiny"
                    data-role="chron-pushed"
                    data-count={placed.pushed}
                    title={t('chron.push.hintTitle', { n: String(placed.pushed) })}
                  >
                    {t('chron.push.hint', { n: String(placed.pushed) })}
                  </span>
                )}
                <div className="row" style={{ gap: 12, marginLeft: 'auto', flexWrap: 'wrap' }}>
                  <span className="chron-key" data-role="chron-key-point">
                    <i className="chron-key-node" /> {t('chron.legend.point')}
                  </span>
                  <span className="chron-key" data-role="chron-key-range">
                    <i className="chron-key-bar" /> {t('chron.legend.range')}
                  </span>
                  <span className="chron-key" data-role="chron-key-ongoing">
                    <i className="chron-key-bar ongoing" /> {t('chron.legend.ongoing')}
                  </span>
                  <span className="chron-key muted" data-role="chron-key-weight">
                    {WEIGHTS.map((w) => (
                      <span key={w} title={t(`time.weight.${w}.hint`)} style={{ marginLeft: 8 }}>
                        <i
                          className="chron-key-node"
                          style={{ width: NODE_W[w], height: NODE_W[w] }}
                        />
                        {t(`time.weight.${w}`)}
                      </span>
                    ))}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 一条都没有时：说清楚这不是「坏了」，是还差一步 */}
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
                      <button
                        className="btn primary mt12"
                        data-role="chron-empty-add"
                        onClick={() => void addAt(10)}
                      >
                        <IcPlus size={14} /> {t('time.empty.action')}
                      </button>
                    )}
                    {onGoRelations && (
                      <button
                        className="btn mt12"
                        data-role="chron-empty-relations"
                        onClick={onGoRelations}
                      >
                        {t('time.empty.goRelations')}
                      </button>
                    )}
                  </div>
                }
              />
            </div>
          )}
        </div>

        {/* ---------------- 右侧：选中的那条 + 还没排进去的池子 ---------------- */}
        <aside className="chron-side">
          {!sel ? (
            /*
              没选中任何一条时，这一栏是一段**注记**，不是一张卡：一个小节题 + 一句话 +
              两个数。它的样子得跟展墙是一家的（同一张纸的两半），
              所以这里连边框都不要 —— 分栏靠的是那根栏线与字号层级。
            */
            <div className="chron-note" data-role="chron-brief">
              <div className="chron-note-head">{t('chron.panel.title')}</div>
              <p className="chron-note-text">{t('chron.panel.hint')}</p>
              <div className="chron-stats">
                <div className="chron-stat">
                  <b data-role="chron-stat-timed">{all.length}</b>
                  <span>{t('time.panel.timed')}</span>
                </div>
                <div className="chron-stat">
                  <b data-role="chron-stat-pool">{poolCount}</b>
                  <span>{t('time.panel.untimed')}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="chron-note chron-panel" data-role="chron-panel" data-id={sel.id}>
              <div className="chron-note-head row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <strong className="chron-panel-title" style={{ minWidth: 0 }}>
                  {sel.title || t('common.untitled')}
                </strong>
                <button className="btn sm" data-role="chron-panel-close" onClick={() => setSelId(null)}>
                  <IcClose size={13} />
                </button>
              </div>
              <div className="row small muted" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <span data-role="chron-panel-when">
                  <IcClock size={12} /> {whenOf(sel)}
                </span>
                {!!sel.time && <span>· {t(`time.weight.${sel.time.weight}`)}</span>}
                {!!(sel.time?.era ?? '').trim() && <span>· {sel.time!.era}</span>}
              </div>
              {!!sel.summary && (
                <p className="small muted" style={{ marginTop: 10, lineHeight: 1.8 }}>
                  {sel.summary}
                </p>
              )}

              <QuickTime entry={sel} />

              <div className="row" style={{ gap: 8, marginTop: 14 }}>
                <button
                  className="btn sm"
                  data-role="chron-panel-open"
                  onClick={() => onOpenEntry?.(sel.id)}
                >
                  <IcEdit size={13} /> {t('time.panel.open')}
                </button>
                <button
                  className="btn sm"
                  data-role="chron-panel-unset"
                  onClick={() => void dropTime()}
                >
                  <IcTrash size={13} /> {t('time.edit.unset')}
                </button>
              </div>
            </div>
          )}

          {/*
            池子：这个世界里还没上轴的条目，拖上去就排好了。
            一条都没有时**不摆一张空卡** —— 右栏已经有「编年」那段注记了，
            再来一张写着「0 条」的白卡纯属占地方，一行细字就够。
          */}
          <div className="chron-note chron-pool" data-role="chron-pool">
            {!poolCount ? (
              <div className="chron-note-dim" data-role="chron-pool-empty">
                {t('time.pool.allPlaced')}
              </div>
            ) : (
              <>
                <div className="chron-note-head row" style={{ justifyContent: 'space-between' }}>
                  <span>{t('time.pool.heading')}</span>
                  <span className="chron-note-count" data-role="chron-pool-count">
                    {t('time.list.count', { n: String(poolCount) })}
                  </span>
                </div>
                {/* 走到这一支就说明还有条目没上轴，提示与搜索框一律都给 */}
                <div className="chron-note-text">{t('chron.pool.hint')}</div>
                <div className="tl-pool-search">
                  <IcSearch size={13} />
                  <input
                    className="input"
                    data-role="chron-pool-search"
                    value={poolQ}
                    placeholder={t('time.pool.search')}
                    onChange={(e) => setPoolQ(e.target.value)}
                  />
                </div>
                {!pool.length ? (
                  <div className="chron-note-dim" style={{ marginTop: 8 }} data-role="chron-pool-empty">
                    {poolQ.trim() ? t('time.pool.noMatch') : t('time.pool.allPlaced')}
                  </div>
                ) : (
                  <div className="tl-pool-list">
                    {pool.slice(0, POOL_MAX).map((en) => (
                      <button
                        key={en.id}
                        className="tl-pool-row"
                        data-role="chron-pool-row"
                        data-id={en.id}
                        data-carrying={carry?.id === en.id ? '1' : '0'}
                        title={t('time.pool.rowHint', {
                          title: en.title || t('common.untitled'),
                        })}
                        onMouseDown={onPoolDown(en)}
                        onClick={onPoolRowClick(en)}
                      >
                        <span className="tl-dot" style={{ background: 'var(--border-strong)' }} />
                        <span className="tl-pool-title">{en.title || t('common.untitled')}</span>
                        <span className="muted tiny">{catName.get(en.categoryId) ?? ''}</span>
                      </button>
                    ))}
                  </div>
                )}
                {pool.length > POOL_MAX && (
                  <div className="chron-note-dim" style={{ marginTop: 6 }} data-role="chron-pool-more">
                    {t('time.pool.more', { n: String(pool.length - POOL_MAX) })}
                  </div>
                )}
              </>
            )}
          </div>

          {/*
            旧的那支点轴（时间视图）从这里进。编年转正之后它不再占切换位，
            但作者要的不是一个「删掉」—— 留一个不抢眼的口子，随时回去对照。
            两支读的是同一份数据（`Entry.time`），谁那边改了另一边都看得见。
          */}
          {onOldView && (
            <button
              className="chron-oldview"
              data-role="chron-old-view"
              title={t('chron.tools.oldViewHint')}
              onClick={onOldView}
            >
              {t('chron.tools.oldView')}
            </button>
          )}
        </aside>
      </div>

      {/* 拖着的那张小卡片 —— 跟着指针走 */}
      {carry && (
        <div
          className="tl-carry"
          data-role="chron-carry"
          data-id={carry.id}
          style={{ left: carry.x + 14, top: carry.y + 16 }}
        >
          <span className="tl-carry-title">{carry.title || t('common.untitled')}</span>
          <span className="muted tiny">{t('time.pool.dropHint')}</span>
        </div>
      )}
    </>
  );
}

export default ChronicleView;
