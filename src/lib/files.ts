/**
 * 资料文件解析：把上传的各类文件抽成纯文本，供 AI 抽取世界观条目。
 * docx / pdf 走动态 import，按需加载，避免拖慢首屏。
 */

import { tGlobal } from '../i18n/translate';

export interface ExtractResult {
  text: string;
  warning?: string;
}

export const SUPPORTED_EXTS = [
  'txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'html', 'htm',
  'yml', 'yaml', 'log', 'docx', 'pdf',
];

export const ACCEPT_ATTR = SUPPORTED_EXTS.map((e) => `.${e}`).join(',');

export function extOf(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

function decodeText(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  // 优先按 UTF-8 解码，失败则回退 GBK（Windows 记事本常见）
  try {
    const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return utf8;
  } catch {
    try {
      return new TextDecoder('gbk').decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractDocx(buf: ArrayBuffer): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buf);
  const doc = zip.file('word/document.xml');
  if (!doc) throw new Error(tGlobal('lib.files.badDocx'));
  const xml = await doc.async('string');
  // 段落 / 换行 / 制表符结构化
  const withBreaks = xml
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n');
  const text = withBreaks.replace(/<[^>]+>/g, '');
  return decodeEntities(text).replace(/\n{3,}/g, '\n\n').trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

async function extractPdf(buf: ArrayBuffer): Promise<string> {
  const pdfjs: any = await import('pdfjs-dist');
  try {
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  } catch {
    /* 某些构建下无需 worker */
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages: string[] = [];
  const maxPages = Math.min(doc.numPages, 80);
  for (let p = 1; p <= maxPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const line = content.items
      .map((it: any) => (typeof it.str === 'string' ? it.str : ''))
      .join('');
    pages.push(line.replace(/\s+/g, ' ').trim());
  }
  if (doc.numPages > maxPages)
    pages.push(
      '\n' + tGlobal('lib.files.pdfPages', { total: doc.numPages, parsed: maxPages }),
    );
  return pages.filter(Boolean).join('\n\n');
}

export async function extractText(file: File): Promise<ExtractResult> {
  const ext = extOf(file.name);
  const buf = await file.arrayBuffer();

  switch (ext) {
    case 'txt':
    case 'md':
    case 'markdown':
    case 'log':
    case 'yml':
    case 'yaml':
      return { text: decodeText(buf) };

    case 'json': {
      const raw = decodeText(buf);
      try {
        return { text: JSON.stringify(JSON.parse(raw), null, 2) };
      } catch {
        return { text: raw, warning: tGlobal('lib.files.jsonFailed') };
      }
    }

    case 'csv':
    case 'tsv':
      return { text: decodeText(buf) };

    case 'html':
    case 'htm':
      return { text: stripHtmlTags(decodeText(buf)) };

    case 'docx':
      try {
        return { text: await extractDocx(buf) };
      } catch (e) {
        return {
          text: '',
          warning: tGlobal('lib.files.docxFailed', { message: (e as Error).message }),
        };
      }

    case 'pdf':
      try {
        return { text: await extractPdf(buf) };
      } catch (e) {
        return {
          text: '',
          warning: tGlobal('lib.files.pdfFailed', { message: (e as Error).message }),
        };
      }

    case 'doc':
    case 'ppt':
    case 'pptx':
    case 'xlsx':
      return {
        text: '',
        warning: tGlobal('lib.files.unsupported', { ext }),
      };

    default:
      // 未知后缀：当作纯文本尝试
      return {
        text: decodeText(buf),
        warning: ext ? tGlobal('lib.files.unknownFormat', { ext }) : undefined,
      };
  }
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** 超大文本切块，便于分批送模型 */
export function chunkText(text: string, size = 6000): string[] {
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  const paras = text.split(/\n{2,}/);
  let cur = '';
  for (const p of paras) {
    if ((cur + p).length > size && cur) {
      chunks.push(cur);
      cur = '';
    }
    cur += (cur ? '\n\n' : '') + p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}
