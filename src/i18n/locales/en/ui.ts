import type zh from '../zh/ui';

/**
 * Reserved namespace `ui.*` — mirrors zh/ui.ts key for key.
 * Currently empty; see zh/ui.ts for why it still exists.
 */
const en: Record<keyof typeof zh, string> = {};

export default en;
