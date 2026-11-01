/**
 * 简体中文语言包 —— 同时是整个 i18n 的「事实来源」(source of truth)。
 *
 * 新增文案：先在对应模块文件里加 key，`MsgKey` 类型会自动扩展；
 * 对照的英文包（locales/en/<模块>.ts）若没跟上，TypeScript 会直接报错。
 *
 * 新增一门语言：复制 locales/en 目录为 locales/<locale>，把值改掉，
 * 再在 core.ts 的 LOCALES 里注册 —— README「多语言」一节有完整步骤。
 */
import common from './zh/common';
import app from './zh/app';
import ui from './zh/ui';
import kind from './zh/kind';
import lib from './zh/lib';
import ai from './zh/ai';
import settings from './zh/settings';
import start from './zh/start';
import dash from './zh/dash';
import entries from './zh/entries';
import pieces from './zh/pieces';
import wiki from './zh/wiki';
import editor from './zh/editor';
import graph from './zh/graph';
import time from './zh/time';
import studio from './zh/studio';
import review from './zh/review';
import docs from './zh/docs';
import consist from './zh/consist';
import queue from './zh/queue';
import ask from './zh/ask';
import article from './zh/article';
import exp from './zh/exp';
import world from './zh/world';
import agent from './zh/agent';
import log from './zh/log';
import media from './zh/media';

export default {
  ...common,
  ...app,
  ...ui,
  ...kind,
  ...lib,
  ...ai,
  ...settings,
  ...start,
  ...dash,
  ...entries,
  ...pieces,
  ...wiki,
  ...editor,
  ...graph,
  ...time,
  ...studio,
  ...review,
  ...docs,
  ...consist,
  ...queue,
  ...ask,
  ...article,
  ...exp,
  ...world,
  ...agent,
  ...log,
  ...media,
} as const;
