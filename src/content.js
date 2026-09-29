/**
 * SpoilerGuard content script: finds YouTube items, asks the matcher whether
 * they should be hidden, and covers the ones that should be.
 */
(function () {
  'use strict';

  const M = self.SGMatcher;

  const TILE_SELECTORS = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-playlist-video-renderer',
    'ytd-playlist-panel-video-renderer',
    'ytd-reel-item-renderer',
    'ytm-shorts-lockup-view-model',
    'yt-lockup-view-model'
  ].join(',');

  const COMMENT_SELECTORS = 'ytd-comment-thread-renderer, ytd-comment-view-model';

  const TITLE_SELECTORS = [
    '#video-title',
    'a#video-title-link',
    'h3 a#video-title',
    '.yt-lockup-metadata-view-model-wiz__title',
    'h3.shortsLockupViewModelHostMetadataTitle',
    'h3 span',
    '#video-title-link'
  ].join(',');

  const CHANNEL_SELECTORS = [
    'ytd-channel-name a',
    '#channel-name a',
    '#channel-name #text',
    '.yt-content-metadata-view-model-wiz__metadata-text a',
    '.ytContentMetadataViewModelMetadataText a',
    '.ytd-channel-name'
  ].join(',');

  const METADATA_SELECTORS = [
    '.ytContentMetadataViewModelMetadataText',
    '.yt-content-metadata-view-model-wiz__metadata-text',
    '.yt-content-metadata-view-model__metadata-text',
    '#metadata-line span',
    '.inline-metadata-item'
  ].join(',');

  const DURATION_SELECTORS = [
    '.ytThumbnailOverlayBadgeViewModelBadge',
    'ytd-thumbnail-overlay-time-status-renderer #text',
    '.badge-shape-wiz__text',
    '.ytd-thumbnail-overlay-time-status-renderer',
    'badge-shape'
  ].join(',');

  const VIEWS_RE = /\b(views?|watching)\b/i;
  // Newer tiles print a bare count: "13M", "34K", "1,204".
  const COUNT_RE = /^\d[\d.,]*\s*[kmb]?$/i;
  const AGE_RE = /\bago\b|\b(premier|streamed|scheduled)/i;
  const DURATION_RE = /^\s*(\d+:)?\d{1,2}:\d{2}\s*$/;

  let settings = M.withDefaults(null);
  let reveals = {};
  let hiddenCount = 0;
  let lastContextTarget = null;

  /* ------------------------------------------------------------------ */
  /* state                                                               */
  /* ------------------------------------------------------------------ */

  async function loadState() {
    settings = M.withDefaults(await M.readSettings());
    const localItems = await chrome.storage.local.get('reveals');
    reveals = pruneReveals((localItems && localItems.reveals) || {});
  }

  function pruneReveals(map) {
    const now = Date.now();
    const next = {};
    for (const key of Object.keys(map)) {
      if (map[key] > now) next[key] = map[key];
    }
    return next;
  }

  function rememberReveal(key) {
    const minutes = Number(settings.revealMinutes) || 10;
    reveals[key] = Date.now() + minutes * 60 * 1000;
    chrome.storage.local.set({ reveals });
  }

  function allowVideoForever(videoId) {
    if (!videoId) return;
    const list = settings.allowedVideos.slice();
    if (!list.includes(videoId)) list.push(videoId);
    settings.allowedVideos = list;
    M.writeSettings(settings);
  }

  /* ------------------------------------------------------------------ */
  /* extraction                                                          */
  /* ------------------------------------------------------------------ */

  function textOf(el) {
    if (!el) return '';
    return (el.getAttribute('title') || el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Modern lockup tiles print the channel name as a plain span rather than a
   * link, so fall back to the first metadata chunk that is not views or age.
   */
  function readMetadata(el) {
    const meta = { channel: '', views: '', age: '', duration: '' };
    const chunks = [];
    el.querySelectorAll(METADATA_SELECTORS).forEach((node) => {
      // A row can be one element holding "1.2M views \u00b7 3 years ago".
      textOf(node)
        .split(/\s*[\u00b7\u2022|]\s*/)
        .forEach((part) => {
          const value = part.trim();
          if (value && !chunks.includes(value)) chunks.push(value);
        });
    });

    for (const chunk of chunks) {
      const isViews = VIEWS_RE.test(chunk) || COUNT_RE.test(chunk);
      if (!meta.views && isViews) {
        meta.views = COUNT_RE.test(chunk) ? chunk + ' views' : chunk;
      } else if (!meta.age && AGE_RE.test(chunk)) {
        meta.age = chunk;
      } else if (!meta.channel && !isViews && !AGE_RE.test(chunk)) {
        meta.channel = chunk;
      }
    }

    const durationEl = el.querySelector(DURATION_SELECTORS);
    const duration = textOf(durationEl);
    if (DURATION_RE.test(duration)) meta.duration = duration.trim();

    return meta;
  }

  function readTile(el) {
    const titleEl = el.querySelector(TITLE_SELECTORS);
    const channelEl = el.querySelector(CHANNEL_SELECTORS);
    const meta = readMetadata(el);
    const link = el.querySelector('a#thumbnail, a[href*="/watch?v="], a[href*="/shorts/"]');
    const href = link ? link.getAttribute('href') || '' : '';
    const channelLink = el.querySelector('a[href^="/@"], a[href^="/channel/"], a[href^="/c/"]');
    const channelHref = channelLink ? channelLink.getAttribute('href') || '' : '';

    let videoId = '';
    const watchMatch = href.match(/[?&]v=([\w-]{6,})/);
    const shortsMatch = href.match(/\/shorts\/([\w-]{6,})/);
    if (watchMatch) videoId = watchMatch[1];
    else if (shortsMatch) videoId = shortsMatch[1];

    const handleMatch = channelHref.match(/^\/(@[^/?]+)/);

    return {
      title: textOf(titleEl),
      channel: textOf(channelEl) || meta.channel,
      handle: handleMatch ? handleMatch[1] : '',
      views: meta.views,
      age: meta.age,
      duration: meta.duration,
      videoId
    };
  }

  function scopeOf(el) {
    const path = location.pathname;
    if (path === '/results') return 'search';
    if (path.startsWith('/playlist')) return 'playlist';

    if (
      el.matches('ytm-shorts-lockup-view-model, ytd-reel-item-renderer') ||
      el.closest('ytd-rich-shelf-renderer[is-shorts], ytd-reel-shelf-renderer')
    ) {
      return 'shorts';
    }
    if (el.matches('ytd-compact-video-renderer') || el.closest('#secondary')) return 'watchSidebar';

    if (path.startsWith('/channel/') || path.startsWith('/c/') || path.startsWith('/@')) {
      return 'channel';
    }
    if (path.startsWith('/watch') || path.startsWith('/shorts/')) return 'watchSidebar';
    return 'home';
  }

  /* ------------------------------------------------------------------ */
  /* covering                                                            */
  /* ------------------------------------------------------------------ */

  function buildCover(el, verdict, info) {
    const cover = document.createElement('div');
    cover.className = 'sg-cover';
    cover.dataset.sgStyle = settings.coverStyle;
    cover.title = 'SpoilerGuard hid this because of ' + (verdict.reason || 'one of your rules');

    const label = document.createElement('div');
    label.className = 'sg-cover-label';
    label.textContent = verdict.label || 'Hidden content';

    const facts = [info.duration, info.views, info.age].filter(Boolean).join(' \u00b7 ');
    const meta = document.createElement('div');
    meta.className = 'sg-cover-meta';
    meta.textContent = facts;

    const reason = document.createElement('div');
    reason.className = 'sg-cover-reason';
    reason.textContent = verdict.reason ? 'matched ' + verdict.reason : '';

    const actions = document.createElement('div');
    actions.className = 'sg-cover-actions';

    const reveal = document.createElement('button');
    reveal.className = 'sg-btn sg-btn-primary';
    reveal.type = 'button';
    reveal.textContent = 'Reveal';
    reveal.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      rememberReveal(info.videoId || info.title);
      uncover(el);
    });

    const always = document.createElement('button');
    always.className = 'sg-btn';
    always.type = 'button';
    always.textContent = 'Always allow';
    always.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      allowVideoForever(info.videoId);
      uncover(el);
    });

    actions.appendChild(reveal);
    if (info.videoId) actions.appendChild(always);

    cover.appendChild(label);
    if (facts) cover.appendChild(meta);
    if (verdict.reason) cover.appendChild(reason);
    cover.appendChild(actions);

    cover.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    ['mouseover', 'mouseenter', 'pointerover'].forEach((type) => {
      cover.addEventListener(type, (event) => event.stopPropagation());
    });

    return cover;
  }

  function cover(el, verdict, info) {
    if (el.dataset.sgCovered === '1') return;
    el.dataset.sgCovered = '1';
    el.classList.add('sg-hidden-item');
    el.appendChild(buildCover(el, verdict, info));
    hiddenCount += 1;
    reportCount();
  }

  function uncover(el) {
    const existing = el.querySelector(':scope > .sg-cover');
    if (existing) existing.remove();
    el.classList.remove('sg-hidden-item');
    el.dataset.sgCovered = '0';
    if (hiddenCount > 0) hiddenCount -= 1;
    reportCount();
  }

  let reportTimer = null;
  function reportCount() {
    clearTimeout(reportTimer);
    reportTimer = setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'sg:count', count: hiddenCount }).catch(() => {});
    }, 200);
  }

  /* ------------------------------------------------------------------ */
  /* scanning                                                            */
  /* ------------------------------------------------------------------ */

  function processTile(el) {
    if (el.parentElement && el.parentElement.closest(TILE_SELECTORS)) return;

    const info = readTile(el);
    if (!info.title) return;

    const key = info.videoId + '|' + info.title;
    if (el.dataset.sgKey === key) return;
    el.dataset.sgKey = key;
    uncover(el);

    const scope = scopeOf(el);
    if (settings.scope[scope] === false) return;
    if (info.videoId && settings.allowedVideos.includes(info.videoId)) return;

    const revealKey = info.videoId || info.title;
    if (reveals[revealKey] && reveals[revealKey] > Date.now()) return;

    const verdict = M.evaluate(info, settings);
    if (verdict.blocked) {
      cover(el, verdict, info);
      return;
    }
    queueForAi(el, info);
  }

  function processComment(el) {
    if (settings.scope.comments === false) return;
    if (el.parentElement && el.parentElement.closest(COMMENT_SELECTORS)) return;
    const body = el.querySelector('#content-text');
    const author = el.querySelector('#author-text');
    const text = textOf(body);
    if (!text) return;

    const key = 'c|' + text.slice(0, 80);
    if (el.dataset.sgKey === key) return;
    el.dataset.sgKey = key;
    uncover(el);

    const revealKey = key;
    if (reveals[revealKey] && reveals[revealKey] > Date.now()) return;

    const verdict = M.evaluate({ title: text, channel: textOf(author) }, settings);
    if (verdict.blocked) cover(el, verdict, { videoId: '', title: key });
  }

  function scan(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll(TILE_SELECTORS).forEach(processTile);
    scope.querySelectorAll(COMMENT_SELECTORS).forEach(processComment);
  }

  function rescanAll() {
    hiddenCount = 0;
    aiQueue.clear();
    aiSeen.clear();
    document.querySelectorAll('[data-sg-key]').forEach((el) => {
      delete el.dataset.sgKey;
      uncover(el);
    });
    hiddenCount = 0;
    scan(document);
  }

  /* ------------------------------------------------------------------ */
  /* on-device AI layer                                                  */
  /* ------------------------------------------------------------------ */

  const aiQueue = new Map();
  const aiSeen = new Set();
  let aiTimer = null;
  let aiBusy = false;

  function aiEnabled() {
    return M.activePacks(settings).some((pack) => pack.ai && pack.ai.enabled);
  }

  function queueForAi(el, info) {
    if (!aiEnabled() || !info.title) return;
    const id = el.dataset.sgKey;
    if (!id || aiSeen.has(id)) return;
    aiQueue.set(id, { el, info });
    clearTimeout(aiTimer);
    aiTimer = setTimeout(flushAiQueue, 300);
  }

  async function flushAiQueue() {
    if (aiBusy || !aiQueue.size) return;
    aiBusy = true;
    const batch = Array.from(aiQueue.entries()).slice(0, 40);
    for (const [id] of batch) {
      aiQueue.delete(id);
      aiSeen.add(id);
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'sg:ai-classify',
        items: batch.map(([id, entry]) => ({
          id,
          title: entry.info.title,
          age: entry.info.age
        }))
      });
      if (response && response.ok) {
        const byId = new Map(batch);
        for (const result of response.results) {
          const entry = byId.get(result.id);
          if (!entry || entry.el.dataset.sgKey !== result.id) continue;
          if (!entry.el.isConnected) continue;
          cover(entry.el, { blocked: true, ...result }, entry.info);
        }
      }
    } catch (err) {
      // The worker may be asleep or the model still loading; the next scan
      // re-queues anything that is still visible.
    } finally {
      aiBusy = false;
      if (aiQueue.size) aiTimer = setTimeout(flushAiQueue, 300);
    }
  }

  let scanTimer = null;
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => scan(document), 120);
  }

  /* ------------------------------------------------------------------ */
  /* keyword picker                                                      */
  /* ------------------------------------------------------------------ */

  const STOPWORDS = new Set(
    ('the a an and or of to in on for with is are was were this that my your his her their it ' +
      'you we they i how why what when who all new best top vs vs. official full video part ep ' +
      'episode gameplay ft feat')
      .split(' ')
  );

  function keywordCandidates(info) {
    const suggestions = [];
    const words = M.normalize(info.title).split(' ');
    const seen = new Set();
    const push = (value) => {
      const key = M.normalize(value);
      if (!key || seen.has(key)) return;
      seen.add(key);
      suggestions.push(value);
    };

    for (let i = 0; i < words.length - 1; i += 1) {
      if (STOPWORDS.has(words[i]) || STOPWORDS.has(words[i + 1])) continue;
      push(words[i] + ' ' + words[i + 1]);
    }
    for (const word of words) {
      if (word.length < 3 || STOPWORDS.has(word) || /^\d+$/.test(word)) continue;
      push(word);
    }
    return suggestions.slice(0, 14);
  }

  function closePicker() {
    const existing = document.querySelector('.sg-modal-backdrop');
    if (existing) existing.remove();
  }

  function openKeywordPicker(info) {
    closePicker();
    const backdrop = document.createElement('div');
    backdrop.className = 'sg-modal-backdrop';
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) closePicker();
    });

    const modal = document.createElement('div');
    modal.className = 'sg-modal';

    const heading = document.createElement('h3');
    heading.textContent = 'Block keywords from this video';
    const quote = document.createElement('p');
    quote.className = 'sg-modal-quote';
    quote.textContent = info.title;

    const help = document.createElement('p');
    help.className = 'sg-modal-help';
    help.textContent = 'Anything you tick will be hidden everywhere on YouTube from now on.';

    const list = document.createElement('div');
    list.className = 'sg-chiplist';
    const chosen = new Set();

    for (const candidate of keywordCandidates(info)) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'sg-chip';
      chip.textContent = candidate;
      chip.addEventListener('click', () => {
        if (chosen.has(candidate)) chosen.delete(candidate);
        else chosen.add(candidate);
        chip.classList.toggle('sg-chip-on', chosen.has(candidate));
      });
      list.appendChild(chip);
    }

    const custom = document.createElement('input');
    custom.type = 'text';
    custom.className = 'sg-input';
    custom.placeholder = 'or type your own words, comma separated';

    const block = document.createElement('button');
    block.type = 'button';
    block.className = 'sg-btn sg-btn-primary';
    block.textContent = 'Block these';
    block.addEventListener('click', () => {
      const terms = Array.from(chosen).concat(
        custom.value
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      );
      if (terms.length) chrome.runtime.sendMessage({ type: 'sg:add-terms', terms });
      closePicker();
    });

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'sg-btn';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', closePicker);

    const actions = document.createElement('div');
    actions.className = 'sg-modal-actions';
    actions.appendChild(cancel);
    actions.appendChild(block);

    modal.appendChild(heading);
    modal.appendChild(quote);
    modal.appendChild(help);
    modal.appendChild(list);
    modal.appendChild(custom);
    modal.appendChild(actions);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
  }

  /* ------------------------------------------------------------------ */
  /* wiring                                                              */
  /* ------------------------------------------------------------------ */

  document.addEventListener(
    'contextmenu',
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      lastContextTarget = target ? target.closest(TILE_SELECTORS) : null;
      // Push the tile now so the menu click finds it even if asking the page
      // back fails while the service worker is waking up.
      chrome.runtime
        .sendMessage({
          type: 'sg:context-target-set',
          info: lastContextTarget ? readTile(lastContextTarget) : null
        })
        .catch(() => {});
    },
    true
  );

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === 'sg:context-target') {
      sendResponse(lastContextTarget ? readTile(lastContextTarget) : null);
      return true;
    }
    if (message && message.type === 'sg:pick-keywords') {
      const info = lastContextTarget ? readTile(lastContextTarget) : null;
      if (info && info.title) openKeywordPicker(info);
    }
    if (message && message.type === 'sg:rescan') {
      loadState().then(rescanAll);
    }
    return undefined;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) {
      settings = M.withDefaults(changes.settings.newValue);
      rescanAll();
    }
    if (area === 'local' && changes.reveals) {
      reveals = pruneReveals(changes.reveals.newValue || {});
    }
  });

  window.addEventListener('yt-navigate-finish', () => {
    hiddenCount = 0;
    scheduleScan();
  });

  loadState().then(() => {
    scan(document);
    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setInterval(() => scan(document), 2000);
  });
})();
