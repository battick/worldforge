import type zh from '../zh/world';

/** 与 zh/world.ts 的 key 一一对应，缺一个都会在这里报类型错误 */
const en: Record<keyof typeof zh, string> = {
  /* ---- 向导步骤标题 ---- */
  'world.step.understanding': 'What the AI understood',
  'world.step.questions': 'Round {n} · A few things only you can settle',
  'world.step.told': 'This isn’t about the questions — I just want to say',
  'world.step.proposal': 'Setting draft',
  'world.step.revise': 'Anything else to change?',

  /* ---- 头部 ---- */
  'world.head.title': 'New world',
  'world.head.sub':
    'Drop in whatever you have. The AI reads it, asks you a few questions, then writes a setting draft — keep chatting until you’re happy, and it only comes into being once you say “confirm”.',

  /* ---- 左栏：素材 ---- */
  'world.left.title': 'What you have',
  'world.left.count': '{text} text · {img} images',
  'world.left.empty':
    'Nothing here yet. You really don’t need to prepare anything — even just “I want to write a story about a lighthouse” is enough to start.',

  'world.drop.title': 'Drag files in, or click here to pick',
  'world.drop.formats': 'Articles / notes / setting docs / outlines: txt md docx pdf html csv json',
  'world.drop.images': 'And images: png jpg webp (the AI looks at them itself)',

  'world.composer.text': 'Write something',
  'world.composer.rule': 'Set a rule',
  'world.composer.textPlaceholder':
    'Jot down a paragraph, no need for structure. E.g.: I want to write a world where the sea rises three feet every year.',
  'world.composer.rulePlaceholder':
    'Lay down the law for this world, e.g.: power must have a cost, and using it burns lifespan; no modern tech terms.',

  /* ---- 素材条目 ---- */
  'world.material.imageLabel': 'Image',
  'world.material.sizeSuffix': ' · {size}',
  'world.material.noteSuffix': ' · has note',
  'world.material.ruleName': 'Rule · {text}',
  'world.material.noteName': 'Jotted · {text}',
  'world.material.addNote': 'Add a note',
  'world.material.noteImagePlaceholder': 'What does this image show? E.g.: the protagonist’s outfit',
  'world.material.notePlaceholder': 'Extra notes (optional)',

  /* ---- 横幅 ---- */
  'world.banner.aiOff.title': 'AI is not connected yet',
  'world.banner.aiOff.desc':
    'Creating a world needs AI to read your material. You can drop material in first — progress saves automatically — and come back once the model is set up.',
  'world.banner.aiOff.btn': 'Set up an AI model',
  'world.banner.upgrade.title': 'The database is upgrading in the background — draft autosave is temporarily unavailable',
  'world.banner.upgrade.desc':
    'If this sticks around, another WorldForge tab is holding the database — close them and the upgrade finishes on its own. Leaving midway may lose this session’s progress.',

  /* ---- 初始引导 ---- */
  'world.hello.ready': 'Your material is in place',
  'world.hello.wait': 'No need to figure it all out first',
  'world.hello.leftBefore': 'These ',
  'world.hello.leftMid': ' items on the left are your starting point. Hit the bottom right to have the AI read them — it will first tell you',
  'world.hello.understood': 'what it understood',
  'world.hello.leftAfter':
    ', then ask a few questions it genuinely needs you to settle. If anything else comes to mind, keep dropping it in on the left.',
  'world.hello.noneBefore':
    'Just drop old drafts, images, and stray thoughts on the left. After you hit the button below, the AI will first tell you',
  'world.hello.noneAfter':
    ', then ask a few questions it genuinely needs you to settle — anything it can judge for itself, it won’t bother you about.',

  /* ---- AI 的理解 ---- */
  'world.understanding.observations': 'A few things the AI happened to notice',

  /* ---- 问答 ---- */
  'world.qa.answered': '{done}/{total} answered',
  'world.qa.hint':
    'It’s fine if you can’t answer: hit “You decide” to hand it to the AI, and it will judge for itself based on your material.',
  'world.qa.suggestLabel': 'Click to fill in:',
  'world.qa.suggestRefresh': 'New ideas',
  'world.qa.suggestBusy': 'Thinking…',
  'world.qa.suggestFailed': 'Could not come up with new suggestions — try again later',
  'world.qa.answerPlaceholder': 'Your take (one line is fine)',
  'world.qa.delegatedPlaceholder': 'Left to the AI',
  'world.qa.delegatedBtn': 'Left to the AI',
  'world.qa.letAiBtn': 'You decide',

  /* ---- 作者交代 ---- */
  'world.told.count': '{n} noted',
  'world.told.descBefore': 'Anything you say here is ',
  'world.told.descStrong': 'the highest instruction',
  'world.told.descAfter':
    ': it outranks the material and the AI’s own judgment. Settings that must be honored, landmines, taste preferences — write them down the moment you think of them, and the next AI call (whether continuing the chat or writing the draft) will carry them along.',
  'world.told.placeholder':
    'E.g.: the protagonist must be a failure; no academy settings; there are no gods in this world.',

  /* ---- 草案 ---- */
  'world.proposal.included': '{included} / {total} entries selected',
  'world.proposal.version': 'Version {n}',
  'world.proposal.rationale': 'The AI’s reasoning',
  'world.proposal.genrePlaceholder': 'Genre',
  'world.proposal.tone': 'Creative discipline (included verbatim in every AI generation)',
  'world.proposal.rules': 'Underlying rules of the world',
  'world.proposal.entries': 'Entries ({n} categories · unchecked ones won’t be written)',
  'world.proposal.itemCount': '{n}',
  'world.proposal.summaryPlaceholder': 'One-line summary',
  'world.proposal.relations': 'Relations ({n})',
  'world.proposal.openQuestions': 'Where the AI decided for you but isn’t sure',
  'world.proposal.openQuestionsHint':
    'If you’re unhappy, edit it above, or have the AI rewrite a version below. It asks you once more when you confirm.',
  'world.proposal.uncategorized': 'Uncategorized',

  /* ---- 修订 ---- */
  'world.revise.hint':
    'Just say it in your own words, e.g. “too few factions, add two that check each other”, “make the tone colder”, “rename this city to sound more like a dialect”.',
  'world.revise.placeholder': 'Say what feels off…',
  'world.revise.count': 'Revised {n} times',

  /* ---- 底部动作条 ---- */
  'world.foot.proposalReady':
    'Draft ready: {total} entries, {included} selected. Nothing is written to your world library until you confirm.',
  'world.foot.allAnswered': 'All answered — you can let the AI move on.',
  'world.foot.answerFirst': 'Once you’ve answered, the AI will follow up or start drafting.',
  'world.foot.enough': 'The AI thinks it has enough — you can start the draft.',
  'world.foot.putMaterials': 'Once your material is in, have the AI read it first.',

  /* ---- 最终确认 ---- */
  'world.confirm.title': 'One last confirmation — here’s what you haven’t settled:',
  'world.confirm.noOpenQuestions': 'The AI left no open items.',
  'world.confirm.abandon':
    'Abandon this world creation? All collected materials, Q&A, and the draft will be permanently deleted.',

  /* ---- 按钮 ---- */
  'world.btn.exit': 'Exit (progress is kept)',
  'world.btn.abandon': 'Abandon',
  'world.btn.addMaterial': 'Add to material',
  'world.btn.reread': 'Read again',
  'world.btn.deleteThis': 'Delete this one',
  'world.btn.remember': 'Note it down',
  'world.btn.revise': 'Have the AI revise',
  'world.btn.readOnce': 'Have the AI read',
  'world.btn.answerContinue': 'Done answering, keep chatting',
  'world.btn.writeDraft': 'Enough — write the draft',
  'world.btn.askMore': 'Ask me a few more questions',
  'world.btn.genProposal': 'Generate setting draft',
  'world.btn.confirmCreate': 'Confirm and create this world',
  'world.btn.reviseMore': 'Keep editing',
  'world.btn.confirmNow': 'Go ahead — create “{name}”',
  'world.btn.deleteWorld': 'Delete this world',
  'world.btn.deleteEntry': 'Delete this entry',
  'world.btn.addRule': 'Add one',

  /* ---- 进度提示 ---- */
  'world.busy.reading': 'The AI is reading your material…',
  'world.busy.more': 'The AI is thinking about what’s still open…',
  'world.busy.proposal': 'The AI is pulling the material into a full setting…',
  'world.busy.revising': 'The AI is revising per your notes…',
  'world.busy.creating': 'Creating…',

  /* ---- 错误 / 校验 ---- */
  'world.err.aiNotReady':
    'AI is not connected yet. Go to “Settings → AI model” and fill in your API Key first.',
  'world.err.needMaterials':
    'Put something on the left first — an old article, an image, even a one-off rule you just thought of.',
  'world.err.needRevise': 'Write a line about what you want changed, e.g. “make the power system crueler”.',
  'world.err.needEntry': 'Keep at least one entry, or this will be an empty world.',
  'world.err.nameRequired': 'A world has to have a name',
  'world.err.callFailed': 'Request failed',
  'world.err.proposalFailed': 'Draft generation failed',
  'world.err.reviseFailed': 'Revision failed',
  'world.err.createFailed': 'Creation failed',
  'world.err.maxMaterials': 'At most {n} materials; the rest were ignored',
  'world.err.maxImages': 'At most {n} images; skipped {name}',
  'world.err.imageFailed':
    'This image couldn’t be processed (format or browser limits) and is kept as an index only',
  'world.err.tooLong': 'Content too long — only the first {n} characters were read',

  /* ---- toast ---- */
  'world.toast.revised': 'Revised a version per your notes',
  'world.toast.created': '“{name}” created',
  'world.toast.deleted': 'Deleted',
  'world.toast.warnJoin': '; ',
  'world.toast.warnMore': ' and {n} more notices',

  /* ---- 编辑世界信息 ---- */
  'world.editor.title': 'Edit world info',
  'world.editor.deleteConfirm':
    'Delete world “{name}”? Its {n} entries, all relations, and documents will be permanently deleted.',
  'world.editor.name': 'World name',
  'world.editor.tagline': 'One-line positioning',
  'world.editor.genre': 'Genre',
  'world.editor.genrePlaceholder': 'E.g.: low-magic fantasy / cyberpunk / Republican-era mystery',
  'world.editor.color': 'Theme color',
  'world.editor.summary': 'World summary',
  'world.editor.summaryPlaceholder':
    'The core premise, current situation, and the most pressing conflict of this world. This is included in every AI generation.',
  'world.editor.tone': 'Tone & creative discipline',
  'world.editor.tonePlaceholder':
    'E.g.: cold and restrained, power must have a cost; no modern scientific terms.',
  'world.editor.toneHint':
    'These are the rules you set for the AI, injected verbatim into every generation. Writing “what’s forbidden” works better than “what you want”.',
};

export default en;
