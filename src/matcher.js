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

    for (const pack of activePacks(settings, at)) {
      const exception = matchesAnyTerm(haystack, pack.except);
      if (exception) continue;

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
    settings.packs = Array.isArray(settings.packs) ? settings.packs : [];
    settings.allowedVideos = Array.isArray(settings.allowedVideos) ? settings.allowedVideos : [];
    settings.allowedChannels = Array.isArray(settings.allowedChannels)
      ? settings.allowedChannels
      : [];
    return settings;
  }

  const api = {
    DEFAULT_SETTINGS,
    normalize,
    padded,
    matchesTerm,
    evaluate,
    activePacks,
    sanitizePack,
    makePackId,
    withDefaults
  };

  root.SGMatcher = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
