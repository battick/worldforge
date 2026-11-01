import type zh from '../zh/article';

/** Article review page; keys must match zh/article.ts exactly. */
const en: Record<keyof typeof zh, string> = {
  'article.title': 'Manuscript review',
  'article.desc':
    'Paste in a passage, chapter or screenplay fragment you have written. The AI checks it against your world library, points out conflicts with canon and logical gaps, and suggests concrete fixes. This is the two-way “writing → canon” proofreading entry point.',
  'article.noWorld': 'Create a world first',

  'article.input.title': 'Text to review',
  'article.input.btn.loadSample': 'Load sample',
  'article.input.btn.import': 'Import file',
  'article.input.placeholder': 'Paste the passage you wrote…',
  'article.input.btn.abort': 'Stop',
  'article.input.btn.run': 'Review against canon',
  'article.input.btn.running': 'Reviewing…',
  'article.input.sample':
    'Yilan stood on the pier at Greyharbor, watching the freighter from the south unload its third load of emberstone.\n\n“The grade is much worse than last year.” Doen came up behind her, a chunk of dark grey ore clutched in his hand.\n“Your priests call it godblood, but all I see is a pile of increasingly poor rock.”\n\nYilan did not look back. “How many did you bring?”\n\n“Three hundred,” Doen said. “The Ash Line has already reached the north bank. If we don’t move now, this time next year we’ll be scooping ash out of the water.”\n\nShe finally turned around. The twenty-nine-year-old First Ashcaller looked younger than her years in the grey light, but there was a certainty in her voice, close to exhaustion, when she spoke:\n\n“I can give you my blessing. But the expedition must include ash-gatherers, praying once every hour. And — steam engines cannot enter the Ashlands.”\n\nDoen laughed, the ash-dusted laugh only a miner has. “You’re afraid the church will call it blasphemy.”\n\n“What I’m afraid of,” Yilan said, “is that when they come back, they will tell me what the bell really is.”',

  'article.result.empty.title': 'No review yet',
  'article.result.empty.desc':
    'Paste some text on the left, then click “Review against canon”. The AI will automatically pull the world settings related to that passage as its reference.',
  'article.result.overallTitle': 'Overall verdict',
  'article.result.scoreLabel': 'Canon consistency',
  'article.result.usedEntries': 'Checked against:',
  'article.result.suggestions.title': 'Suggestions ({n})',
  'article.result.suggestions.empty': 'No conflicts with existing canon were found in this passage.',
  'article.result.suggestions.ordinalPrefix': 'No. ',
  'article.result.suggestions.locatable': '(locatable)',
  'article.result.suggestions.issue': 'Issue:',
  'article.result.suggestions.fix': 'Fix:',
  'article.result.newConcepts.title': 'New concepts in the text',
  'article.result.newConcepts.btn': 'Generate candidate entries',
  'article.result.newConcepts.desc':
    'These proper nouns appear in the text but are not in your world library yet. Add them to the library and the AI will be able to review future writing against them.',

  'article.toast.tooShort': 'That’s too short — give at least one complete paragraph',
  'article.toast.needCategory': 'Create a category first',
  'article.toast.generated': 'Generated {n} candidate entries — confirm them in the review queue',
  'article.toast.loaded': 'Loaded {name}',
};

export default en;
