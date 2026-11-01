import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useToast } from '../components/Toast';
import { Empty } from '../components/Modal';
import {
  IcRefresh,
  IcSparkles,
  IcStop,
  IcTrash,
  IcSwap,
  IcLink,
  IcEdit,
  IcGraph,
  IcBook,
} from '../components/icons';
import { TimeAxis } from '../components/TimeAxis';
import { ChronicleView } from '../components/ChronicleView';
import { useAITask } from '../state/aiTasks';
import { runRelations } from '../ai/tasks';
import { mergeMutual, mergeMutualOf } from '../lib/relations';
import { useT, type TFunc } from '../i18n';
import type { Entry, EntryStatus, Relation } from '../types';

interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed?: boolean;
}

/** 节点调色板（分类色与单节点色都从这里选） */
const PALETTE = [
  '#2f6fb0', '#7c5cbf', '#17805a', '#b4720d', '#b5352b',
  '#0e7c8a', '#a1457b', '#4a6b2f', '#8a6d3b', '#546e7a',
];

const STATUS_META: Record<EntryStatus, { color: string }> = {
  draft: { color: '#8b98a9' },
  pending: { color: '#c9a227' },
  canon: { color: '#17805a' },
};

const LINK_HIT_W = 14; // 连线的点击热区宽度（细线不好点）

/* ------------------------------------------------------------------ *
 * 「联系轻重」这条视觉刻度
 *
 * 条目一多，图谱就会糊成一片：几十个一样大的圆、几十行一样黑的名字，
 * 谁也看不出哪里是枢纽、哪里是边角。所以让**联系的多寡**去驱动两件事：
 * 圆多大、有多实。密集的图里，眼睛先落在枢纽上，长尾自己退到后面去。
 *
 * 两个量的算法刻意不同（见 `weightOf`）；这几个数就是刻度的两端。
 * ------------------------------------------------------------------ */
const R_MIN = 8; // 只连一条、甚至孤立 —— 最小档
const R_MAX = 17; // 牵着最多线的那个枢纽
const R_FLAT = 11; // 关掉「按联系轻重」时的统一半径（也就是从前那个样子）
const R_FOCUS = 4; // 选中 / 悬停时往外扩一点（临时强调，不参与刻度）
const O_MIN = 0.34; // 密集图里最轻的那一档圆点透明度
const LABEL_O_MIN = 0.16; // 密集图里最轻的那一档标签透明度（几乎只剩一个点）

/**
 * 图有多密 —— 只用来决定「敢把轻的压多暗」。
 *
 * 十几个点的时候压暗毫无意义，反而把好好一张图看糊了；越密才越值得。
 * 0 = 稀疏（一律看得清），1 = 很密（长尾退到底）。
 */
function densityOf(nodeCount: number): number {
  return Math.max(0, Math.min(1, (nodeCount - 14) / 46));
}

/**
 * 一个节点在图上「有多重」，0~1。生出两个刻度，因为它们要解决的问题不一样：
 *
 * - `radius`：真实关系网是长尾的 —— 少数枢纽牵着十几条线，大多数只有一两条。
 *   半径照原始比例铺的话，枢纽一格就把刻度吃光，其余全糊在最小档；**开方**才把中段拉开，
 *   「两条 vs 四条」得看得出来。
 * - `opacity`：反过来，透明度要的就是「长尾退下去」。按原始比例走，只连一条的自然淡，
 *   眼睛先落在枢纽上 —— 这里不需要压缩，压缩反而让边角抢戏。
 *
 * 一个世界如果一条关系都没有，就没有「轻重」可言 —— 一律给中档，别排座次。
 */
function weightOf(degree: number, maxDegree: number): { radius: number; opacity: number } {
  if (maxDegree <= 0) return { radius: 0.55, opacity: 0.55 };
  const t = degree / maxDegree;
  return { radius: Math.sqrt(t), opacity: t };
}

/** 一组颜色小方块（节点/分类共用） */
function Swatches({
  value,
  onPick,
  fallback,
  allowReset,
  resetLabel,
}: {
  value?: string;
  onPick: (c?: string) => void;
  fallback: string;
  allowReset?: boolean;
  resetLabel?: string;
}) {
  const t = useT();
  return (
    <div className="gx-swatches">
      {PALETTE.map((c) => (
        <button
          key={c}
          className={`gx-swatch ${value === c ? 'on' : ''}`}
          style={{ background: c }}
          title={c}
          onClick={() => onPick(c)}
        />
      ))}
      <label className="gx-swatch gx-swatch-custom" title={t('graph.customColor')}>
        <input type="color" value={value ?? fallback} onChange={(e) => onPick(e.target.value)} />
      </label>
      {allowReset && (
        <button
          className="gx-reset"
          onClick={() => onPick(undefined)}
          title={t('graph.restoreDefault')}
        >
          {resetLabel ?? t('graph.defaultColor')}
        </button>
      )}
    </div>
  );
}

/**
 * 「时间与关系」的两支：一部编年（把条目摊成卡片墙 + 甘特轨来读）／
 * 一张网（谁和谁有关）。
 *
 * 「时间」与「编年」**是同一份数据、同一套位置**的两种读法，不是两套数据 ——
 * 所以两支并存不违反「一个东西只有一份」：它们都只读写 `Entry.time`。
 * 编年已经转正为第一入口（点轴那一支不再占切换位，从编年右下角的「旧的」进）。
 */
export type GraphView = 'relations' | 'time' | 'chronicle';

/**
 * 两个看法，同一份数据。
 *
 * 时间**不是**另一页：条目本身就是时间轴上的东西，所以它俩放一起 ——
 * 在编年里读「什么先、什么后」，在关系里看「谁和谁有关」，来回切不用换页。
 *
 * 落在哪一支由**外面**（App）持有，不是这里的局部状态。原因很实在：
 * agent 说「带你去看看时间轴」时，得能直接把这一支点开（它的旧说法 `timeline`
 * 会被折成 `graph` + 编年这一支）；局部的 useState 收不到这个请求。
 * 顺带还有个好处：离开页面再回来，作者看的是刚才那一支，不会被弹回别处。
 */
