/**
 * 媒体引用 → objectURL：条目正文里的 `![说明](asset:ID)` 渲染时的取图入口。
 *
 * 为什么需要这一层：Blob 住在 IndexedDB（经 store 的 `pieces` 表整批载入内存），
 * 而 `<img>/<audio>/<video>` 只认 URL —— 把 Blob 变成 URL 的办法只有
 * `URL.createObjectURL`，且**同一个 Blob 每调一次就发一个新的 URL 句柄**。
 * 同一张图出现在十几个页面上（阅读页、预览、审查队列……），不缓存的话
 * 每处都造一个句柄，内存里同一段数据挂十几个引用。
 *
 * 生命周期：objectURL 一经创建就**不再回收**，活到刷新页面为止。
 * 这是刻意的 —— 本地单机应用，一屏的媒体量有限，而「哪个组件还在用这个 URL」
 * 的引用计数要贯穿所有直接操作 DOM 的地方（MarkdownView 是 innerHTML 后处理，
 * React 根本不知道那些节点），做对的成本远超浪费的那点内存。
 */

import type { Piece } from '../types';

export interface AssetMedia {
  /** 可直接塞进 src 的 objectURL */
  url: string;
  /** 原始 MIME —— 决定渲染成图、音频还是视频 */
  mime: string;
}

const urls = new Map<string, string>();
const mimes = new Map<string, string>();

/**
 * 按杂物间 id 解析一个媒体。pieces 由调用方从 store 传入（本模块不 import store，
 * 保持纯逻辑层 —— 见「非 React 层不碰 i18n/组件」同一条纪律）。
 *
 * 返回 `null` = 这条引用是空的：要么 id 对不上任何杂物，要么那条杂物没有媒体
 * （被删了/是纯文字杂物）。**如实地空着**，让界面说「引用已失效」，而不是漏渲染。
 */
export function resolveAsset(id: string, pieces: Piece[]): AssetMedia | null {
  const hit = urls.get(id);
  if (hit) return { url: hit, mime: mimes.get(id) ?? '' };
  const p = pieces.find((x) => x.id === id);
  const blob = p?.media?.blob;
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  mimes.set(id, p!.media!.mime);
  return { url, mime: p!.media!.mime };
}

/** 拿一张图片杂物的缩略图 dataURL（卡片封面、列表预览用，无需 objectURL） */
export function thumbOf(piece: Piece | undefined): string | null {
  return piece?.thumb ?? null;
}
