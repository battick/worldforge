import React, { useEffect, useMemo, useRef } from 'react';
import { renderMarkdown } from '../lib/markdown';
import { resolveAsset } from '../lib/assetUrls';
import { useStore } from '../state/store';
import { useT } from '../i18n';

interface Props {
  content: string;
  /** 点击 [[条目名]] 内链时触发 */
  onInternalLink?: (name: string) => void;
  compact?: boolean;
  className?: string;
}

/**
 * 正文渲染。图片/音频/视频的嵌入（`![说明](asset:ID)`）是**渲染后补**的：
 * `renderMarkdown` 是纯字符串函数、不知道库里有什么，所以只留下
 * `<span class="md-asset" data-asset="ID">` 空位，由这里查到 Blob 再往空位里
 * 塞真正的 `<img>/<audio>/<video>`。
 *
 * 之所以敢直接改 innerHTML 的子孙：React 对 `dangerouslySetInnerHTML` 的节点
 * 不 diff 其内部 —— html 一变它整个换掉（塞进去的元素跟着消失，effect 会重跑），
 * html 不变时我们的改动也不会被 React 冲掉。每次先 `textContent = ''` 清空，
 * 保证 pieces 变化后重跑不会叠出两份媒体。
 */
export function MarkdownView({ content, onInternalLink, compact, className }: Props) {
  const html = useMemo(() => renderMarkdown(content || ''), [content]);
  const { pieces } = useStore();
  const t = useT();
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = hostRef.current;
    if (!root) return;
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('.md-asset'))) {
      const id = el.dataset.asset ?? '';
      const alt = el.dataset.alt ?? '';
      el.textContent = '';
      const res = resolveAsset(id, pieces);
      if (!res) {
        // 引用失效如实说出来 —— 媒体被删了，这句话比一块空白诚实
        el.classList.add('md-asset-missing');
        el.textContent = alt ? t('media.missingAlt', { alt }) : t('media.missing');
        continue;
      }
      el.classList.remove('md-asset-missing');
      if (res.mime.startsWith('image/')) {
        const img = document.createElement('img');
        img.className = 'md-img';
        img.src = res.url;
        img.alt = alt;
        img.loading = 'lazy';
        el.appendChild(img);
      } else if (res.mime.startsWith('audio/')) {
        const audio = document.createElement('audio');
        audio.className = 'md-audio';
        audio.controls = true;
        audio.src = res.url;
        el.appendChild(audio);
      } else if (res.mime.startsWith('video/')) {
        const video = document.createElement('video');
        video.className = 'md-video';
        video.controls = true;
        video.src = res.url;
        el.appendChild(video);
      } else {
        // 不认识的类型：别吞掉，至少把说明文字留下来
        el.classList.add('md-asset-missing');
        el.textContent = alt || t('media.unsupported');
      }
    }
  }, [html, pieces, t]);

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest('.wl') as HTMLElement | null;
    if (target?.dataset.wl) {
      e.preventDefault();
      onInternalLink?.(target.dataset.wl);
    }
  };

  return (
    <div
      ref={hostRef}
      className={`md${compact ? ' compact' : ''}${className ? ' ' + className : ''}`}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