export function GraphPage({
  onOpenEntry,
  view,
  onViewChange,
  onGoReview,
}: {
  onOpenEntry?: (id: string) => void;
  view: GraphView;
  onViewChange: (v: GraphView) => void;
  /** 时间轴上「有一份 AI 排版方案」的那条横幅要能一跳到审查页 */
  onGoReview?: () => void;
}) {
  const store = useStore();
  const toast = useToast();
  // 推荐结果直接进审查队列，任务槽里不存东西 —— 要的只是「切页也不中断」
  const ai = useAITask('graph.relations', 'graph');
  const t = useT();

  /** 页内都走它切视图，免得漏掉外面那层同步 */
  const setView = onViewChange;

  const [showPending, setShowPending] = useState(true);
  /** 圆的轻重是否跟着联系的多寡走（默认开：条目一多就靠它保住可读性） */
  const [byWeight, setByWeight] = useState(true);
  const [hiddenCats, setHiddenCats] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedRel, setSelectedRel] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  /* ---------- 直接操作图谱用到的界面状态 ---------- */
  /** 悬停预览：节点 id / 连线 id */
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const [hoverLink, setHoverLink] = useState<string | null>(null);
  /** 画布内联改名 */
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  /** 连线模式：先点一个节点，再点另一个即可建立关系 */
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [lastType, setLastType] = useState(t('kind.relType.connected'));
  /** 右键快捷菜单 */
  const [menu, setMenu] = useState<
    { kind: 'node' | 'link'; id: string; x: number; y: number } | null
  >(null);
  /** 图例里正在改颜色的分类（浮层） */
  const [catColorFor, setCatColorFor] = useState<{ id: string; x: number; y: number } | null>(
    null,
  );
  /** 侧栏里正在编辑的关系类型（受控输入） */
  const [relTypeDraft, setRelTypeDraft] = useState('');

  const nodesRef = useRef<Map<string, SimNode>>(new Map());
  const rafRef = useRef<number | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ id: string | null; offsetX: number; offsetY: number; moved: boolean }>({
    id: null,
    offsetX: 0,
    offsetY: 0,
    moved: false,
  });

  const W = 960;
  const H = 620;

  /* ------------------ 颜色解析 ------------------ */
  /** 分类色：分类自带 color 优先，否则按顺序取调色板 */
  const catColorOf = useMemo(() => {
    const map = new Map<string, string>();
    store.categories.forEach((c, i) => map.set(c.id, c.color ?? PALETTE[i % PALETTE.length]));
    return map;
  }, [store.categories]);

  /** 节点色：条目自带 color 优先，否则用分类色 */
  const nodeColorOf = useCallback(
    (e: Entry) => e.color ?? catColorOf.get(e.categoryId) ?? '#546e7a',
    [catColorOf],
  );

  const visibleEntries = useMemo(
    () => store.entries.filter((e) => !hiddenCats.has(e.categoryId)),
    [store.entries, hiddenCats],
  );
  const visibleIds = useMemo(() => new Set(visibleEntries.map((e) => e.id)), [visibleEntries]);

  const links = useMemo(
    () =>
      store.relations.filter(
        (r) =>
          visibleIds.has(r.fromEntryId) &&
          visibleIds.has(r.toEntryId) &&
          (showPending || r.status === 'canon'),
      ),
    [store.relations, visibleIds, showPending],
  );

  /**
   * 图上真正画的线：互为反向的一对关系（A→B 且 B→A）合成一条**双箭头**边。
   * 弹簧、度（圆大小）都按这张归并后的图走 —— 两条线变成一条边，就该只算一份。
   * 概览里的「连线数」仍数原始关系（那是数据量，不是画面里几条边）。
   */
  const mergedLinks = useMemo(() => mergeMutual(links), [links]);

  /** 关系类型候选（给连线编辑做输入提示） */
  const typeSuggestions = useMemo(() => {
    const set = new Set<string>();
    store.relations.forEach((r) => r.type && set.add(r.type));
    if (!set.size)
      ['connected', 'membership', 'allegiance', 'hostility', 'location', 'kinship'].forEach((k) =>
        set.add(t.dyn('kind.relType.' + k)),
      );
    return [...set].slice(0, 30);
  }, [store.relations, t]);

  const entryById = useMemo(() => {
    const m = new Map<string, Entry>();
    store.entries.forEach((e) => m.set(e.id, e));
    return m;
  }, [store.entries]);

  /* ------------------ 视觉：联系的轻重 ------------------ */

  /**
   * 每个节点连了几条线。数的是**眼前这张图上的线** ——
   * 被藏起来的分类、关掉的待定关系都不算：画面里看不见的关系，不该让圆变大。
   * 双向合并成一条边之后，这里按边数（一条双向边算一份，不是两份）。
   */
  const degreeOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of mergedLinks) {
      const r = l.rels[0];
      m.set(r.fromEntryId, (m.get(r.fromEntryId) ?? 0) + 1);
      m.set(r.toEntryId, (m.get(r.toEntryId) ?? 0) + 1);
    }
    return m;
  }, [mergedLinks]);

  const maxDegree = useMemo(() => {
    let max = 0;
    for (const d of degreeOf.values()) if (d > max) max = d;
    return max;
  }, [degreeOf]);

  /** 图有多密（决定敢把轻的压多暗）与刻度两端的实际取值 */
  const density = densityOf(visibleEntries.length);
  const nodeOpaMin = 1 - (1 - O_MIN) * density;
  const labelOpaMin = 1 - (1 - LABEL_O_MIN) * density;

  /**
   * 选中某个节点时「还亮着」的那一圈：它自己 + 与它直接相连的。
   *
   * 顺手也把从前的写法改了 —— 以前是每个节点各自 `links.some(...)` 扫一遍，
   * O(节点 × 连线)；条目一多这正是最不该浪费的地方。现在一遍扫出集合，之后都是 O(1) 查表。
   */
  const litIds = useMemo(() => {
    if (!selected) return null;
    const s = new Set<string>([selected]);
    for (const l of links) {
      if (l.fromEntryId === selected) s.add(l.toEntryId);
      else if (l.toEntryId === selected) s.add(l.fromEntryId);
    }
    return s;
  }, [selected, links]);

  /** 密集图里连线的底色调淡一点、线细一点 —— 不然几十条线先糊成一张网 */
  const linkBaseOpacity = 1 - 0.28 * density;
  const linkBaseWidth = 1.3 - 0.3 * density;

  /* ------------------ 力导向布局 ------------------ */
  useEffect(() => {
    const map = nodesRef.current;
    const existing = new Set(map.keys());
    const next = new Set(visibleEntries.map((e) => e.id));
    for (const id of existing) if (!next.has(id)) map.delete(id);

    visibleEntries.forEach((e, i) => {
      if (!map.has(e.id)) {
        const a = (i / Math.max(1, visibleEntries.length)) * Math.PI * 2;
        const r = 160 + Math.random() * 90;
        map.set(e.id, {
          id: e.id,
          x: W / 2 + Math.cos(a) * r,
          y: H / 2 + Math.sin(a) * r,
          vx: 0,
          vy: 0,
        });
      }
    });

    let alpha = 1;
    const step = () => {
      const nodes = [...map.values()];
      const n = nodes.length;
      if (n === 0) {
        setTick((t) => t + 1);
        return;
      }

      // 斥力
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = nodes[i];
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            dx = Math.random() - 0.5;
            dy = Math.random() - 0.5;
            d2 = 1;
          }
          const d = Math.sqrt(d2);
          const rep = (2600 * alpha) / d2;
          const fx = (dx / d) * rep;
          const fy = (dy / d) * rep;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }

      // 弹簧：双向合并成一条边，这里按边算（一对反向关系只拉一根弹簧）
      for (const l of mergedLinks) {
        const r = l.rels[0];
        const a = map.get(r.fromEntryId);
        const b = map.get(r.toEntryId);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const k = (d - 128) * 0.02 * alpha;
        const fx = (dx / d) * k;
        const fy = (dy / d) * k;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }

      // 向心 + 阻尼 + 边界
      for (const nd of nodes) {
        nd.vx += (W / 2 - nd.x) * 0.0016 * alpha;
        nd.vy += (H / 2 - nd.y) * 0.0016 * alpha;
        if (nd.fixed) {
          nd.vx = 0;
          nd.vy = 0;
          continue;
        }
        nd.vx *= 0.86;
        nd.vy *= 0.86;
        nd.x += nd.vx;
        nd.y += nd.vy;
        nd.x = Math.max(38, Math.min(W - 38, nd.x));
        nd.y = Math.max(30, Math.min(H - 30, nd.y));
      }

      alpha = Math.max(0.06, alpha * 0.995);
      setTick((t) => t + 1);
      rafRef.current = requestAnimationFrame(step);
    };

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [visibleEntries, mergedLinks]);

  /* ------------------ 交互：选中 / 改名 / 连线 ------------------ */
  useEffect(() => {
    if (selectedRel) {
      const r = store.relations.find((x) => x.id === selectedRel);
      setRelTypeDraft(r?.type ?? '');
    }
  }, [selectedRel, store.relations]);

  /** Esc：依次退出连线模式 / 改名 / 菜单 / 选中 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (menu) setMenu(null);
      else if (catColorFor) setCatColorFor(null);
      else if (renaming) setRenaming(null);
      else if (linkFrom) setLinkFrom(null);
      else if (selectedRel) setSelectedRel(null);
      else if (selected) setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu, catColorFor, renaming, linkFrom, selected, selectedRel]);

  /** 点空白处关闭浮层（右键菜单 / 分类色板） */
  useEffect(() => {
    if (!menu && !catColorFor) return;
    const close = () => {
      setMenu(null);
      setCatColorFor(null);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu, catColorFor]);

  /** 改条目名（画布内联） */
  const commitRename = async () => {
    if (!renaming) return;
    const entry = entryById.get(renaming.id);
    const next = renaming.value.trim();
    setRenaming(null);
    if (!entry || !next || next === entry.title) return;
    await store.updateEntry(entry.id, { title: next });
    toast.success(t('graph.panel.toast.renamed', { name: next }));
  };

  /** 建立关系：连线模式下点第二个节点时触发 */
  const createLinkBetween = async (a: string, b: string) => {
    const worldId = store.activeWorld?.id;
    if (!worldId || a === b) return;
    const dup = store.relations.find(
      (r) =>
        (r.fromEntryId === a && r.toEntryId === b) || (r.fromEntryId === b && r.toEntryId === a),
    );
    if (dup) {
      setSelected(a);
      setSelectedRel(dup.id);
      setLinkFrom(null);
      toast.warn(t('graph.panel.toast.dupLink'));
      return;
    }
    const rel = await store.createRelation({
      worldId,
      fromEntryId: a,
      toEntryId: b,
      type: lastType || t('kind.relType.connected'),
      note: '',
      status: 'canon',
    });
    setLinkFrom(null);
    setSelected(a);
    setSelectedRel(rel.id);
    toast.success(
      t('graph.panel.toast.linkCreated', {
        from: entryById.get(a)?.title ?? '',
        to: entryById.get(b)?.title ?? '',
      }),
    );
  };

  const onNodeDown = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu(null);

    // 连线模式：这次点击当作「选终点」
    if (linkFrom) {
      if (linkFrom === id) {
        setLinkFrom(null);
        toast.warn(t('graph.panel.toast.linkCancelled'));
      } else {
        void createLinkBetween(linkFrom, id);
      }
      return;
    }

    const node = nodesRef.current.get(id);
    if (!node) return;
    const svg = (e.currentTarget as SVGElement).ownerSVGElement!;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const py = ((e.clientY - rect.top) / rect.height) * H;
    dragRef.current = { id, offsetX: node.x - px, offsetY: node.y - py, moved: false };
    node.fixed = true;

    const move = (ev: MouseEvent) => {
      const n = nodesRef.current.get(dragRef.current.id!);
      if (!n) return;
      const r2 = svg.getBoundingClientRect();
      const x = ((ev.clientX - r2.left) / r2.width) * W + dragRef.current.offsetX;
      const y = ((ev.clientY - r2.top) / r2.height) * H + dragRef.current.offsetY;
      if (Math.abs(x - n.x) > 1 || Math.abs(y - n.y) > 1) dragRef.current.moved = true;
      n.x = Math.max(38, Math.min(W - 38, x));
      n.y = Math.max(30, Math.min(H - 30, y));
    };
    const up = () => {
      const n = nodesRef.current.get(dragRef.current.id!);
      if (n) n.fixed = false;
      const moved = dragRef.current.moved;
      dragRef.current.id = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      // 没拖动 = 单击：选中（并清掉连线选中态）
      if (!moved) {
        setSelected(id);
        setSelectedRel(null);
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const onNodeContext = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ kind: 'node', id, x: e.clientX, y: e.clientY });
  };

  const onLinkContext = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ kind: 'link', id, x: e.clientX, y: e.clientY });
  };

  const recommendRelations = async () => {
    const res = await ai.run((opts) =>
      runRelations(store.settings.ai, store.activeWorld!, store.entries, store.categories, opts),
    );
    if (!res) return;
    if (!res.items.length) {
      toast.warn(t('graph.panel.toast.noSuggestions'));
      return;
    }
    await store.pushReview(res.items);
    toast.success(t('graph.panel.toast.recommended', { n: res.items.length }));
  };

  if (!store.activeWorld) return <Empty icon="🌍" title={t('graph.panel.noWorld')} />;

  const nodes = [...nodesRef.current.values()];
  const selectedEntry = selected ? (entryById.get(selected) ?? null) : null;
  const selectedCat = selectedEntry
    ? store.categories.find((c) => c.id === selectedEntry.categoryId)
    : undefined;
  const selectedRels = selected
    ? store.relations.filter((r) => r.fromEntryId === selected || r.toEntryId === selected)
    : [];
  const relInPanel = selectedRel ? (store.relations.find((r) => r.id === selectedRel) ?? null) : null;

  const hoverEntry = hoverNode ? (entryById.get(hoverNode) ?? null) : null;
  const hoverSim = hoverNode ? nodesRef.current.get(hoverNode) : undefined;
  const hoverRel = hoverLink ? (store.relations.find((r) => r.id === hoverLink) ?? null) : null;
  const hoverRelSim =
    hoverRel && hoverLink
      ? {
          a: nodesRef.current.get(hoverRel.fromEntryId),
          b: nodesRef.current.get(hoverRel.toEntryId),
        }
      : null;

  const menuRel = menu?.kind === 'link' ? store.relations.find((r) => r.id === menu.id) : null;
  const menuEntry = menu?.kind === 'node' ? entryById.get(menu.id) : null;

  /** 悬停卡片：按节点位置决定贴在下方还是上方，避免被画布边缘裁掉 */
  const pctOf = (x: number, y: number) => ({
    left: `${(x / W) * 100}%`,
    top: `${(y / H) * 100}%`,
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('graph.title')}</h1>
          <div className="row" style={{ gap: 4, marginTop: 6 }} data-role="graph-view">
            {/*
              切换位上只有两支：编年（第一入口）与关系。旧的那支点轴从这里撤了 ——
              它从编年右下角的「旧的」进；落回这一支时按「编年」高亮，
              让作者有路可退（点它就是回到编年）。
            */}
            <button
              className={`btn sm ${view === 'relations' ? 'primary' : 'ghost'}`}
              data-role="graph-view-relations"
              title={t('graph.view.relationsHint')}
              onClick={() => setView('relations')}
            >
              <IcGraph size={14} /> {t('graph.view.relations')}
            </button>
            <button
              className={`btn sm ${view !== 'relations' ? 'primary' : 'ghost'}`}
              data-role="graph-view-chronicle"
              title={t('graph.view.chronicleHint')}
              onClick={() => setView('chronicle')}
            >
              <IcBook size={14} /> {t('graph.view.chronicle')}
              {!!store.timedEntries.length && (
                <span className="muted tiny" style={{ marginLeft: 4 }}>
                  {t('graph.view.timeBadge', { n: String(store.timedEntries.length) })}
                </span>
              )}
            </button>
          </div>
          <p className="page-desc" style={{ marginTop: 6 }}>
            {view === 'relations'
              ? t('graph.panel.desc')
              : view === 'chronicle'
                ? t('chron.view.desc')
                : t('time.view.desc')}
          </p>
        </div>
        <div className="page-actions">
          {view === 'relations' && (
            <>
              <label className="row small" style={{ gap: 6, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={showPending}
                  onChange={(e) => setShowPending(e.target.checked)}
                />
                {t('graph.panel.showPending')}
              </label>
              <label
                className="row small"
                style={{ gap: 6, alignItems: 'center' }}
                title={t('graph.panel.byWeightHint')}
              >
                <input
                  type="checkbox"
                  data-role="graph-by-weight"
                  checked={byWeight}
                  onChange={(e) => setByWeight(e.target.checked)}
                />
                {t('graph.panel.byWeight')}
              </label>
              <button
                className={`btn sm ${linkFrom ? 'primary' : ''}`}
                onClick={() => {
                  if (linkFrom) {
                    setLinkFrom(null);
                    return;
                  }
                  if (!selected) {
                    toast.warn(t('graph.panel.toast.needNode'));
                    return;
                  }
                  setLinkFrom(selected);
                }}
                title={t('graph.panel.startLinkHint')}
              >
                <IcLink size={14} />{' '}
                {linkFrom ? t('graph.link.cancel') : t('graph.link.label')}
              </button>
              <button
                className="btn sm"
                data-role="graph-ai-recommend"
                onClick={recommendRelations}
                disabled={ai.loading}
              >
                {ai.loading ? <span className="spinner dark" /> : <IcSparkles size={14} />}
                {t('graph.panel.aiRecommend')}
              </button>
              {ai.loading && (
                <button className="btn sm" onClick={ai.abort}>
                  <IcStop size={14} />
                </button>
              )}
              <button className="btn sm" onClick={() => setTick((t) => t + 1)}>
                <IcRefresh size={14} /> {t('graph.panel.relayout')}
              </button>
            </>
          )}
        </div>
      </div>

      {view === 'chronicle' ? (
        <ChronicleView
          onOpenEntry={onOpenEntry}
          onGoRelations={() => setView('relations')}
          onGoReview={onGoReview}
          onOldView={() => setView('time')}
        />
      ) : view === 'time' ? (
        <TimeAxis
          onOpenEntry={onOpenEntry}
          onGoRelations={() => setView('relations')}
          onGoReview={onGoReview}
        />
      ) : (
        <>

      {linkFrom && (
        <div className="banner info" style={{ marginBottom: 12 }}>
          <IcLink size={15} />
          <div>
            {t('graph.panel.linkBanner', {
              from: entryById.get(linkFrom)?.title ?? '',
              type: lastType,
            })}
          </div>
        </div>
      )}

      <div className="split" style={{ gridTemplateColumns: 'minmax(0,1fr) 340px' }}>
        <div>
          <div className="graph-wrap" ref={wrapRef}>
            <svg
              className={`graph-svg ${linkFrom ? 'linking' : ''}`}
              viewBox={`0 0 ${W} ${H}`}
              style={{ height: 620 }}
              onMouseDown={() => {
                setMenu(null);
                setSelected(null);
                setSelectedRel(null);
                setLinkFrom(null);
              }}
            >
              <defs>
                <marker
                  id="arrow"
                  viewBox="0 0 10 10"
                  refX="22"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#9aa9bb" />
                </marker>
                <marker
                  id="arrow-hot"
                  viewBox="0 0 10 10"
                  refX="22"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#2f6fb0" />
                </marker>
              </defs>

              {mergedLinks.map((m) => {
                const l = m.rels[0];
                const a = nodesRef.current.get(l.fromEntryId);
                const b = nodesRef.current.get(l.toEntryId);
                if (!a || !b) return null;
                const dim =
                  !!selected && l.fromEntryId !== selected && l.toEntryId !== selected;
                // 双向边：任一方向的关系被悬停/选中，整条边都算「热」
                const hot = m.rels.some(
                  (r) => hoverLink === r.id || selectedRel === r.id,
                );
                const pending = m.rels.some((r) => r.status === 'pending');
                // 双向标签：两个方向各有一句类型，用 ⇄ 接起来（相同则只写一个）
                const label = m.mutual
                  ? m.rels[0].type === m.rels[1].type
                    ? m.rels[0].type
                    : `${m.rels[0].type}${t('graph.mutualSep')}${m.rels[1].type}`
                  : l.type;
                return (
                  <g
                    key={l.id}
                    data-link={l.id}
                    data-mutual={m.mutual ? 'true' : undefined}
                    opacity={linkBaseOpacity * (dim ? 0.18 : 1)}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() => !dragRef.current.id && setHoverLink(l.id)}
                    onMouseLeave={() => setHoverLink((h) => (h === l.id ? null : h))}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setMenu(null);
                      setHoverLink(null);
                      setSelectedRel(l.id);
                      setSelected(null);
                    }}
                    onContextMenu={(e) => onLinkContext(e, l.id)}
                  >
                    {/* 加宽的透明热区：细线也能轻松点到 */}
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="transparent"
                      strokeWidth={LINK_HIT_W}
                    />
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke={hot ? '#2f6fb0' : pending ? '#c9a227' : '#9aa9bb'}
                      strokeWidth={hot ? 2.6 : linkBaseWidth}
                      strokeDasharray={pending && !hot ? '5 4' : undefined}
                      markerEnd={hot ? 'url(#arrow-hot)' : 'url(#arrow)'}
                      /* 双向：起点也画一个箭头，变成一条双箭头边 */
                      markerStart={m.mutual ? (hot ? 'url(#arrow-hot)' : 'url(#arrow)') : undefined}
                    />
                    <text
                      x={(a.x + b.x) / 2}
                      y={(a.y + b.y) / 2 - 3}
                      fontSize={hot ? 10.5 : 9.5}
                      fontWeight={hot ? 700 : 400}
                      fill={hot ? '#2f6fb0' : '#7d8a9c'}
                      /* 线一多，「关联」两个字会先糊成一片 —— 密集时压淡，指到哪条再读全 */
                      opacity={hot ? 1 : 1 - 0.5 * density}
                      textAnchor="middle"
                      stroke="#fff"
                      strokeWidth="3"
                      paintOrder="stroke"
                      style={{ pointerEvents: 'none' }}
                    >
                      {label}
                    </text>
                  </g>
                );
              })}

              {nodes.map((n) => {
                const entry = entryById.get(n.id);
                if (!entry) return null;
                const color = nodeColorOf(entry);
                const isSel = selected === n.id;
                const isLinkFrom = linkFrom === n.id;
                const isHover = hoverNode === n.id;
                const dim = !!litIds && !litIds.has(n.id);
                /** 选中/悬停/邻居的名字都强制读得清 —— 不然轻的节点一被点亮还是个糊字 */
                const labelBright = isSel || isHover || !!litIds?.has(n.id) || !byWeight;

                // 联系的多少 → 圆多大、有多实
                const degree = degreeOf.get(n.id) ?? 0;
                const w = weightOf(degree, maxDegree);
                const rBase = byWeight ? R_MIN + (R_MAX - R_MIN) * w.radius : R_FLAT;
                const r = rBase + (isSel || isHover ? R_FOCUS : 0);
                const dotOpacity =
                  (byWeight ? nodeOpaMin + (1 - nodeOpaMin) * w.opacity : 1) *
                  (entry.status === 'canon' ? 1 : 0.8) *
                  (dim ? 0.3 : 1);
                const labelOpacity = labelBright
                  ? 1
                  : (byWeight ? labelOpaMin + (1 - labelOpaMin) * w.opacity : 1) *
                    (dim ? 0.3 : 1);
                const labelSize = byWeight ? 9.5 + 2.5 * w.radius : 11;
                return (
                  <g
                    key={n.id}
                    data-node={n.id}
                    data-degree={degree}
                    style={{ cursor: linkFrom ? 'crosshair' : 'pointer' }}
                    onMouseDown={(e) => onNodeDown(e, n.id)}
                    onMouseEnter={() => !dragRef.current.id && setHoverNode(n.id)}
                    onMouseLeave={() => setHoverNode((h) => (h === n.id ? null : h))}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setHoverNode(null);
                      setRenaming({ id: n.id, value: entry.title });
                    }}
                    onContextMenu={(e) => onNodeContext(e, n.id)}
                  >
                    {(isLinkFrom || isHover) && (
                      <circle
                        data-role="node-ring"
                        cx={n.x}
                        cy={n.y}
                        r={r + 7}
                        fill="none"
                        stroke={color}
                        strokeWidth={isLinkFrom ? 2.4 : 1.4}
                        opacity={(isLinkFrom ? 0.85 : 0.45) * (dim ? 0.3 : 1)}
                        strokeDasharray={isLinkFrom ? '4 3' : undefined}
                      />
                    )}
                    <circle
                      data-role="node-dot"
                      cx={n.x}
                      cy={n.y}
                      r={r}
                      fill={color}
                      stroke="#fff"
                      strokeWidth={isSel ? 3 : 1.6}
                      opacity={dotOpacity}
                    />
                    <text
                      data-role="node-label"
                      x={n.x}
                      y={n.y + r + 12}
                      fontSize={labelSize}
                      fill="#41505f"
                      textAnchor="middle"
                      stroke="#fff"
                      strokeWidth="3"
                      paintOrder="stroke"
                      opacity={labelOpacity}
                      style={{ pointerEvents: 'none', fontWeight: isSel ? 700 : 500 }}
                    >
                      {entry.title.length > 9 ? entry.title.slice(0, 9) + '…' : entry.title}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* ---------- 悬停预览卡（节点） ---------- */}
            {hoverEntry && hoverSim && !dragRef.current.id && !renaming && !menu && (
              <div
                className={`gx-hover ${hoverSim.y > H * 0.62 ? 'above' : 'below'} ${
                  hoverSim.x > W * 0.66 ? 'right' : hoverSim.x < W * 0.34 ? 'left' : ''
                }`}
                style={pctOf(hoverSim.x, hoverSim.y)}
              >
                <div className="gx-hover-head">
                  <span className="gx-dot" style={{ background: nodeColorOf(hoverEntry) }} />
                  <span className="gx-hover-title">{hoverEntry.title}</span>
                  <span className={`pill tiny ${hoverEntry.status}`}>
                    {t.dyn('kind.status.' + hoverEntry.status)}
                  </span>
                </div>
                <div className="gx-hover-meta">
                  {store.categories.find((c) => c.id === hoverEntry.categoryId)?.icon}{' '}
                  {categoriesName(store.categories, hoverEntry.categoryId, t)}
                  {hoverEntry.aliases.length
                    ? t('graph.hover.aliases', { names: hoverEntry.aliases.join(t('common.listSep')) })
                    : ''}
                </div>
                {hoverEntry.summary && <div className="gx-hover-sum">{hoverEntry.summary}</div>}
                {hoverEntry.tags.length > 0 && (
                  <div className="gx-hover-tags">
                    {hoverEntry.tags.slice(0, 5).map((t) => (
                      <span key={t} className="pill tiny">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                <div className="gx-hover-rels">
                  {linkPreview(hoverEntry, store.relations, entryById, t)}
                </div>
                <div className="gx-hover-foot">{t('graph.hover.footNode')}</div>
              </div>
            )}

            {/* ---------- 悬停预览卡（连线） ---------- */}
            {hoverRel && hoverRelSim?.a && hoverRelSim?.b && !dragRef.current.id && !menu && (
              <div
                className="gx-hover gx-hover-link below"
                style={pctOf(
                  (hoverRelSim.a.x + hoverRelSim.b.x) / 2,
                  (hoverRelSim.a.y + hoverRelSim.b.y) / 2,
                )}
              >
                <div className="gx-hover-head">
                  <span className="gx-dot" style={{ background: '#2f6fb0' }} />
                  <span className="gx-hover-title">{hoverRel.type}</span>
                  <span className="pill tiny">
                    {t.dyn('kind.rel.' + hoverRel.status)}
                  </span>
                </div>
                <div className="gx-hover-meta">
                  {entryById.get(hoverRel.fromEntryId)?.title} →{' '}
                  {entryById.get(hoverRel.toEntryId)?.title}
                </div>
                {hoverRel.note && <div className="gx-hover-sum">{hoverRel.note}</div>}
                <div className="gx-hover-foot">{t('graph.hover.footLink')}</div>
              </div>
            )}

            {/* ---------- 画布内联改名 ---------- */}
            {renaming && (() => {
              const n = nodesRef.current.get(renaming.id);
              if (!n) return null;
              return (
                <input
                  className="gx-rename"
                  style={pctOf(n.x, n.y)}
                  value={renaming.value}
                  autoFocus
                  onChange={(e) => setRenaming({ id: renaming.id, value: e.target.value })}
                  onMouseDown={(e) => e.stopPropagation()}
                  onBlur={() => void commitRename()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void commitRename();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                  placeholder={t('graph.panel.entry.namePlaceholder')}
                />
              );
            })()}

            {/* ---------- 右键快捷菜单 ---------- */}
            {menu && (
              <div
                className="gx-menu"
                style={menuPos(menu)}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {menu.kind === 'node' && menuEntry && (
                  <>
                    <div className="gx-menu-title">{menuEntry.title}</div>
                    <button
                      className="gx-menu-item"
                      onClick={() => {
                        setRenaming({ id: menuEntry.id, value: menuEntry.title });
                        setMenu(null);
                      }}
                    >
                      <IcEdit size={13} /> {t('graph.menu.rename')}
                    </button>
                    <div className="gx-menu-label">{t('graph.menu.nodeColor')}</div>
                    <Swatches
                      value={menuEntry.color}
                      fallback={catColorOf.get(menuEntry.categoryId) ?? '#546e7a'}
                      allowReset={!!menuEntry.color}
                      resetLabel={t('graph.followCategory')}
                      onPick={(c) => {
                        void store.updateEntry(menuEntry.id, { color: c });
                        setMenu(null);
                      }}
                    />
                    <div className="gx-menu-label">
                      {t('graph.menu.categoryColor', {
                        name: categoriesName(store.categories, menuEntry.categoryId, t),
                      })}
                    </div>
                    <Swatches
                      value={store.categories.find((c) => c.id === menuEntry.categoryId)?.color}
                      fallback={catColorOf.get(menuEntry.categoryId) ?? '#546e7a'}
                      allowReset
                      onPick={(c) => {
                        const cat = store.categories.find((x) => x.id === menuEntry.categoryId);
                        if (cat) void store.updateCategory(cat.id, { color: c });
                        setMenu(null);
                      }}
                    />
                    <div className="gx-menu-sep" />
                    <button
                      className="gx-menu-item"
                      onClick={() => {
                        setSelected(menuEntry.id);
                        setSelectedRel(null);
                        setLinkFrom(menuEntry.id);
                        setMenu(null);
                      }}
                    >
                      <IcLink size={13} /> {t('graph.menu.linkFromHere')}
                    </button>
                    <button
                      className="gx-menu-item"
                      onClick={() => {
                        onOpenEntry?.(menuEntry.id);
                        setMenu(null);
                      }}
                    >
                      <IcEdit size={13} /> {t('graph.openEntry')}
                    </button>
                    <div className="gx-menu-sep" />
                    <button
                      className="gx-menu-item danger"
                      onClick={async () => {
                        const id = menuEntry.id;
                        setMenu(null);
                        if (
                          !window.confirm(
                            t('graph.menu.confirmDeleteEntry', { name: menuEntry.title }),
                          )
                        )
                          return;
                        await store.deleteEntry(id);
                        if (selected === id) setSelected(null);
                        toast.success(t('graph.panel.toast.entryDeleted'));
                      }}
                    >
                      <IcTrash size={13} /> {t('graph.menu.deleteEntry')}
                    </button>
                  </>
                )}

                {menu.kind === 'link' && menuRel && (
                  <>
                    <div className="gx-menu-title">
                      {entryById.get(menuRel.fromEntryId)?.title} →{' '}
                      {entryById.get(menuRel.toEntryId)?.title}
                    </div>
                    <div className="gx-menu-label">{t('graph.menu.relType')}</div>
                    <input
                      className="input gx-menu-input"
                      list="gx-type-list"
                      defaultValue={menuRel.type}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const v = (e.target as HTMLInputElement).value.trim();
                          if (v) void store.updateRelation(menuRel.id, { type: v });
                          setLastType(v || menuRel.type);
                          setMenu(null);
                        }
                      }}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== menuRel.type) {
                          void store.updateRelation(menuRel.id, { type: v });
                          setLastType(v);
                        }
                        setMenu(null);
                      }}
                    />
                    <button
                      className="gx-menu-item"
                      onClick={() => {
                        void store.updateRelation(menuRel.id, {
                          fromEntryId: menuRel.toEntryId,
                          toEntryId: menuRel.fromEntryId,
                        });
                        setMenu(null);
                        toast.success(t('graph.panel.toast.dirReversed'));
                      }}
                    >
                      <IcSwap size={13} /> {t('graph.menu.reverse')}
                    </button>
                    <button
                      className="gx-menu-item"
                      onClick={() => {
                        void store.updateRelation(menuRel.id, {
                          status: menuRel.status === 'pending' ? 'canon' : 'pending',
                        });
                        setMenu(null);
                      }}
                    >
                      {menuRel.status === 'pending'
                        ? t('graph.menu.markCanon')
                        : t('graph.menu.markPending')}
                    </button>
                    <div className="gx-menu-sep" />
                    <button
                      className="gx-menu-item danger"
                      onClick={() => {
                        void store.deleteRelation(menuRel.id);
                        if (selectedRel === menuRel.id) setSelectedRel(null);
                        setMenu(null);
                        toast.success(t('graph.panel.toast.linkDeleted'));
                      }}
                    >
                      <IcTrash size={13} /> {t('graph.menu.deleteLink')}
                    </button>
                  </>
                )}
              </div>
            )}

            <div className="graph-legend">
              {store.categories.map((c) => {
                const count = store.entries.filter((e) => e.categoryId === c.id).length;
                return (
                  <span
                    key={c.id}
                    className="gx-legend"
                    style={{ opacity: hiddenCats.has(c.id) ? 0.35 : 1 }}
                  >
                    <button
                      className="legend-dot-btn"
                      style={{ background: catColorOf.get(c.id) }}
                      title={t('graph.legend.dotHint')}
                      onClick={(e) => {
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setCatColorFor(catColorFor?.id === c.id ? null : { id: c.id, x: r.left, y: r.top });
                      }}
                    />
                    <span
                      className="pointer"
                      onClick={() =>
                        // 必须用函数式更新：两次点击若落在同一个 tick 里（脚本、连点），
                        // 闭包里的 hiddenCats 还是同一份旧集合，后一次会把前一次覆盖掉 ——
                        // 点两下只藏住一个分类。
                        setHiddenCats((prev) => {
                          const next = new Set(prev);
                          if (next.has(c.id)) next.delete(c.id);
                          else next.add(c.id);
                          return next;
                        })
                      }
                      title={t('graph.legend.toggleHint')}
                    >
                      {t('graph.legend.count', { name: c.name, n: count })}
                    </span>
                  </span>
                );
              })}
              {byWeight && (
                <span
                  className="gx-weight-legend"
                  data-role="graph-weight-legend"
                  title={t('graph.legend.weightHint')}
                >
                  {t('graph.legend.weight')}
                  {/* 三档示意：这里画的正是坐标轴本身，所以尺寸/透明度直接照刻度取值 */}
                  <svg width="58" height="18" viewBox="0 0 58 18" aria-hidden="true">
                    <circle cx="8" cy="9" r="4" fill="#546e7a" opacity={O_MIN} />
                    <circle cx="26" cy="9" r="6" fill="#546e7a" opacity={(O_MIN + 1) / 2} />
                    <circle cx="46" cy="9" r="8" fill="#546e7a" opacity="1" />
                  </svg>
                </span>
              )}
              <span className="muted">{t('graph.legend.tips')}</span>

              {catColorFor &&
                (() => {
                  const c = store.categories.find((x) => x.id === catColorFor.id);
                  if (!c) return null;
                  return (
                    <div className="gx-cat-pop" style={catPopPos(catColorFor)}>
                      <div className="gx-menu-title">
                        {c.icon} {t('graph.legend.catColorTitle', { name: c.name })}
                      </div>
                      <Swatches
                        value={c.color}
                        fallback={catColorOf.get(c.id) ?? '#546e7a'}
                        allowReset
                        onPick={(col) => {
                          void store.updateCategory(c.id, { color: col });
                          setCatColorFor(null);
                        }}
                      />
                      <div className="gx-menu-label">
                        {t('graph.legend.catColorHint', {
                          n: store.entries.filter((e) => e.categoryId === c.id).length,
                        })}
                      </div>
                    </div>
                  );
                })()}
            </div>
          </div>
        </div>

        {/* -------------------- 右侧：概览 / 条目快改 / 连线快改 -------------------- */}
        <div className="cat-list gx-panel" style={{ position: 'sticky', top: 26 }}>
          {relInPanel ? (
            <RelEditor
              rel={relInPanel}
              store={store}
              entryById={entryById}
              typeList={typeSuggestions}
              onChangeType={(v) => {
                setRelTypeDraft(v);
                setLastType(v);
                void store.updateRelation(relInPanel.id, { type: v });
              }}
              onClose={() => setSelectedRel(null)}
              onSelectNode={(id) => {
                setSelected(id);
                setSelectedRel(null);
              }}
            />
          ) : selectedEntry ? (
            <EntryQuickPanel
              entry={selectedEntry}
              store={store}
              catColorOf={catColorOf}
              selectedRels={selectedRels}
              entryById={entryById}
              typeList={typeSuggestions}
              onPickNode={(id) => setSelected(id)}
              onPickRel={setSelectedRel}
              onStartLink={() => setLinkFrom(selectedEntry.id)}
              onRenameStart={() => setRenaming({ id: selectedEntry.id, value: selectedEntry.title })}
              onOpenEntry={() => onOpenEntry?.(selectedEntry.id)}
              onClose={() => setSelected(null)}
            />
          ) : (
            <>
              <div className="bold" style={{ fontSize: 13.5 }}>
                {t('graph.panel.overview.title')}
              </div>
              <div className="divider" />
              <dl className="kv" style={{ gridTemplateColumns: '80px 1fr' }}>
                <dt>{t('graph.panel.overview.nodes')}</dt>
                <dd>{visibleEntries.length}</dd>
                <dt>{t('graph.panel.overview.links')}</dt>
                <dd>{links.length}</dd>
                <dt>{t('graph.panel.overview.isolated')}</dt>
                <dd>
                  {
                    visibleEntries.filter(
                      (e) =>
                        !store.relations.some(
                          (r) => r.fromEntryId === e.id || r.toEntryId === e.id,
                        ),
                    ).length
                  }
                </dd>
                <dt>{t('graph.panel.overview.densest')}</dt>
                <dd data-role="graph-max-degree">{maxDegree}</dd>
              </dl>
              <div className="field-hint mt12">{t('graph.panel.overview.hint')}</div>
              <div className="divider" />
              <div className="bold tiny soft" style={{ marginBottom: 7 }}>
                {t('graph.panel.overview.glossary')}
              </div>
              <ul className="gx-help">
                <li>{t('graph.panel.overview.help1')}</li>
                <li>{t('graph.panel.overview.help2')}</li>
                <li>{t('graph.panel.overview.help3')}</li>
                <li>{t('graph.panel.overview.help4')}</li>
                <li>{t('graph.panel.overview.help5')}</li>
                <li>{t('graph.panel.overview.help6')}</li>
                <li>{t('graph.panel.overview.help7')}</li>
              </ul>
              {ai.loading && ai.stream && (
                <div className="stream-box mt12" style={{ maxHeight: 140 }}>
                  {ai.stream.slice(-1200)}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 关系类型候选（给右键菜单与侧栏输入做联想） */}
      <datalist id="gx-type-list">
        {typeSuggestions.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 辅助                                                                */
/* ------------------------------------------------------------------ */

function categoriesName(cats: { id: string; name: string }[], id: string, t: TFunc): string {
  return cats.find((c) => c.id === id)?.name ?? t('graph.uncategorized');
}

/** 悬停卡片里的「几条关系」摘要 */
function linkPreview(
  entry: Entry,
  relations: Relation[],
  entryById: Map<string, Entry>,
  t: TFunc,
): React.ReactNode {
  const rels = relations.filter(
    (r) => r.fromEntryId === entry.id || r.toEntryId === entry.id,
  );
  if (!rels.length) return <span className="muted tiny">{t('graph.noRelations')}</span>;
  return (
    <>
      <span className="muted tiny">{t('graph.hover.relCount', { n: rels.length })}</span>
      {rels.slice(0, 3).map((r) => {
        const isFrom = r.fromEntryId === entry.id;
        const other = entryById.get(isFrom ? r.toEntryId : r.fromEntryId);
        return (
          <span key={r.id} className="gx-rel-chip">
            {isFrom ? '→' : '←'} {r.type} {other?.title}
          </span>
        );
      })}
      {rels.length > 3 && (
        <span className="muted tiny">{t('graph.hover.relMore', { n: rels.length })}</span>
      )}
    </>
  );
}

/** 右键菜单定位：固定定位贴住鼠标，并避免超出视口（画布有 overflow:hidden，不能用绝对定位） */
function menuPos(menu: { x: number; y: number }): React.CSSProperties {
  const W_MENU = 250;
  const H_MENU = 400;
  const x = Math.min(menu.x, Math.max(8, window.innerWidth - W_MENU - 12));
  const y = Math.min(menu.y, Math.max(8, window.innerHeight - H_MENU - 12));
  return { position: 'fixed', left: Math.max(8, x), top: Math.max(8, y) };
}

/** 分类色板浮层：挂在图例圆点上方（图例在画布底部，向上开才不会被裁） */
function catPopPos(anchor: { x: number; y: number }): React.CSSProperties {
  const W_POP = 240;
  const H_POP = 150;
  const x = Math.min(anchor.x, Math.max(8, window.innerWidth - W_POP - 12));
  const y = Math.max(8, anchor.y - H_POP - 10);
  return { position: 'fixed', left: x, top: y };
}

/* ------------------------------------------------------------------ */
/* 侧栏：条目快速编辑                                                   */
/* ------------------------------------------------------------------ */

function EntryQuickPanel({
  entry,
  store,
  catColorOf,
  selectedRels,
  entryById,
  typeList,
  onPickNode,
  onPickRel,
  onStartLink,
  onRenameStart,
  onOpenEntry,
  onClose,
}: {
  entry: Entry;
  store: ReturnType<typeof useStore>;
  catColorOf: Map<string, string>;
  selectedRels: Relation[];
  entryById: Map<string, Entry>;
  typeList: string[];
  onPickNode: (id: string) => void;
  onPickRel: (id: string) => void;
  onStartLink: () => void;
  onRenameStart: () => void;
  onOpenEntry: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const t = useT();
  const [title, setTitle] = useState(entry.title);
  useEffect(() => setTitle(entry.title), [entry.id, entry.title]);

  const cat = store.categories.find((c) => c.id === entry.categoryId);

  const saveTitle = () => {
    const v = title.trim();
    if (!v || v === entry.title) {
      setTitle(entry.title);
      return;
    }
    void store.updateEntry(entry.id, { title: v });
    toast.success(t('graph.panel.toast.renamed', { name: v }));
  };

  return (
    <>
      <div className="row" style={{ gap: 6, alignItems: 'center' }}>
        <span className="muted tiny">{t('graph.panel.entry.label')}</span>
        <span className="muted tiny" style={{ marginLeft: 'auto' }}>
          {t('graph.panel.entry.selectHint')}
        </span>
      </div>
      <input
        className="input gx-title-input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={saveTitle}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setTitle(entry.title);
        }}
        placeholder={t('graph.panel.entry.namePlaceholder')}
      />
      <div className="field-hint" style={{ marginTop: 4 }}>
        {t('graph.panel.entry.saveHint')}
        <button className="gx-inline-btn" onClick={onRenameStart}>
          {t('graph.panel.entry.renameOnCanvas')}
        </button>
      </div>

      <div className="divider" />
      <div className="gx-row">
        <span className="gx-row-label">{t('graph.panel.entry.category')}</span>
        <select
          className="input"
          value={entry.categoryId}
          onChange={(e) => void store.updateEntry(entry.id, { categoryId: e.target.value })}
        >
          {store.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon} {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="gx-row">
        <span className="gx-row-label">{t('graph.panel.entry.status')}</span>
        <div className="gx-seg">
          {(['draft', 'pending', 'canon'] as EntryStatus[]).map((s) => (
            <button
              key={s}
              className={`gx-seg-btn ${entry.status === s ? 'on' : ''}`}
              onClick={() => void store.updateEntry(entry.id, { status: s })}
            >
              {t.dyn('kind.status.' + s)}
            </button>
          ))}
        </div>
      </div>

      <div className="gx-row" style={{ alignItems: 'flex-start' }}>
        <span className="gx-row-label">{t('graph.panel.entry.nodeColor')}</span>
        <Swatches
          value={entry.color}
          fallback={catColorOf.get(entry.categoryId) ?? '#546e7a'}
          allowReset={!!entry.color}
          resetLabel={t('graph.followCategory')}
          onPick={(c) => void store.updateEntry(entry.id, { color: c })}
        />
      </div>
      {cat && (
        <div className="gx-row" style={{ alignItems: 'flex-start' }}>
          <span className="gx-row-label">{t('graph.panel.entry.categoryColor')}</span>
          <Swatches
            value={cat.color}
            fallback={catColorOf.get(cat.id) ?? '#546e7a'}
            allowReset={!!cat.color}
            onPick={(c) => void store.updateCategory(cat.id, { color: c })}
          />
        </div>
      )}

      {entry.aliases.length > 0 && (
        <div className="muted tiny mt8">
          {t('graph.panel.entry.aliases', { names: entry.aliases.join(t('common.listSep')) })}
        </div>
      )}
      {entry.summary && <div className="soft small mt8 gx-sum">{entry.summary}</div>}
      {entry.tags.length > 0 && (
        <div className="row mt8" style={{ gap: 4, flexWrap: 'wrap' }}>
          {entry.tags.map((t) => (
            <span key={t} className="pill tiny">
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="divider" />
      <div className="row" style={{ alignItems: 'center' }}>
        <span className="bold tiny soft">
          {t('graph.panel.entry.relsTitle', { n: selectedRels.length })}
        </span>
        <button
          className="btn sm"
          style={{ marginLeft: 'auto' }}
          onClick={onStartLink}
          title={t('graph.panel.entry.linkHint')}
        >
          <IcLink size={13} /> {t('graph.link.label')}
        </button>
      </div>
      <div className="mt8">
        {selectedRels.length === 0 && (
          <div className="muted tiny">{t('graph.noRelations')}</div>
        )}
        {mergeMutualOf(entry.id, selectedRels).map((m) => {
          const r = m.rels[0];
          const isFrom = r.fromEntryId === entry.id;
          const other = entryById.get(isFrom ? r.toEntryId : r.fromEntryId);
          // 双向时，rels[0] 是从「本条目」出发那条，rels[1] 是从对端回来那条
          const back = m.mutual ? m.rels[1] : null;
          return (
            <div key={r.id} className="gx-rel-row" data-mutual={m.mutual ? 'true' : undefined}>
              <input
                className="input gx-rel-type"
                list="gx-type-list"
                defaultValue={r.type}
                title={t('graph.panel.entry.relTypeHint')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const v = (e.target as HTMLInputElement).value.trim();
                    if (v) void store.updateRelation(r.id, { type: v });
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== r.type) void store.updateRelation(r.id, { type: v });
                }}
              />
              <span className="gx-rel-dir">{m.mutual ? '⇄' : isFrom ? '→' : '←'}</span>
              <span
                className="gx-rel-other pointer"
                onClick={() => onPickNode(other?.id ?? '')}
                title={t('graph.panel.entry.jumpHint')}
              >
                {other?.title ?? t('graph.deleted')}
              </span>
              {/* 双向：把「回来」那条的类型也摆出来，两个方向各说各的 */}
              {back && (
                <span className="gx-rel-back" title={t('entries.rel.mutual')}>
                  {back.type}
                </span>
              )}
              <button
                className={`gx-rel-status ${r.status}`}
                title={
                  r.status === 'pending'
                    ? t('graph.panel.entry.relStatusPendingHint')
                    : t('graph.panel.entry.relStatusCanonHint')
                }
                onClick={() =>
                  void store.updateRelation(r.id, {
                    status: r.status === 'pending' ? 'canon' : 'pending',
                  })
                }
              />
              <button
                className="gx-icon-btn"
                title={t('graph.menu.reverse')}
                onClick={() =>
                  void store.updateRelation(r.id, {
                    fromEntryId: r.toEntryId,
                    toEntryId: r.fromEntryId,
                  })
                }
              >
                <IcSwap size={12} />
              </button>
              <button
                className="gx-icon-btn danger"
                title={t('graph.menu.deleteLink')}
                onClick={() => {
                  // 双向：删掉这一对；单向：只删这一条
                  for (const rr of m.rels) void store.deleteRelation(rr.id);
                  toast.success(t('graph.panel.toast.linkDeleted'));
                }}
              >
                <IcTrash size={12} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="divider" />
      <div className="row" style={{ gap: 6 }}>
        <button className="btn sm" onClick={onOpenEntry}>
          <IcEdit size={13} /> {t('graph.openEntry')}
        </button>
        <button className="btn sm ghost" onClick={onClose}>
          {t('graph.panel.entry.deselect')}
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 侧栏：连线编辑                                                       */
/* ------------------------------------------------------------------ */

function RelEditor({
  rel,
  store,
  entryById,
  typeList,
  onChangeType,
  onClose,
  onSelectNode,
}: {
  rel: Relation;
  store: ReturnType<typeof useStore>;
  entryById: Map<string, Entry>;
  typeList: string[];
  onChangeType: (v: string) => void;
  onClose: () => void;
  onSelectNode: (id: string) => void;
}) {
  const toast = useToast();
  const t = useT();
  const from = entryById.get(rel.fromEntryId);
  const to = entryById.get(rel.toEntryId);
  const [note, setNote] = useState(rel.note);
  useEffect(() => setNote(rel.note), [rel.id, rel.note]);

  return (
    <>
      <div className="row" style={{ gap: 6, alignItems: 'center' }}>
        <span className="muted tiny">{t('graph.link.label')}</span>
        <span className="pill tiny" style={{ marginLeft: 'auto' }}>
          {t.dyn('kind.rel.' + rel.status)}
        </span>
      </div>

      <div className="gx-rel-head">
        <span className="gx-rel-name pointer" onClick={() => onSelectNode(rel.fromEntryId)}>
          {from?.title ?? t('graph.deleted')}
        </span>
        <IcSwap size={13} />
        <span className="gx-rel-name pointer" onClick={() => onSelectNode(rel.toEntryId)}>
          {to?.title ?? t('graph.deleted')}
        </span>
      </div>

      {/*
        这条关系是双向对里的一半：图上已经合并成一条双箭头边，编辑器里要提醒
        「另一半」的存在 —— 不然作者改了这边的类型，回头看到反向那句没跟着变，
        会以为改动丢了。
      */}
      {(() => {
        const reverse = store.relations.find(
          (x) => x.id !== rel.id && x.fromEntryId === rel.toEntryId && x.toEntryId === rel.fromEntryId,
        );
        if (!reverse) return null;
        return (
          <div className="field-hint" data-role="graph-rel-mutual-hint">
            {t('graph.link.mutualHint', { type: reverse.type })}
          </div>
        );
      })()}

      <div className="gx-row" style={{ alignItems: 'center' }}>
        <span className="gx-row-label">{t('graph.link.type')}</span>
        <input
          className="input"
          list="gx-type-list"
          value={rel.type}
          onChange={(e) => onChangeType(e.target.value)}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (!v) void store.updateRelation(rel.id, { type: t('kind.relType.connected') });
          }}
          placeholder={t('graph.link.typePlaceholder')}
        />
      </div>

      <div className="row mt8" style={{ gap: 4, flexWrap: 'wrap' }}>
        {typeList.slice(0, 8).map((t) => (
          <button key={t} className="gx-chip" onClick={() => onChangeType(t)}>
            {t}
          </button>
        ))}
      </div>

      <div className="gx-row mt12" style={{ alignItems: 'center' }}>
        <span className="gx-row-label">{t('graph.link.direction')}</span>
        <button
          className="btn sm"
          onClick={() => {
            void store.updateRelation(rel.id, {
              fromEntryId: rel.toEntryId,
              toEntryId: rel.fromEntryId,
            });
            toast.success(t('graph.panel.toast.dirReversed'));
          }}
        >
          <IcSwap size={13} /> {t('graph.link.reverse')}
        </button>
      </div>

      <div className="gx-row" style={{ alignItems: 'center' }}>
        <span className="gx-row-label">{t('graph.link.status')}</span>
        <div className="gx-seg">
          <button
            className={`gx-seg-btn ${rel.status === 'pending' ? 'on' : ''}`}
            onClick={() => void store.updateRelation(rel.id, { status: 'pending' })}
          >
            {t('kind.rel.pending')}
          </button>
          <button
            className={`gx-seg-btn ${rel.status === 'canon' ? 'on' : ''}`}
            onClick={() => void store.updateRelation(rel.id, { status: 'canon' })}
          >
            {t('kind.rel.canon')}
          </button>
        </div>
      </div>

      <div className="mt12">
        <div className="muted tiny" style={{ marginBottom: 4 }}>
          {t('graph.link.note')}
        </div>
        <textarea
          className="input"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            if (note !== rel.note) void store.updateRelation(rel.id, { note });
          }}
          placeholder={t('graph.link.notePlaceholder')}
        />
      </div>

      <div className="divider" />
      <div className="row" style={{ gap: 6 }}>
        <button className="btn sm ghost" onClick={onClose}>
          {t('common.close')}
        </button>
        <button
          className="btn sm danger"
          style={{ marginLeft: 'auto' }}
          onClick={() => {
            void store.deleteRelation(rel.id);
            onClose();
            toast.success(t('graph.panel.toast.linkDeleted'));
          }}
        >
          <IcTrash size={13} /> {t('graph.link.delete')}
        </button>
      </div>
    </>
  );
}
