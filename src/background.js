/* SpoilerGuard service worker: first-run setup, context menus, badge counter. */
importScripts('matcher.js');

const M = self.SGMatcher;

const STARTER_PACKS = ['packs/god-of-war.json', 'packs/kardashians.json'];

async function getSettings() {
  return M.withDefaults(await M.readSettings());
}

async function saveSettings(settings) {
  await M.writeSettings(settings);
}

async function seedStarterPacks() {
  const settings = await getSettings();
  if (settings.packs.length) return;
  const packs = [];
  for (const path of STARTER_PACKS) {
    try {
      const response = await fetch(chrome.runtime.getURL(path));
      const pack = M.sanitizePack(await response.json());
      pack.enabled = false;
      packs.push(pack);
    } catch (err) {
      console.warn('SpoilerGuard: could not load starter pack', path, err);
    }
  }
  settings.packs = packs;
  await saveSettings(settings);
}

function createMenus() {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'sg-block-channel',
      title: 'SpoilerGuard: block this channel',
      contexts: ['all'],
      documentUrlPatterns: ['https://www.youtube.com/*']
    });
    chrome.contextMenus.create({
      id: 'sg-block-keywords',
      title: 'SpoilerGuard: block keywords from this video…',
      contexts: ['all'],
      documentUrlPatterns: ['https://www.youtube.com/*']
    });
    chrome.contextMenus.create({
      id: 'sg-block-selection',
      title: 'SpoilerGuard: block the words "%s"',
      contexts: ['selection'],
      documentUrlPatterns: ['https://www.youtube.com/*']
    });
    chrome.contextMenus.create({
      id: 'sg-allow-video',
      title: 'SpoilerGuard: always allow this video',
      contexts: ['all'],
      documentUrlPatterns: ['https://www.youtube.com/*']
    });
    chrome.contextMenus.create({
      id: 'sg-open-options',
      title: 'SpoilerGuard: manage block packs',
      contexts: ['all'],
      documentUrlPatterns: ['https://www.youtube.com/*']
    });
  });
}

/*
 * Menus survive worker restarts, and rebuilding them on every boot tears them
 * down while a click that just woke the worker is still being delivered, which
 * swallowed the click. chrome.storage.session is cleared when the extension
 * reloads, so this still rebuilds after an unpacked reload.
 */
async function ensureMenus() {
  const { menusReady } = await chrome.storage.session.get('menusReady');
  if (menusReady) return;
  await chrome.storage.session.set({ menusReady: true });
  createMenus();
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await seedStarterPacks();
  await chrome.storage.session.remove('menusReady');
  await ensureMenus();
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(ensureMenus);

ensureMenus();

async function myBlocksPack(settings) {
  let pack = settings.packs.find((p) => p.id === 'my-blocks');
  if (!pack) {
    pack = M.sanitizePack({ id: 'my-blocks', name: 'My blocks', label: 'Blocked by you' });
    settings.packs.unshift(pack);
  }
  pack.enabled = true;
  return pack;
}

async function addTerms(terms) {
  const clean = (terms || []).map((t) => String(t).trim()).filter(Boolean);
  if (!clean.length) return;
  const settings = await getSettings();
  const pack = await myBlocksPack(settings);
  for (const term of clean) if (!pack.terms.includes(term)) pack.terms.push(term);
  await saveSettings(settings);
}

let pushedTarget = null;

async function contextTarget(tabId) {
  try {
    const info = await chrome.tabs.sendMessage(tabId, { type: 'sg:context-target' });
    if (info) return info;
  } catch (err) {
    console.warn('SpoilerGuard: could not read the right-clicked tile', err);
  }
  return pushedTarget;
}

async function quickBlockChannel(tabId) {
  const info = await contextTarget(tabId);
  if (!info || !(info.channel || info.handle)) return;
  const settings = await getSettings();
  const pack = await myBlocksPack(settings);
  const value = info.handle || info.channel;
  if (!pack.channels.includes(value)) pack.channels.push(value);
  await saveSettings(settings);
}

async function quickAllowVideo(tabId) {
  const info = await contextTarget(tabId);
  if (!info || !info.videoId) return;
  const settings = await getSettings();
  if (!settings.allowedVideos.includes(info.videoId)) settings.allowedVideos.push(info.videoId);
  await saveSettings(settings);
}

chrome.contextMenus.onClicked.addListener(async (item, tab) => {
  if (!tab || !tab.id) return;
  try {
    if (item.menuItemId === 'sg-block-channel') await quickBlockChannel(tab.id);
    if (item.menuItemId === 'sg-block-keywords') {
      await chrome.tabs.sendMessage(tab.id, { type: 'sg:pick-keywords' }).catch(() => {});
    }
    if (item.menuItemId === 'sg-block-selection') await addTerms([item.selectionText]);
    if (item.menuItemId === 'sg-allow-video') await quickAllowVideo(tab.id);
    if (item.menuItemId === 'sg-open-options') chrome.runtime.openOptionsPage();
  } catch (err) {
    console.error('SpoilerGuard: menu action failed', item.menuItemId, err);
  }
});

let offscreenReady = null;

async function ensureOffscreen() {
  if (!chrome.offscreen) throw new Error('offscreen API unavailable');
  if (offscreenReady) return offscreenReady;
  offscreenReady = (async () => {
    const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (!existing.length) {
      await chrome.offscreen.createDocument({
        url: 'src/offscreen.html',
        reasons: ['WORKERS'],
        justification: 'Runs the on-device title classifier so titles never leave the browser.'
      });
    }
  })();
  return offscreenReady;
}

async function classifyWithAi(items) {
  await ensureOffscreen();
  // Offscreen documents have no chrome.storage, so the packs travel with the
  // request.
  const settings = await getSettings();
  const response = await chrome.runtime.sendMessage({
    target: 'sg-offscreen',
    type: 'sg:ai-classify',
    settings,
    items
  });
  if (!response || !response.ok) throw new Error((response && response.error) || 'no response');
  return response.results;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.target === 'sg-offscreen') return undefined;

  if (message && message.type === 'sg:ai-classify') {
    classifyWithAi(message.items)
      .then((results) => sendResponse({ ok: true, results }))
      .catch((error) => {
        offscreenReady = null;
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }

  if (message && message.type === 'sg:ai-warmup') {
    ensureOffscreen()
      .then(() => chrome.runtime.sendMessage({ target: 'sg-offscreen', type: 'sg:ai-warmup' }))
      .then((response) => sendResponse(response || { ok: false }))
      .catch((error) => {
        offscreenReady = null;
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }

  if (message && message.type === 'sg:context-target-set') {
    pushedTarget = message.info || null;
    return undefined;
  }
  if (message && message.type === 'sg:add-terms') {
    addTerms(message.terms);
    return undefined;
  }
  if (message && message.type === 'sg:count' && sender.tab && sender.tab.id) {
    const count = Number(message.count) || 0;
    chrome.action.setBadgeBackgroundColor({ color: '#3b6ef5' });
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: count ? String(count) : '' });
  }
  return undefined;
});
