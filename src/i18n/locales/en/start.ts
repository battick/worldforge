import type zh from '../zh/start';

/** 与 zh/start.ts 的 key 一一对应，缺一个都会在这里报类型错误 */
const en: Record<keyof typeof zh, string> = {
  'start.title': 'Drop in whatever you have',
  'start.desc':
    'No forms here. Old articles, setting docs, outlines, rough sketches — even just “I want to write a world where the sea rises three feet every year” — anything helps. The AI reads it first, tells you what it understood, then asks a few questions it genuinely needs you to settle. At the end it pulls everything into a complete setting draft for you to review, ',
  'start.descStrong': 'and the world only truly comes into being once you hit confirm.',

  'start.btn.start': 'Start a new world',
  'start.btn.continue': 'Pick up where I left off ({n} materials · {time})',

  'start.aiOff.title': 'AI is not connected yet',
  'start.aiOff.desc':
    'Building a world needs AI to read your material, ask questions, and pull it together. You can set up the model first, or start now — material still goes in, progress saves automatically, and you can pick it back up once the model is ready.',
  'start.aiOff.btn': 'Set up an AI model',

  'start.step1.title': 'Drop in material',
  'start.step1.desc':
    'Articles, notes, setting docs, images — anything works. Files stay on this machine, and the AI looks at images itself. You can also write a rule on the spot, like “power must have a cost”.',
  'start.step2.title': 'The AI reads, then asks',
  'start.step2.desc':
    'It first explains what it understood, then asks a few questions that really shape the direction. Each one comes with a suggested answer — if you’d rather not think it through, just hit “You decide”.',
  'start.step3.title': 'Pulled together into a setting draft',
  'start.step3.desc':
    'World name, tone, underlying rules, categories, the first entries and relations — all at once. You can edit or delete entries one by one, or have the AI rewrite the whole thing.',
  'start.step4.title': 'It only exists once you confirm',
  'start.step4.desc':
    'Nothing is written to the library until you confirm. It asks you once more at that point — anything still unsettled gets listed.',

  'start.features.title': 'What you can do once it’s built',
  'start.features.desc':
    'Entry library, relation graph, AI workbench, review queue, docs library, consistency checks, world Q&A, article proofing, setting-book export — all available from the left nav once the world is built. The material you uploaded also goes into that world’s docs library, so you can trace sources anytime.',
  'start.features.foot':
    'Everything is stored in this computer’s browser (IndexedDB) and never uploaded. It’s a good idea to export a backup from Settings regularly.',
};

export default en;
