import type zh from '../zh/kind';

/** 与 zh/kind.ts 的 key 一一对应，缺一个都会在这里报类型错误 */
const en: Record<keyof typeof zh, string> = {
  'kind.status.draft': 'Draft',
  'kind.status.pending': 'Pending',
  'kind.status.canon': 'Canon',
  'kind.status.accepted': 'Accepted',
  'kind.status.rejected': 'Rejected',
  'kind.status.pendingReview': 'In review',

  'kind.rel.pending': 'Pending',
  'kind.rel.canon': 'Canon',

  'kind.relType.connected': 'linked to',
  'kind.relType.related': 'related to',
  'kind.relType.membership': 'member of',
  'kind.relType.allegiance': 'loyal to',
  'kind.relType.hostility': 'hostile to',
  'kind.relType.location': 'located in',
  'kind.relType.kinship': 'kin of',
  'kind.relType.mentorship': 'mentor of',
  'kind.relType.possession': 'possesses',
  'kind.relType.causality': 'caused by',

  'kind.pieceSection.text': 'Text',
  'kind.pieceSection.media': 'Media',

  'kind.piece.long.label': 'Long-form',
  'kind.piece.long.hint': 'Full articles and in-depth exposition',
  'kind.piece.short.label': 'Short',
  'kind.piece.short.hint': 'A few hundred words',
  'kind.piece.fragment.label': 'Fragment',
  'kind.piece.fragment.hint': 'A single line, a passing thought',
  'kind.piece.desc.label': 'Description',
  'kind.piece.desc.hint': 'Description of a thing',
  'kind.piece.plot.label': 'Story arc',
  'kind.piece.plot.hint': 'Personal plots, character arcs',
  'kind.piece.image.label': 'Image',
  'kind.piece.image.hint': 'Illustrations, screenshots, maps',
  'kind.piece.audio.label': 'Audio',
  'kind.piece.audio.hint': 'Soundtracks, ambience, voice',
  'kind.piece.video.label': 'Video',
  'kind.piece.video.hint': 'Reference clips, motion tests',
  'kind.piece.other.label': 'Other',
  'kind.piece.other.hint': 'Anything — just drop it in',

  'kind.review.create-entry': 'New entry',
  'kind.review.update-entry': 'Entry revision',
  'kind.review.delete-entry': 'Delete entry',
  'kind.review.relation': 'New relation',
  'kind.review.update-relation': 'Edit relation',
  'kind.review.delete-relation': 'Delete relation',
  'kind.review.consistency': 'Consistency issue',
  'kind.review.timeline-layout': 'Timeline layout',
  'kind.review.timeline-guess': 'AI guessed times',

  'kind.severity.high': 'Severe',
  'kind.severity.medium': 'Moderate',
  'kind.severity.low': 'Minor',
  'kind.severity.short.high': 'High',
  'kind.severity.short.medium': 'Med',
  'kind.severity.short.low': 'Low',
};

export default en;
