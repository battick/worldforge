import type zh from '../zh/media';

/**
 * Media: images / audio / video embedded in entry bodies and entry covers.
 * Namespace: `media.*` (the chronicle cover-mode toggle lives in `chron.*`, see time.ts).
 */
const en: Record<keyof typeof zh, string> = {
  'media.missing': 'Media reference is no longer valid',
  'media.missingAlt': 'Media reference is no longer valid ({alt})',
  'media.unsupported': '(media type cannot be previewed)',

  /* ---------------- picker ---------------- */
  'media.picker.title': 'Choose media',
  'media.picker.titleImage': 'Choose a cover image',
  'media.picker.tab.upload': 'Upload',
  'media.picker.tab.linked': "This entry's",
  'media.picker.tab.world': "World's",
  'media.picker.upload.hint': 'Images, audio and video are all welcome; uploads land in the stash and link to this entry',
  'media.picker.upload.hintNoEntry': 'Images, audio and video are all welcome; uploads land in the stash',
  'media.picker.upload.btn': 'Choose files',
  'media.picker.uploading': 'Filing into the stash…',
  'media.picker.empty.world': 'No media in this world yet — upload one?',
  'media.picker.empty.linked': 'No media linked to this entry yet — pick from "World\'s", or upload',
  'media.picker.pick.hint': 'Click to insert into the body',
  'media.picker.pick.cover': 'Click to set as cover',
  'media.picker.imageOnly': 'Images only',
  'media.picker.audio': 'Audio',
  'media.picker.video': 'Video',

  /* ---------------- editor ---------------- */
  'editor.tool.media': 'Insert image / audio / video',

  /* ---------------- cover ---------------- */
  'media.cover.label': 'Cover',
  'media.cover.none': 'Not set',
  'media.cover.choose': 'Choose cover',
  'media.cover.change': 'Replace',
  'media.cover.clear': 'Remove cover',
  'media.cover.hint': 'Shown atop the chronicle card and the reading page; pick from the stash or upload',
};

export default en;