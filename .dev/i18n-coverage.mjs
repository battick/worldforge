#!/usr/bin/env node
/**
 * i18n 覆盖率守卫 —— 扫描 src 下是否还有「硬编码的界面文案」。
 *
 * 判定规则：
 *   - 先去掉注释（// 与 /* … *\/，含 JSX 的 {/* … *\/}），避免把中文注释误报；
 *   - 再看剩下的代码里有没有中文字符（汉字与全角标点）；
 *   - 语言包（src/i18n/locales/**）与提示词正文（src/ai/promptText/**）是
 *     「本来就该放中文」的地方，直接跳过；
 *   - 个别确实需要写死中文的行（例如语言清单里用中文写的语言名），
 *     在行尾加 `// i18n-allow` 即可放行。
 *
 * 用法：
 *   node .dev/i18n-coverage.mjs          # 打印残留，有残留则退出码 1
 *
 * 这是回归测试的一部分：迁移完成后应保持「零残留」。
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = join(ROOT, 'src');

/** 这些目录里的中文是「资产」而非「硬编码文案」 */
const SKIP_DIRS = [join(SRC, 'i18n', 'locales'), join(SRC, 'ai', 'promptText')];

const CJK = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/;
const ALLOW = /i18n-allow/;

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.some((s) => full === s || full.startsWith(s + sep))) continue;
      if (entry.name === 'node_modules') continue;
      out.push(...(await walk(full)));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** 把注释与正则字面量替换成空格（保留换行与列数），字符串内容原样保留 */
const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'case', 'do', 'else',
  'yield', 'await', 'throw',
]);

function stripComments(src) {
  let out = '';
  let state = 'code'; // code | line | block | sq | dq | tpl | re
  let reClass = false;
  let prev = ''; // 前一个非空白字符
  let word = ''; // 紧挨着的标识符
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const c2 = src[i + 1];
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c; } else out += ' ';
      continue;
    }
    if (state === 'block') {
      if (c === '*' && c2 === '/') { out += '  '; i++; state = 'code'; } else out += c === '\n' ? '\n' : ' ';
      continue;
    }
    if (state === 're') {
      if (c === '\\') { out += '  '; i++; continue; }
      if (c === '[') reClass = true;
      else if (c === ']') reClass = false;
      else if (c === '/' && !reClass) { state = 'code'; out += '/'; prev = '/'; word = ''; continue; }
      else if (c === '\n') state = 'code'; // 未闭合，放弃
      out += c === '\n' ? '\n' : ' ';
      continue;
    }
    if (state !== 'code') {
      // 字符串内部：只跟踪结束与转义，内容照抄
      if (c === '\\') { out += c + (c2 ?? ''); i++; continue; }
      if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) {
        state = 'code';
      }
      out += c;
      if (!/\s/.test(c)) prev = c;
      continue;
    }
    // code
    if (c === '/' && c2 === '/') { state = 'line'; out += '  '; i++; continue; }
    if (c === '/' && c2 === '*') { state = 'block'; out += '  '; i++; continue; }
    if (c === '/') {
      const asRegex =
        prev === '' ||
        '([{=,:;!&|?+-*%~^<>'.includes(prev) ||
        (/[A-Za-z_$]/.test(prev) && REGEX_KEYWORDS.has(word));
      if (asRegex) { state = 're'; reClass = false; out += ' '; prev = '/'; word = ''; continue; }
    }
    if (c === "'") state = 'sq';
    else if (c === '"') state = 'dq';
    else if (c === '`') state = 'tpl';
    out += c;
    if (/[A-Za-z0-9_$]/.test(c)) word += c;
    else word = '';
    if (!/\s/.test(c)) prev = c;
  }
  return out;
}

const files = (await walk(SRC)).sort();
const findings = [];
for (const file of files) {
  const raw = await readFile(file, 'utf8');
  const lines = raw.split('\n');
  const stripped = stripComments(raw).split('\n');
  stripped.forEach((text, idx) => {
    if (!CJK.test(text)) return;
    if (ALLOW.test(lines[idx])) return;
    findings.push({ file: relative(ROOT, file), line: idx + 1, text: lines[idx].trim() });
  });
}

if (findings.length === 0) {
  console.log(`i18n coverage OK —— ${files.length} 个源文件里没有发现硬编码文案。`);
  process.exit(0);
}

console.error(`发现 ${findings.length} 处疑似硬编码文案：\n`);
for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.text}`);
console.error('\n若确认该处无需翻译，请在行尾加 `// i18n-allow`。');
process.exit(1);
