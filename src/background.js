/* SpoilerGuard service worker: first-run setup, context menus, badge counter. */
importScripts('matcher.js');

const M = self.SGMatcher;

const STARTER_PACKS = ['packs/god-of-war.json', 'packs/kardashians.json'];

async function getSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return M.withDefaults(settings);
}

async function saveSettings(settings) {
  await chrome.storage.sync.set({ settings });
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

chrome.runtime.onInstalled.addListener(async (details) => {
  await seedStarterPacks();
  createMenus();
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(createMenus);

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

async function quickBlockChannel(tabId) {
  const info = await chrome.tabs.sendMessage(tabId, { type: 'sg:context-target' });
  if (!info || !(info.channel || info.handle)) return;
  const settings = await getSettings();
  const pack = await myBlocksPack(settings);
  const value = info.handle || info.channel;
  if (!pack.channels.includes(value)) pack.channels.push(value);
  await saveSettings(settings);
}

async function quickAllowVideo(tabId) {
  const info = await chrome.tabs.sendMessage(tabId, { type: 'sg:context-target' });
  if (!info || !info.videoId) return;
  const settings = await getSettings();
  if (!settings.allowedVideos.includes(info.videoId)) settings.allowedVideos.push(info.videoId);
  await saveSettings(settings);
}

chrome.contextMenus.onClicked.addListener(async (item, tab) => {
  if (!tab || !tab.id) return;
  if (item.menuItemId === 'sg-block-channel') await quickBlockChannel(tab.id);
  if (item.menuItemId === 'sg-block-keywords') {
    await chrome.tabs.sendMessage(tab.id, { type: 'sg:pick-keywords' }).catch(() => {});
  }
  if (item.menuItemId === 'sg-block-selection') await addTerms([item.selectionText]);
  if (item.menuItemId === 'sg-allow-video') await quickAllowVideo(tab.id);
  if (item.menuItemId === 'sg-open-options') chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message, sender) => {
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
