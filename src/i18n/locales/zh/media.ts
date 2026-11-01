/**
 * 媒体：条目正文与封面对图片/音频/视频的引用。
 * 命名空间约定：`media.*`；封面与媒体选择器的文案都在这里
 * （编年卡片上「封面怎么显示」的两档切换在 `chron.*`，见 time.ts）。
 */
export default {
  'media.missing': '媒体引用已失效',
  'media.missingAlt': '媒体引用已失效（{alt}）',
  'media.unsupported': '（暂不支持预览的媒体类型）',

  /* ---------------- 选择器 ---------------- */
  'media.picker.title': '选择媒体',
  'media.picker.titleImage': '选择封面图',
  'media.picker.tab.upload': '上传',
  'media.picker.tab.linked': '本条目的',
  'media.picker.tab.world': '世界的',
  'media.picker.upload.hint': '图片、音频、视频都收；上传后自动归入杂物间，并关联到这一条',
  'media.picker.upload.hintNoEntry': '图片、音频、视频都收；上传后自动归入杂物间',
  'media.picker.upload.btn': '选择文件',
  'media.picker.uploading': '正在收进杂物间…',
  'media.picker.empty.world': '这个世界还没有媒体文件，上传一张？',
  'media.picker.empty.linked': '这一条还没有关联的媒体 —— 可以从「世界的」里挑，或上传新的',
  'media.picker.pick.hint': '点一下插进正文',
  'media.picker.pick.cover': '点一下设为封面',
  'media.picker.imageOnly': '只列图片',
  'media.picker.audio': '音频',
  'media.picker.video': '视频',

  /* ---------------- 编辑器 ---------------- */
  'editor.tool.media': '插入图片/音频/视频',

  /* ---------------- 封面 ---------------- */
  'media.cover.label': '封面',
  'media.cover.none': '未设置',
  'media.cover.choose': '选择封面',
  'media.cover.change': '换一张',
  'media.cover.clear': '清除封面',
  'media.cover.hint': '用在编年卡片与条目阅读页的顶上；从杂物间挑一张，或现场上传',
}