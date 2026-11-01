import type zh from '../zh/app';

/** Application shell: title, brand, sidebar, world switcher, database failure screens. */
const en: Record<keyof typeof zh, string> = {
  'app.title': 'WorldForge · Personal Worldbuilding Library',
  'app.brandName': 'WorldForge',
  'app.brandSub': 'Personal worldbuilding library',

  'app.noWorld': 'No world yet',
  'app.newWorld': 'New world',
  'app.newAnotherWorld': 'Create another world',
  'app.editCurrentWorld': 'Edit current world',
  'app.lockedHint': 'Create a world first',

  'app.modeLocal': 'Local mode · data stays on this device',
  'app.modeCloud': 'Cloud mode',
  'app.footStats': '{entries} entries / {relations} relations',

  'app.navGroup.overview': 'Overview',
  'app.navGroup.ai': 'AI collaboration',
  'app.navGroup.output': 'Output',
  'app.nav.dashboard': 'World overview',
  'app.nav.wiki': 'Wiki',
  'app.nav.graph': 'Time & relations',
  'app.nav.studio': 'AI studio',
  'app.nav.review': 'Review queue',
  'app.nav.docs': 'Source library',
  'app.nav.consistency': 'Consistency check',
  'app.nav.ask': 'Q&A archive',
  'app.nav.article': 'Manuscript review',
  'app.nav.log': 'Activity log',
  'app.nav.export': 'Export compendium',
  'app.nav.settings': 'Settings',
  'app.navWorking': 'AI is working here — leaving this page will not stop it',

  'app.toast.worldCreated': '“{name}” is ready — start filling it in',
  'app.diagCopied': 'Diagnostic log copied — paste it to your AI assistant',
  'app.diagCopiedShort': 'Diagnostic log copied',
  'app.copyFallbackPrompt': 'Automatic copy failed — please select all and copy manually:',

  'app.boot.loading': 'Opening your worldbuilding library…',

  'app.db.openFailed': 'Cannot open the local database',
  'app.db.starvedTitle': 'The database is jammed by a dead queued request',
  'app.db.starvedBody':
    'The database itself is still there{dbInfo}, but the connection queue is blocked by a long-dead upgrade request that is starving everything behind it. Reloading the page cannot clear this, and no code in the page can cancel another tab’s queued request — you have to fully restart the browser process.',
  'app.db.starvedDbInfo': ' (worldforge v{version}, your data is safe)',
  'app.db.starvedSteps': 'Please do the following, in order:',
  'app.db.step1CloseAll': 'Close every browser window.',
  'app.db.step2Edge':
    'Edge’s “Startup boost” and “Continue running background extensions and apps after Microsoft Edge is closed” keep Edge alive after you close the window — turn both off under Settings → System and performance (at least this once).',
  'app.db.step2Kill':
    'Press Ctrl + Shift + Esc to open Task Manager and end every “{browser}” process — make sure none is left; the zombie tab jamming the queue is hiding among them.',
  'app.db.step3Reopen': 'Reopen the browser, come back to this page and press “Retry” below.',
  'app.db.retryAfterRestart': 'I fully restarted the browser — retry',
  'app.db.retryAfterClose': 'All closed — retry',
  'app.db.reload': 'Reload page',

  'app.db.missingBody':
    'Probing shows this browser environment never created the database at all — most likely site data is disabled:',
  'app.db.missingIncognito': 'You are in incognito / private mode — open a regular window instead.',
  'app.db.missingBlocked':
    'The browser is blocking site data / cookies for this site — allow it in the site settings (left of the address bar), or clear the “Blocked” entry for this site in browser settings.',

  'app.db.commonCauses': 'Common causes and fixes:',
  'app.db.causeOtherTabs':
    'Another tab or window still has WorldForge open (including background tabs the browser suspended) — close them all and retry.',
  'app.db.causeBackground':
    'If Edge / Chrome is set to keep running background apps after closing, the browser process is actually still alive — quit it from the browser menu, or end all browser processes in Task Manager and reopen.',
  'app.db.causeIncognito': 'You are in incognito / private mode — open a regular window instead.',
  'app.db.causeBlocked': 'The browser is set to block site data or cookies — allow them in site settings.',
  'app.db.fixThenRetry': 'Press “Retry” once fixed. Your data will not be lost.',

  'app.db.copyLog': 'Copy diagnostic log',
  'app.db.expandLog': 'Show diagnostic log (paste it to your AI assistant to pinpoint the stall)',

  'app.upgrade.title': 'Upgrading the database',
  'app.upgrade.timeoutTitle': 'Timed out waiting for the database upgrade',
  'app.upgrade.timeoutDefault': 'Timed out waiting for the upgrade',
  'app.upgrade.waiting': 'Waiting for other WorldForge tabs to release the database…',
  'app.upgrade.body':
    'Another WorldForge tab (possibly a background tab the browser suspended) is holding the older database. Close it and this will finish automatically — no refresh needed. Your data is unaffected.',
  'app.upgrade.reload': 'Reload this page',
};

export default en;
