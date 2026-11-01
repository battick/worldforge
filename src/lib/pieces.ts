/**
 * 杂物间（pieces）的媒体处理工具。
 *
 * 媒体文件（图片/音频/视频）在运行时以 Blob 存在 IndexedDB 里；
 * 但 JSON 备份只能承载字符串，所以导出时把 Blob 转成 dataUrl，
 * 导入时再转回来。这两步都做成「尽力而为」—— 媒体转不出来不阻塞文本内容。
 */

import type { Piece, PieceKind } from '../types';
import { TEXT_PIECE_KINDS } from '../types';
import { tGlobal } from '../i18n/translate';

export function isTextPiece(kind: PieceKind): boolean {
  return TEXT_PIECE_KINDS.includes(kind);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error(tGlobal('lib.error.readMediaFailed')));
    fr.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return fetch(dataUrl).then((r) => r.blob());
}

/** 备份导出用：把媒体 Blob 转成 dataUrl 字符串（可 JSON 序列化） */
export async function pieceForExport(piece: Piece): Promise<Piece> {
  if (!piece.media?.blob) return piece;
  try {
    const dataUrl = await blobToDataUrl(piece.media.blob);
    return {
      ...piece,
      media: { ...piece.media, blob: undefined as any, dataUrl },
    } as Piece;
  } catch {
    // 转不出来就只带元信息，正文内容照常导出
    return { ...piece, media: { ...piece.media, blob: undefined as any } } as Piece;
  }
}

export async function piecesForExport(pieces: Piece[]): Promise<Piece[]> {
  return Promise.all(pieces.map(pieceForExport));
}

/** 备份导入用：把 dataUrl 字符串恢复成 Blob */
export async function revivePieceMedia(piece: Piece): Promise<Piece> {
  const media = piece.media as any;
  if (!media || media.blob instanceof Blob) return piece;
  if (typeof media.dataUrl === 'string' && media.dataUrl) {
    try {
      const blob = await dataUrlToBlob(media.dataUrl);
      return { ...piece, media: { name: media.name, mime: media.mime, size: media.size, blob } };
    } catch {
      /* fallthrough */
    }
  }
  return { ...piece, media: undefined };
}

/** 生成一个跟随组件生命周期的对象 URL（配合 useEffect revoke） */
export function createMediaUrl(piece: Piece): string | null {
  if (!piece.media?.blob) return null;
  return URL.createObjectURL(piece.media.blob);
}
