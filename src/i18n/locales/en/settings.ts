import type zh from '../zh/settings';

/** 与 zh/settings.ts 的 key 一一对应，缺一个都会在这里报类型错误 */
const en: Record<keyof typeof zh, string> = {
  'settings.title': 'Settings',
  'settings.desc':
    'AI model, storage and backup. Your API key stays in this device’s browser and is never uploaded to any server.',

  'settings.lang.title': 'Interface language',
  'settings.lang.desc':
    'Takes effect immediately and is saved in this browser (never written into your world data). Adding a language only takes one more locale file — the option shows up here automatically.',
  'settings.lang.auto': 'Follow system',
  'settings.lang.autoHint': 'Currently: {locale}',

  'settings.ai.title': 'AI model',
  'settings.ai.configured': 'Configured',
  'settings.ai.notConfigured': 'Not configured',
  'settings.ai.test': 'Test connection',
  'settings.ai.provider': 'Provider',
  'settings.ai.model': 'Model name',
  'settings.ai.modelPlaceholder': 'e.g. deepseek-chat',
  'settings.ai.modelHint':
    'Type any model ID directly, or hit “Browse” to pick from the provider’s real list — it is exactly what this key can reach.',
  'settings.ai.baseUrl': 'API base URL',
  'settings.ai.baseUrlHint':
    'Must be an OpenAI-compatible endpoint, usually ending in /v1. For a local Ollama, use http://localhost:11434/v1 (no key needed).',
  'settings.ai.baseUrlReset': 'This address was changed — restore the official one ({url})',
  'settings.ai.apiKey': 'API key',
  'settings.ai.show': 'Show',
  'settings.ai.hide': 'Hide',
  'settings.ai.keyHint':
    'The key lives only in this browser’s localStorage (key name worldforge:settings). In cloud storage mode it is not synced with your data.',
  'settings.ai.temperature': 'Creativity (temperature): {value}',
  'settings.ai.temperatureHint':
    '0.7–1.0 works well for worldbuilding; 0.2–0.4 for consistency checks and manuscript review.',
  'settings.ai.contextLimit': 'Max entries sent as context',
  'settings.ai.contextLimitHint':
    'How many existing entries to include in each generation. More is more accurate — and more expensive.',
  'settings.ai.vision': 'Allow sending images to the model',
  'settings.ai.visionHint':
    'Images you upload while creating a world are handed to the model to read. If the current model cannot read images (a text-only model, for example), it will not work even with this on — the app simply skips images and keeps going, so the flow never breaks. Turn it off if you know the model cannot read images and want to save a doomed request.',
  'settings.ai.maxTokens': 'Reply limit (max_tokens)',
  'settings.ai.maxTokensHint':
    '0 = no limit, let the provider decide. Set it too low and long answers get cut off.',
  'settings.ai.topP': 'Sampling range (top_p): {value}',
  'settings.ai.topPHint':
    '1.00 = unrestricted (what most providers default to). Adjusting temperature alone is usually enough.',
  'settings.ai.stream': 'Stream the reply (show it as it is written)',
  'settings.ai.streamHint':
    'When off, you wait for the whole answer and see it in one go. Only turn it off if the gateway’s streaming is untrustworthy (dropped chunks, out-of-order text, random cut-offs).',
  'settings.ai.advanced': 'Advanced: edit the request itself',
  'settings.ai.advancedOn': 'changed',
  'settings.ai.jsonMode': 'JSON mode (response_format)',
  'settings.ai.jsonMode.auto': 'Auto — per task, as each one needs (default)',
  'settings.ai.jsonMode.always': 'Always send json_object',
  'settings.ai.jsonMode.never': 'Never send it — pick this when the gateway rejects the field',
  'settings.ai.jsonModeHint':
    'Applies to the tasks that need structured output (the AI workbench, consistency checks, relation extraction). If you see an “response_format unsupported” error, choose “Never”.',
  'settings.ai.extraHeaders': 'Extra request headers',
  'settings.ai.extraHeadersHint':
    'A JSON object. Some gateways require extra auth or version headers — put them here. Matching names (case-insensitive) override the built-in Authorization header.',
  'settings.ai.extraBody': 'Extra request body',
  'settings.ai.extraBodyHint':
    'A JSON object merged into the built-in parameters — use it for vendor-specific switches such as DeepSeek’s thinking or Qwen’s enable_thinking. Your values win on name clashes, but messages is never overridden.',
  'settings.ai.testOkPrefix': 'Connected',
  'settings.ai.testOk': 'Connected. Model replied: {reply}',
  'settings.ai.testOkToast': 'Connection OK',
  'settings.ai.testFailedToast': 'Connection failed — see details below',

  'settings.world.title': 'Worlds',
  'settings.world.new': 'New world',
  'settings.world.current': 'Current',
  'settings.world.stats': '{entries} entries ｜ {relations} relations ｜ updated {time}',
  'settings.world.switch': 'Switch',
  'settings.world.edit': 'Edit',
  'settings.world.confirmDelete':
    'Delete world “{name}” and its {n} entries? This cannot be undone.',
  'settings.world.deleted': 'Deleted',

  'settings.storage.title': 'Data storage',
  'settings.storage.localBanner':
    'You are in local mode: everything lives in this browser’s IndexedDB — offline-capable, no network needed. Clearing browser data also clears your worlds, so export a backup below from time to time.',
  'settings.storage.upgrade': 'Move to the cloud (optional)',
  'settings.storage.upgradeHint':
    'If you later want to sync across devices, or invite friends to write with you, just stand up a small server implementing the endpoints below and paste its address here — no client code changes required:',
  'settings.storage.tableNames':
    ', with stores worlds / categories / entries / relations / docs / review.',
  'settings.storage.baseUrl': 'Cloud base URL',
  'settings.storage.token': 'Access token (optional)',
  'settings.storage.save': 'Save and switch',
  'settings.storage.savedToast': 'Storage config saved — reloading…',

  'settings.backup.title': 'Backup and restore',
  'settings.backup.importConfirm':
    'OK = wipe existing data and restore fully; Cancel = merge with existing data (same ID wins).',
  'settings.backup.imported': 'Import complete',
  'settings.backup.importFailed': 'Import failed: {message}',
  'settings.backup.export': 'Export all data',
  'settings.backup.import': 'Import backup file',
  'settings.backup.wipeConfirm1':
    'Wipe all data? Every world, entry, relation, document and review record will be deleted, and this cannot be undone.',
  'settings.backup.wipeConfirm2': 'One more confirmation: this is irreversible.',
  'settings.backup.wipe': 'Wipe all data',
  'settings.backup.wiped': 'Wiped',
  'settings.backup.downloaded': 'Backup downloaded',

  'settings.tips.title': 'Tips',
  'settings.tips.linkBefore': 'Write ',
  'settings.tips.linkSample': '[[Entry name]]',
  'settings.tips.linkAfter':
    ' in any body text to create a wiki link — the graph and consistency checks rely on it.',
  'settings.tips.tone':
    'Spell out what is forbidden in “Tone and creative discipline” (e.g. “no modern technology terms”) — the AI drifts far less.',
  'settings.tips.more':
    'The more entries you have, the more accurate generation gets. If the AI keeps reinventing something you already have, check the Entries page first: does that setting exist, and is its title short enough?',
  'settings.tips.review':
    'In the review queue, “edit then accept” is much faster than rewriting — the first draft is usually one tone away.',
  'settings.tips.consistency':
    'Run a consistency check after each chapter; it beats fixing everything after a hundred thousand words.',

  /* ---------------- Changelog ---------------- */
  'settings.changelog.title': 'Changelog',
  'settings.changelog.current': 'Current version',
  'settings.changelog.type.feature': 'New',
  'settings.changelog.type.fix': 'Fixed',
  'settings.changelog.type.improve': 'Improved',
  'settings.changelog.type.refactor': 'Refactored',
};

export default en;
