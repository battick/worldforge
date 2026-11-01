import type zh from '../zh/studio';

/** AI studio page; keys must match zh/studio.ts exactly. */
const en: Record<keyof typeof zh, string> = {
  'studio.title': 'AI studio',
  'studio.desc':
    'Hand a job to the AI in one sentence: it can read your knowledge base and change it too. Look things up, add entries, wire relations, jot down ideas — every step is logged and can be undone.',
  'studio.noWorld': 'Create a world first',
  'studio.btn.article': 'Article review',
  'studio.btn.reviewQueue': 'Review queue',
  'studio.btn.reviewQueueCount': 'Review queue ({n})',

  /* ---------------- agent chat ---------------- */
  'studio.agent.title': 'Talk to the AI',
  'studio.agent.placeholder':
    'Give it a job… (Enter to send, Shift+Enter for a new line)\nE.g. break that old note into entries; connect the three northern cities with trade routes; note down an idea I just had',
  'studio.agent.send': 'Hand it over',
  'studio.agent.abort': 'Stop',
  'studio.agent.thinking': 'Reading your knowledge base and working out the next step…',
  'studio.agent.empty': 'Give it something to do',
  'studio.agent.emptyDesc':
    'This one can actually act: say "add X for me" or "link Y and Z together" — it looks things up first, then changes them, and shows you a receipt for every step.',
  'studio.agent.clear': 'Clear conversation',
  'studio.agent.threads': 'Past conversations',
  'studio.agent.newThread': 'New conversation',
  'studio.agent.threadUntitled': 'Untitled conversation',

  /* ---------------- plan approval card ---------------- */
  'studio.agent.plan.title': 'What it wants to do',
  'studio.agent.plan.note':
    'These actions really do change your knowledge base (new entries go to the review queue first).',
  'studio.agent.plan.run': 'Run',
  'studio.agent.plan.skip': 'Skip',
  'studio.agent.plan.count': '{n} action(s)',
  /** plan card survives but the batch can no longer run (page left / reloaded) — say so honestly */
  'studio.agent.plan.stale':
    'This batch never ran — it expired when you left the page. Just ask again.',

  /* ---------------- per-step receipt ---------------- */
  'studio.agent.step.why': 'Why: {why}',
  'studio.agent.step.pending': 'Queued',
  'studio.agent.step.done': 'Done',
  'studio.agent.step.failed': 'Failed',
  'studio.agent.step.skipped': 'Skipped',
  'studio.agent.step.noArgs': '(no arguments)',
  'studio.agent.step.undo': 'Undo this step',
  'studio.agent.step.undone': 'Undone',
  'studio.agent.step.log': 'Log',
  'studio.agent.step.jump': 'Take a look',
  /** entry point hung off proposal receipts (new entry / new link) */
  'studio.agent.step.review': 'Review it',

  /* ---------------- it is asking you ---------------- */
  'studio.agent.ask.title': 'Waiting on your answer',
  /** one click hands it over: a candidate answer is meant to be given as-is */
  'studio.agent.ask.pick': 'Click one to hand it over',
  'studio.agent.ask.answer': 'Answer it',

  /* ---------------- what it suggests next (pinned under that bubble) ---------------- */
  'studio.agent.next.label': 'Next I could:',

  /* ---------------- suggested prompts ---------------- */
  'studio.suggest.empty': 'You could start with:',
  'studio.suggest.followUp': 'Next you could:',
  'studio.suggest.generating': 'Thinking it over from your knowledge base…',
  'studio.suggest.refresh': 'More',
  'studio.suggest.run': 'Click to hand it over and let it start',
  /** fallbacks: used when no AI is configured, or the library is still empty */
  'studio.preset.1': 'How does the currency system of this world work?',
  'studio.preset.2': 'Break that old note in the library into entries',
  'studio.preset.3': 'Which settings might contradict each other?',
  'studio.preset.4': 'Suggest three unwritten regions that the world logic implies',
  'studio.preset.5': 'Note down a new setting I just thought of',

  /* ---------------- manual tools (collapsible) ---------------- */
  'studio.manual.title': 'Manual tools',
  'studio.manual.desc': 'For when you would rather not let it decide — step through it yourself.',

  'studio.card.generate': 'Generate candidate entries in bulk',
  'studio.field.category': 'Which category to generate into',
  'studio.field.count': 'Count',
  'studio.option.count': '{n}',
  'studio.field.relation': 'Relations',
  'studio.option.suggestRelations': 'Also suggest relations to existing entries',
  'studio.field.instruction': 'Creative direction',
  'studio.placeholder.instruction':
    'e.g. Add three small city-states on the northern rim of the basin, each with its own survival strategy — one of them is already inside the grey line.',
  'studio.field.keywords': 'Concepts to cover (optional, comma-separated)',
  'studio.placeholder.keywords': 'e.g. salt tax, broken bridge, double agent',
  'studio.btn.generate': 'Start generating',
  'studio.btn.generating': 'Generating…',
  'studio.btn.abort': 'Stop',
  'studio.hint.context':
    'Every run automatically carries the world tone plus an index of existing settings, so the AI will not duplicate existing entries and will try to follow your naming style.',
  'studio.stream.thinking': 'Reading the world context and drafting candidate settings…',

  'studio.result.title': 'Generated results',
  'studio.result.entryPill': '{n} entries',
  'studio.result.relPill': '{n} relations',
  'studio.btn.selectNone': 'Deselect all',
  'studio.btn.sendToReview': 'Send to review queue ({n})',
  'studio.result.relationsHeading': 'Suggested relations',

  'studio.cap.title': 'Other AI capabilities',
  'studio.cap.extract.title': 'Extract entries from documents',
  'studio.cap.extract.desc':
    'Upload old documents and setting notes — the AI reads them and breaks them into structured entries.',
  'studio.cap.extract.action': 'Open documents',
  'studio.cap.relations.title': 'Suggest relations in bulk',
  'studio.cap.relations.desc':
    'Let the AI untangle the web of connections among characters, factions, and geography.',
  'studio.cap.relations.action': 'Open relation graph',
  'studio.cap.consistency.title': 'Consistency audit',
  'studio.cap.consistency.desc':
    'Scan every entry, surface contradictory settings, and suggest how to fix them.',
  'studio.cap.consistency.action': 'Open consistency check',
  'studio.cap.ask.title': 'Look back at past questions',
  'studio.cap.ask.desc':
    'The archive keeps what you asked before and which entries each answer drew on (ask in the box above).',
  'studio.cap.ask.action': 'Open Q&A archive',

  'studio.context.title': 'About context cost',
  'studio.context.desc':
    'You currently have {count} entries. Each run sends at most {limit} entry summaries as reference by default. When you have many entries, lower that number in Settings to control the cost.',

  'studio.toast.needCategory': 'Create a category first',
  'studio.toast.noItems': 'The AI returned no usable entries — try rephrasing and run again.',
  'studio.toast.generated': 'Generated {n} candidate entries',
  'studio.toast.needPick': 'Pick at least one',
  'studio.toast.sentToReview': 'Sent {n} proposals to the review queue',
};

export default en;
