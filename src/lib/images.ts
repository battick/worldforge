/**
 * 图片处理：把用户上传的图片压到「能安全送进模型」的尺寸。
 *
 * 为什么要压：手机拍的照片动辄 5-10MB，转成 base64 之后体积还要再涨三分之一，
 * 直接丢给模型既慢又容易被厂商拒掉。这里统一压到长边 1280、JPEG 0.82，
 * 通常能压到 100-300KB，对「读懂图里画了什么」这个用途完全够用。
 */

import { tGlobal } from '../i18n/translate';

export interface ImageResult {
  /** 供模型读取的压缩图 */
  dataUrl: string;
  /** 界面展示用的小图 */
  thumb: string;
  width: number;
  height: number;
}

export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'];
export const IMAGE_ACCEPT = 'image/*';

export const MAX_AI_SIDE = 1280;
export const MAX_THUMB_SIDE = 260;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error(tGlobal('lib.error.readImageFailed')));
    fr.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(tGlobal('lib.error.decodeImageFailed')));
    img.src = src;
  });
}

function draw(img: HTMLImageElement, maxSide: number, quality: number): string {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(tGlobal('lib.error.canvasUnsupported'));

  // 有透明通道的图（png 线稿）贴白底，避免转 JPEG 后变成黑块
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * 压缩一张图片。任何失败都返回 null，由调用方降级为「跳过这张图」，
 * 绝不让一张图把整条新建流程卡死。
 */
export async function prepareImage(file: File): Promise<ImageResult | null> {
  try {
    const raw = await readAsDataUrl(file);
    const img = await loadImage(raw);
    if (!img.naturalWidth || !img.naturalHeight) return null;
    return {
      dataUrl: draw(img, MAX_AI_SIDE, 0.82),
      thumb: draw(img, MAX_THUMB_SIDE, 0.7),
      width: img.naturalWidth,
      height: img.naturalHeight,
    };
  } catch {
    return null;
  }
}

/** 图片在这里直接读，不需要走文本抽取 */
export function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  const ext = (file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '') as string;
  return IMAGE_EXTS.includes(ext);
}
