import type zh from '../zh/graph';

/** 与 zh/graph.ts 的 key 一一对应，缺一个都会在这里报类型错误 */
const en: Record<keyof typeof zh, string> = {
  /* ---------- Page title & top bar ---------- */
  'graph.title': 'Time & relations',
  'graph.panel.desc':
    'Two views of one dataset: in **Relations** nodes are entries and lines are relations; in **Time** the axis lays out the entries that have a time. Hover for a summary, double-click to rename, right-click to recolor or link — isolated dots are the parts of your world not connected yet.',
  'graph.view.relations': 'Relations',
  'graph.view.time': 'Time',
  'graph.view.relationsHint': 'Entries as a web: who is connected to whom',
  'graph.view.timeHint': 'Entries as an axis: what comes before what',
  'graph.view.timeBadge': '{n} timed',
  'graph.view.chronicle': 'Chronicle',
  'graph.view.chronicleHint': 'Entries as a chronicle: cards above, spans below, one and the same axis',
  'graph.panel.showPending': 'Show pending relations',
  'graph.panel.byWeight': 'Weight by links',
  'graph.panel.byWeightHint':
    'In a crowded map, hubs come first: more links means a bigger, more solid circle, and a fainter one for everything else. Untick to make them all equal.',
  'graph.panel.startLinkHint': 'Start a new relation from the currently selected node',
  'graph.panel.aiRecommend': 'Let AI suggest relations',
  'graph.panel.relayout': 'Re-layout',
  'graph.panel.linkBanner':
    'Link mode: starting from “{from}” — click another node to create a relation (it will reuse the last type “{type}”), Esc to cancel.',
  'graph.panel.noWorld': 'Create a world first',

  /* ---------- Toasts / hints ---------- */
  'graph.panel.toast.renamed': 'Renamed to “{name}”',
  'graph.panel.toast.needNode': 'Select a node first, then click here to start linking',
  'graph.panel.toast.linkCancelled': 'Linking cancelled',
  'graph.panel.toast.dupLink': 'These two entries are already related — that link is now selected',
  'graph.panel.toast.linkCreated': 'Linked “{from} → {to}” — you can change the type',
  'graph.panel.toast.noSuggestions': 'No new relation suggestions found',
  'graph.panel.toast.recommended': 'AI suggested {n} relations — added to the review queue',
  'graph.panel.toast.entryDeleted': 'Entry deleted',
  'graph.panel.toast.linkDeleted': 'Link deleted',
  'graph.panel.toast.dirReversed': 'Direction reversed',

  /* ---------- Graph overview (nothing selected) ---------- */
  'graph.panel.overview.title': 'Graph overview',
  'graph.panel.overview.nodes': 'Nodes',
  'graph.panel.overview.links': 'Links',
  'graph.panel.overview.isolated': 'Isolated',
  'graph.panel.overview.densest': 'Busiest node',
  'graph.panel.overview.hint':
    'Hover a node for a summary; double-click to rename; right-click to recolor, link or delete; click a link to change its type and direction.',
  'graph.panel.overview.glossary': 'Glossary',
  'graph.panel.overview.help1': 'Click a node = select (quick edit on the right)',
  'graph.panel.overview.help2': 'Double-click a node = rename in place, Enter to save',
  'graph.panel.overview.help3': 'Right-click a node = color / link / delete',
  'graph.panel.overview.help4': 'Click “Link”, then two nodes = create a relation',
  'graph.panel.overview.help5': 'Click a link = change type, reverse direction, toggle status',
  'graph.panel.overview.help6': 'Esc = cancel the current action',
  'graph.panel.overview.help7':
    'Weight = number of links (busier is bigger and more solid; can be turned off above)',

  /* ---------- Sidebar: entry quick edit ---------- */
  'graph.panel.entry.label': 'Entry',
  'graph.panel.entry.selectHint': 'Click a node to select',
  'graph.panel.entry.namePlaceholder': 'Entry name',
  'graph.panel.entry.saveHint':
    'Saves when you press Enter or click away (labels on the graph update too)',
  'graph.panel.entry.renameOnCanvas': 'Rename on graph',
  'graph.panel.entry.category': 'Category',
  'graph.panel.entry.status': 'Status',
  'graph.panel.entry.nodeColor': 'Node color',
  'graph.panel.entry.categoryColor': 'Category color',
  'graph.panel.entry.aliases': 'Also known as {names}',
  'graph.panel.entry.relsTitle': 'Relations ({n})',
  'graph.panel.entry.linkHint': 'Click here, then click another node',
  'graph.panel.entry.relTypeHint': 'Relation type, Enter to save',
  'graph.panel.entry.jumpHint': 'Jump to this entry',
  'graph.panel.entry.relStatusPendingHint': 'Pending relation, click to mark as canon',
  'graph.panel.entry.relStatusCanonHint': 'Canon, click to send back to pending',
  'graph.panel.entry.deselect': 'Clear selection',

  /* ---------- Right-click menu ---------- */
  'graph.menu.nodeColor': 'Node color',
  'graph.menu.rename': 'Rename',
  'graph.menu.categoryColor': 'Category color (affects all nodes in “{name}”)',
  'graph.menu.linkFromHere': 'Link from this node',
  'graph.menu.confirmDeleteEntry':
    'Delete entry “{name}”? Its related links will be deleted as well.',
  'graph.menu.deleteEntry': 'Delete entry',
  'graph.menu.relType': 'Relation type',
  'graph.menu.reverse': 'Reverse direction',
  'graph.menu.markCanon': 'Mark as canon',
  'graph.menu.markPending': 'Send back to pending',
  'graph.menu.deleteLink': 'Delete this link',

  /* ---------- Hover preview card ---------- */
  'graph.hover.aliases': ' ｜ also known as {names}',
  'graph.mutualSep': ' ⇄ ',
  'graph.hover.relCount': '{n} relations:',
  'graph.hover.relMore': ' and {n} more',
  'graph.hover.footNode': 'Double-click to rename · Right-click to recolor/link · Click to select',
  'graph.hover.footLink': 'Click to select, then change type/direction/delete',
  'graph.noRelations': 'No relations yet',

  /* ---------- Legend ---------- */
  'graph.legend.dotHint': 'Click to change this category’s node color',
  'graph.legend.toggleHint': 'Click to hide/show this category',
  'graph.legend.count': '{name} ({n})',
  'graph.legend.tips': '｜ Dashed = pending relation ｜ Drag nodes to arrange ｜ Double-click to rename ｜ Right-click for more',
  'graph.legend.weight': 'few links → many:',
  'graph.legend.weightHint':
    'Size and solidity follow the number of links — counting only the lines you can actually see',
  'graph.legend.catColorTitle': 'Color of {name}',
  'graph.legend.catColorHint':
    'Affects all {n} nodes in this category (entries with their own color are unaffected)',

  /* ---------- Sidebar: link editor ---------- */
  'graph.link.label': 'Link',
  'graph.link.cancel': 'Cancel linking',
  'graph.link.mutualHint':
    'There is also a reverse relation between these two: “{type}”. The graph merges them into one double-arrow; each side is edited separately.',
  'graph.link.type': 'Type',
  'graph.link.typePlaceholder': 'e.g. member of / loyal to / hostile to',
  'graph.link.direction': 'Direction',
  'graph.link.reverse': 'Reverse',
  'graph.link.status': 'Status',
  'graph.link.note': 'Note',
  'graph.link.notePlaceholder': 'Why does this relation hold?',
  'graph.link.delete': 'Delete link',

  /* ---------- Shared widgets ---------- */
  'graph.customColor': 'Custom color',
  'graph.restoreDefault': 'Restore default',
  'graph.defaultColor': 'Default',
  'graph.followCategory': 'Follow category',
  'graph.deleted': '(deleted)',
  'graph.uncategorized': 'Uncategorized',
  'graph.openEntry': 'Open entry details',
};

export default en;
