/**
 * SpoilerGuard matching engine.
 *
 * Pure, dependency-free logic shared by the content script, the popup and the
 * options page. Decides whether a YouTube item should be covered, and why.
 */
(function (root) {
  'use strict';

  const DEFAULT_SETTINGS = {
    enabled: true,
    snoozeUntil: 0,
    coverStyle: 'blur',
    revealMinutes: 10,
    showCounter: true,
    scope: {
      home: true,
      search: false,
      watchSidebar: true,
      shorts: true,
      channel: true,
      comments: false,
      playlist: true
    },
    packs: [],
    allowedVideos: [],
    allowedChannels: []
  };

  function normalize(text) {
    if (!text) return '';
    return String(text)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Padded text so that whole-word lookups are a plain substring search. */
  function padded(text) {
    return ' ' + normalize(text) + ' ';
  }

  function matchesTerm(haystack, term) {
    const needle = normalize(term);
    if (!needle) return false;
    return haystack.includes(' ' + needle + ' ');
  }

  function matchesAnyTerm(haystack, terms) {
    if (!terms) return null;
    for (const term of terms) {
      if (matchesTerm(haystack, term)) return term;
    }
    return null;
  }

  function matchesAnyRegex(rawText, patterns) {
    if (!patterns) return null;
    for (const pattern of patterns) {
      try {
        if (new RegExp(pattern, 'i').test(rawText)) return pattern;
      } catch (err) {
        // A user-authored pattern that does not compile is ignored rather than
        // breaking every other rule on the page.
      }
    }
    return null;
  }

  function channelMatches(channel, channelRules) {
    if (!channel || !channelRules) return null;
    const normalizedChannel = normalize(channel);
    const handle = String(channel).trim().toLowerCase();
    for (const rule of channelRules) {
      const raw = String(rule).trim().toLowerCase();
      if (!raw) continue;
      if (raw.startsWith('@')) {
        if (handle === raw || handle === raw.slice(1)) return rule;
        continue;
      }
      if (normalize(rule) === normalizedChannel) return rule;
    }
    return null;
  }

  const DAYS_PER_UNIT = {
    second: 1 / 86400,
    minute: 1 / 1440,
    hour: 1 / 24,
    day: 1,
    week: 7,
    month: 30.4,
    year: 365
  };

  // YouTube writes both "3 years ago" and the compact "3y ago"; "mo" is months
  // while a bare "m" is minutes.
  const AGE_UNITS = {
    s: 'second', sec: 'second', secs: 'second', second: 'second', seconds: 'second',
    m: 'minute', min: 'minute', mins: 'minute', minute: 'minute', minutes: 'minute',
    h: 'hour', hr: 'hour', hrs: 'hour', hour: 'hour', hours: 'hour',
    d: 'day', day: 'day', days: 'day',
    w: 'week', wk: 'week', wks: 'week', week: 'week', weeks: 'week',
    mo: 'month', mos: 'month', month: 'month', months: 'month',
    y: 'year', yr: 'year', yrs: 'year', year: 'year', years: 'year'
  };

  const AGE_RE = /(\d+)\s*([a-z]+)\s+ago/;

  /** "3 years ago" and "3y ago" -> 1095. Null when the text is not an age. */
  function parseAgeDays(text) {
    if (!text) return null;
    const match = normalize(text).match(AGE_RE);
    if (!match) return null;
    const unit = AGE_UNITS[match[2]];
    if (!unit) return null;
    return Number(match[1]) * DAYS_PER_UNIT[unit];
  }

  function packIsActive(pack, now) {
    if (!pack || pack.enabled === false) return false;
    if (pack.expiresAt && pack.expiresAt < now) return false;
    return true;
  }

  function activePacks(settings, now) {
    const at = typeof now === 'number' ? now : Date.now();
    return (settings.packs || []).filter((pack) => packIsActive(pack, at));
  }

  /**
   * @param {{title?: string, channel?: string, handle?: string, extra?: string}} item
   * @param {object} settings
   * @returns {{blocked: boolean, packId?: string, label?: string, reason?: string}}
   */
  function evaluate(item, settings, now) {
    const at = typeof now === 'number' ? now : Date.now();
    if (!settings || settings.enabled === false) return { blocked: false };
    if (settings.snoozeUntil && settings.snoozeUntil > at) return { blocked: false };

    const rawText = [item.title, item.channel, item.handle, item.extra]
      .filter(Boolean)
      .join(' \u00b7 ');
    const haystack = padded(rawText);
    const channelName = item.channel || '';

    if (channelMatches(channelName, settings.allowedChannels)) return { blocked: false };

    const ageDays = parseAgeDays(item.age);

    for (const pack of activePacks(settings, at)) {
      const exception = matchesAnyTerm(haystack, pack.except);
      if (exception) continue;
      if (pack.maxAgeDays && ageDays !== null && ageDays > pack.maxAgeDays) continue;

      const channelHit =
        channelMatches(channelName, pack.channels) ||
        channelMatches(item.handle, pack.channels);
      if (channelHit) {
        return {
          blocked: true,
          packId: pack.id,
          label: pack.label || pack.name,
          reason: 'channel: ' + channelHit
        };
      }

      const termHit = matchesAnyTerm(haystack, pack.terms);
      if (termHit) {
        return {
          blocked: true,
          packId: pack.id,
          label: pack.label || pack.name,
          reason: 'keyword: ' + termHit
        };
      }

      const regexHit = matchesAnyRegex(rawText, pack.regex);
      if (regexHit) {
        return {
          blocked: true,
          packId: pack.id,
          label: pack.label || pack.name,
          reason: 'pattern: ' + regexHit
        };
      }
    }

    return { blocked: false };
  }

  function makePackId(name) {
    const slug = normalize(name).replace(/ /g, '-') || 'pack';
    return slug + '-' + Math.random().toString(36).slice(2, 7);
  }

  /** Accepts a pack authored by hand or downloaded, and fills in the gaps. */
  function sanitizePack(input) {
    if (!input || typeof input !== 'object') throw new Error('Pack must be an object');
    const name = String(input.name || '').trim();
    if (!name) throw new Error('Pack needs a name');
    const list = (value) =>
      Array.isArray(value) ? value.map((v) => String(v).trim()).filter(Boolean) : [];
    return {
      id: String(input.id || makePackId(name)),
      name,
      label: String(input.label || name + ' related content'),
      description: String(input.description || ''),
      author: String(input.author || ''),
      enabled: input.enabled !== false,
      expiresAt: Number(input.expiresAt) || 0,
      maxAgeDays: Number(input.maxAgeDays) || 0,
      ai: {
        enabled: Boolean(input.ai && input.ai.enabled),
        topics: list(input.ai && input.ai.topics),
        threshold: Number(input.ai && input.ai.threshold) || 0.35
      },
      terms: list(input.terms),
      regex: list(input.regex),
      channels: list(input.channels),
      except: list(input.except),
      source: String(input.source || '')
    };
  }

  function withDefaults(stored) {
    const settings = Object.assign({}, DEFAULT_SETTINGS, stored || {});
    settings.scope = Object.assign({}, DEFAULT_SETTINGS.scope, (stored && stored.scope) || {});
    settings.packs = (Array.isArray(settings.packs) ? settings.packs : []).map((pack) => {
      try {
        return sanitizePack(pack);
      } catch (err) {
        return null;
      }
    }).filter(Boolean);
    settings.allowedVideos = Array.isArray(settings.allowedVideos) ? settings.allowedVideos : [];
    settings.allowedChannels = Array.isArray(settings.allowedChannels)
      ? settings.allowedChannels
      : [];
    return settings;
  }

  /*
   * Settings live in chrome.storage.local: sync caps a single item at 8 KB,
   * which a handful of packs passes, and the write then fails silently.
   */
  async function readSettings() {
    const local = await chrome.storage.local.get('settings');
    if (local.settings) return local.settings;
    const synced = await chrome.storage.sync.get('settings');
    if (!synced.settings) return null;
    // Another context may have migrated and been edited while sync was read.
    const fresh = await chrome.storage.local.get('settings');
    if (fresh.settings) return fresh.settings;
    await chrome.storage.local.set({ settings: synced.settings });
    return synced.settings;
  }

  async function writeSettings(settings) {
    await chrome.storage.local.set({ settings });
  }

  const api = {
    DEFAULT_SETTINGS,
    readSettings,
    writeSettings,
    normalize,
    padded,
    matchesTerm,
    parseAgeDays,
    evaluate,
    activePacks,
    sanitizePack,
    makePackId,
    withDefaults
  };

  root.SGMatcher = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
