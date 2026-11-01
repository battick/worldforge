import type zh from '../zh/ask';

/** 与 zh/ask.ts 的 key 一一对应，缺一个都会在这里报类型错误 */
const en: Record<keyof typeof zh, string> = {
  'ask.noWorld': 'Create a world first',
  'ask.title': 'Q&A archive',
  'ask.desc':
    'Your past exchanges with the AI are kept here for reading only. To keep asking, head to the AI studio — its agent can read and write your library directly.',
  'ask.me': 'Me',
  'ask.ai': 'AI',
  'ask.entryNotFound': 'No entry named "{name}" was found',
  'ask.cite': 'Citations:',
  'ask.archive.banner':
    'Asking has moved to the AI studio, where the agent can read and write your library directly.',
  'ask.archive.goStudio': 'Go to AI studio',
  'ask.archive.empty': 'No Q&A history yet',
  'ask.archive.emptyDesc':
    'Chat with the agent in the AI studio and your sessions will show up here.',
  'ask.archive.skipped': 'These actions were not carried out at the time.',
  'ask.archive.stepFailed': 'Failed',
};

export default en;
