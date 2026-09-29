(function () {
  'use strict';

  const M = self.SGMatcher;
  const $ = (id) => document.getElementById(id);

  const REPO = 'https://github.com/vedant-95/spoilerguard';
  const SHARE_FORM = REPO + '/issues/new';
  const COMMUNITY_INDEX =
    'https://raw.githubusercontent.com/vedant-95/spoilerguard/main/packs/index.json';
  const COMMUNITY_BASE = 'https://raw.githubusercontent.com/vedant-95/spoilerguard/main/';

  const SCOPE_LABELS = {
    home: 'The home page and your subscriptions',
    search: 'Things you searched for',
    watchSidebar: 'The next videos beside the one you are watching',
    shorts: 'Shorts',
    channel: 'Channel pages',
    comments: 'Comments',
    playlist: 'Playlists'
  };

  let settings = M.withDefaults(null);
  let saveTimer = 0;

  async function load() {
    settings = M.withDefaults(await M.readSettings());
    renderAll();
  }

  function status(text, bad) {
    const node = $('saveStatus');
    node.textContent = text;
    node.className = bad ? 'save-status bad' : 'save-status';
  }

  async function save() {
    clearTimeout(saveTimer);
    try {
      await M.writeSettings(settings);
      status('Saved');
      saveTimer = setTimeout(() => status(''), 1500);
    } catch (err) {
      status('Could not save: ' + err.message, true);
    }
  }

  // Text fields used to persist only on blur, so typing and closing the tab
  // threw the edit away.
  const pending = new Set();

  function flushPending() {
    if (!pending.size) return;
    for (const run of Array.from(pending)) run();
  }

  // Closing the tab kills the debounce timer, so flush while the page is still
  // alive.
  window.addEventListener('pagehide', flushPending);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPending();
  });

  function autosave(input, apply) {
    let timer = 0;
    const run = () => {
      clearTimeout(timer);
      pending.delete(run);
      apply();
      save();
    };
    input.addEventListener('input', () => {
      status('Saving…');
      clearTimeout(timer);
      pending.add(run);
      timer = setTimeout(run, 400);
    });
    input.addEventListener('change', run);
  }

  function el(tag, props, children) {
    const node = document.createElement(tag);
    Object.assign(node, props || {});
    for (const child of children || []) node.appendChild(child);
    return node;
  }

  function field(labelText, input, hintText) {
    const parts = [el('span', { textContent: labelText })];
    if (hintText) parts.push(el('p', { className: 'hint', textContent: hintText }));
    parts.push(input);
    return el('div', { className: 'field' }, parts);
  }

  function lines(values) {
    return (values || []).join('\n');
  }

  function plural(count, one, many) {
    return count + ' ' + (count === 1 ? one : many);
  }

  function countLabel(pack) {
    return plural(pack.terms.length, 'word', 'words') + ', ' + plural(pack.channels.length, 'channel', 'channels');
  }

  function parseLines(text) {
    return text
      .split(/[\n,]/)
      .map((t) => t.trim())
      .filter(Boolean);
  }

  // A date input speaks local dates, so formatting through UTC would show the
  // day before for anyone west of Greenwich.
  function dateValue(stamp) {
    if (!stamp) return '';
    const d = new Date(stamp);
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /* ---------------------------------------------------------------- */

  function renderScope() {
    const host = $('scope');
    host.textContent = '';
    for (const key of Object.keys(SCOPE_LABELS)) {
      const box = el('input', { type: 'checkbox', checked: settings.scope[key] !== false });
      box.addEventListener('change', () => {
        settings.scope[key] = box.checked;
        save();
      });
      host.appendChild(
        el('label', { className: 'row' }, [box, el('span', { textContent: SCOPE_LABELS[key] })])
      );
    }
  }

  function renderBehaviour() {
    $('coverStyle').value = settings.coverStyle;
    $('revealMinutes').value = settings.revealMinutes;
  }

  function aiPanel(pack) {
    const on = el('input', { type: 'checkbox', checked: Boolean(pack.ai && pack.ai.enabled) });

    const topics = el('textarea', {
      value: lines(pack.ai.topics),
      placeholder: 'the ghost of sparta fights the gods of olympus'
    });
    autosave(topics, () => {
      pack.ai.topics = parseLines(topics.value);
    });

    /*
     * The slider reads left to right as "hide more", while the underlying
     * cutoff works the other way around: a lower cutoff hides more.
     */
    const EAGER_MIN = 0.2;
    const EAGER_MAX = 0.6;
    const toEager = (threshold) =>
      Math.round(((EAGER_MAX - threshold) / (EAGER_MAX - EAGER_MIN)) * 100);
    const toThreshold = (eager) =>
      Number((EAGER_MAX - (eager / 100) * (EAGER_MAX - EAGER_MIN)).toFixed(2));

    const slider = el('input', {
      type: 'range',
      min: '0',
      max: '100',
      step: '1',
      value: String(toEager(pack.ai.threshold))
    });
    const sliderValue = el('span', { className: 'pill' });
    const showValue = () => {
      sliderValue.textContent = toEager(pack.ai.threshold) + ' out of 100';
    };
    showValue();
    slider.addEventListener('input', () => {
      pack.ai.threshold = toThreshold(Number(slider.value));
      showValue();
    });
    slider.addEventListener('change', save);

    const body = el('div', { className: 'subcard-body' }, [
      field(
        'Say in your own words what you want hidden',
        topics,
        'Write one whole sentence, like "the ghost of sparta fights the gods of olympus". One idea per line. A full sentence works much better than one or two words.'
      ),
      field(
        'How much should it hide?',
        el('div', { className: 'slider-row' }, [
          el('span', { className: 'pill', textContent: 'Hide less' }),
          slider,
          el('span', { className: 'pill', textContent: 'Hide more' }),
          sliderValue
        ]),
        'Move it right to cover more videos, but it will also cover some you would have liked. Move it left and a few spoilers slip through. The middle is good for most people.'
      )
    ]);

    const setOpen = () => {
      body.hidden = !on.checked;
    };
    setOpen();
    on.addEventListener('change', () => {
      pack.ai.enabled = on.checked;
      setOpen();
      save();
      if (on.checked) chrome.runtime.sendMessage({ type: 'sg:ai-warmup' });
    });

    return el('div', { className: 'subcard' }, [
      el('div', { className: 'subcard-head' }, [
        el('label', { className: 'row' }, [
          on,
          el('span', {
            className: 'subcard-title',
            textContent: 'Smart hiding'
          })
        ])
      ]),
      el('p', {
        className: 'hint',
        textContent:
          'Your words only catch titles that use those exact words. A title like "HE FINALLY MEETS HIS SON" never says God of War, but it means the same thing. Turn this on and SpoilerGuard hides those too. It is not perfect, so it covers the odd video you did not mind seeing.'
      }),
      body
    ]);
  }

  function renderPack(pack, index) {
    const enabled = el('input', { type: 'checkbox', checked: pack.enabled !== false });
    enabled.addEventListener('change', () => {
      pack.enabled = enabled.checked;
      save();
    });

    const name = el('input', { type: 'text', className: 'card-title', value: pack.name });
    // A list without a name is dropped on load, so ignore an emptied field.
    autosave(name, () => {
      const value = name.value.trim();
      if (value) pack.name = value;
    });
    name.addEventListener('blur', () => {
      if (!name.value.trim()) name.value = pack.name;
    });

    const count = el('span', { className: 'pill', textContent: countLabel(pack) });
    const toggle = el('button', { className: 'link', textContent: 'Edit' });

    const head = el('div', { className: 'card-head' }, [
      el('label', { className: 'row' }, [
        enabled,
        el('span', { className: 'card-number', textContent: String(index + 1) }),
        name
      ]),
      el('div', { className: 'row' }, [count, toggle])
    ]);

    const label = el('input', { type: 'text', value: pack.label });
    autosave(label, () => {
      pack.label = label.value;
    });

    const terms = el('textarea', { value: lines(pack.terms) });
    autosave(terms, () => {
      pack.terms = parseLines(terms.value);
      count.textContent = countLabel(pack);
    });

    const channels = el('textarea', { value: lines(pack.channels) });
    autosave(channels, () => {
      pack.channels = parseLines(channels.value);
      count.textContent = countLabel(pack);
    });

    const except = el('textarea', { value: lines(pack.except) });
    autosave(except, () => {
      pack.except = parseLines(except.value);
    });

    const onlyAfter = el('input', { type: 'date', value: dateValue(pack.onlyAfter) });
    onlyAfter.addEventListener('change', () => {
      pack.onlyAfter = onlyAfter.value ? new Date(onlyAfter.value + 'T00:00:00').getTime() : 0;
      save();
    });

    const expires = el('input', { type: 'date', value: dateValue(pack.expiresAt) });
    expires.addEventListener('change', () => {
      pack.expiresAt = expires.value ? new Date(expires.value + 'T23:59:59').getTime() : 0;
      save();
    });

    const remove = el('button', { className: 'danger', textContent: 'Delete this list' });
    remove.title = 'Remove this list from SpoilerGuard';
    remove.addEventListener('click', () => {
      settings.packs = settings.packs.filter((p) => p !== pack);
      save();
      renderPacks();
      renderCatalog();
      renderSharePicker();
    });

    const exportOne = el('button', { textContent: 'Save this list to a file' });
    exportOne.addEventListener('click', () => download(pack.name, pack));

    const body = el('div', { className: 'card-body' }, [
      field(
        'Words to hide',
        terms,
        'One word or phrase on each line. A video is covered if its title or channel has any of them. Whole words only, so "gow" will not hit "Glasgow".'
      ),
      field(
        'Channels to hide',
        channels,
        'One on each line. Use the channel name or its @handle. Good for channels that spoil things with titles like "HE DID WHAT?!".'
      ),
      field(
        'Words that mean keep it',
        except,
        'One on each line. These win. Hide "ragnarok" but still show anything that says "thor ragnarok".'
      ),
      field(
        'Only hide videos made after this day',
        onlyAfter,
        'Leave it empty to hide old videos too. A video made before you started the game cannot spoil it, so put the day you started here.'
      ),
      field(
        'Turn this list off on this day',
        expires,
        'Leave it empty to keep it on. Put the day you think you will finish, and SpoilerGuard stops hiding this on its own.'
      ),
      field(
        'What the cover should say',
        label,
        'This is all you see instead of the video, so say why it is hidden, like "God of War spoilers".'
      ),
      aiPanel(pack),
      el('div', { className: 'actions' }, [exportOne, remove])
    ]);

    // Collapsed by default so a long list of topics stays readable and it is
    // obvious where one list ends and the next begins.
    body.hidden = true;
    toggle.addEventListener('click', () => {
      body.hidden = !body.hidden;
      toggle.textContent = body.hidden ? 'Edit' : 'Done';
    });

    return el('div', { className: 'card pack' }, [head, body]);
  }

  function renderPacks() {
    const host = $('packs');
    host.textContent = '';
    if (!settings.packs.length) {
      host.appendChild(
        el('p', {
          className: 'hint',
          textContent:
            'You have no lists yet. Go to Ready made lists and pick one, or make your own below.'
        })
      );
      return;
    }
    settings.packs.forEach((pack, index) => host.appendChild(renderPack(pack, index)));
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(url + ' returned ' + response.status);
    return response.json();
  }

  /*
   * Ready made lists come from the extension itself and, when the network
   * allows, from the shared repository so new community lists show up without
   * shipping an update.
   */
  async function loadCatalog() {
    const bundled = await fetchJson(chrome.runtime.getURL('packs/index.json'));
    const entries = (bundled.packs || []).map((entry) => ({
      entry,
      url: chrome.runtime.getURL(entry.file),
      shared: false
    }));
    try {
      const remote = await fetchJson(COMMUNITY_INDEX);
      for (const entry of remote.packs || []) {
        if (entries.some((known) => known.entry.id === entry.id)) continue;
        entries.push({ entry, url: COMMUNITY_BASE + entry.file, shared: true });
      }
      $('catalogStatus').textContent = '';
    } catch (err) {
      $('catalogStatus').textContent =
        'Could not look for new lists right now. These are the ones that came with SpoilerGuard.';
    }
    return entries;
  }

  async function renderCatalog() {
    const host = $('catalog');
    host.textContent = '';
    let entries;
    try {
      entries = await loadCatalog();
    } catch (err) {
      host.appendChild(
        el('p', { className: 'hint', textContent: 'No ready made lists right now.' })
      );
      return;
    }

    for (const item of entries) {
      const entry = item.entry;
      const installed = settings.packs.some((p) => p.id === entry.id);
      const add = el('button', {
        className: installed ? '' : 'primary',
        textContent: installed ? 'You have this' : 'Use this list',
        disabled: installed
      });
      add.addEventListener('click', async () => {
        add.disabled = true;
        add.textContent = 'Adding…';
        try {
          const pack = M.sanitizePack(await fetchJson(item.url));
          pack.enabled = true;
          pack.source = item.shared ? entry.file : '';
          settings.packs.push(pack);
          await save();
          renderPacks();
          renderCatalog();
          renderSharePicker();
        } catch (err) {
          add.disabled = false;
          add.textContent = 'That did not work, try again';
        }
      });
      host.appendChild(
        el('div', { className: 'card' }, [
          el('div', { className: 'card-head' }, [
            el('div', { className: 'row' }, [
              el('span', { className: 'card-title', textContent: entry.name }),
              el('span', {
                className: 'pill',
                textContent: item.shared ? 'Made by someone else' : 'Comes with SpoilerGuard'
              })
            ]),
            add
          ]),
          el('p', { className: 'hint', textContent: entry.description || '' })
        ])
      );
    }
  }

  function renderAllowed() {
    const count = settings.allowedVideos.length;
    $('allowCount').textContent = count
      ? (count === 1 ? 'One video is here. It' : 'There are ' + count + ' videos here. They') +
        ' will never be covered.'
      : 'Nothing here yet. Click "Always show" on a cover to add a video.';
  }

  function renderSharePicker() {
    const picker = $('sharePick');
    picker.textContent = '';
    if (!settings.packs.length) {
      picker.appendChild(el('option', { textContent: 'You have no lists to share yet' }));
      $('shareBtn').disabled = true;
      return;
    }
    $('shareBtn').disabled = false;
    settings.packs.forEach((pack, index) => {
      picker.appendChild(el('option', { value: String(index), textContent: pack.name }));
    });
  }

  function renderMaster() {
    $('enabled').checked = settings.enabled !== false;
    $('enabledLabel').textContent = settings.enabled === false ? 'Off' : 'On';
  }

  function renderAll() {
    renderMaster();
    renderScope();
    renderBehaviour();
    renderPacks();
    renderCatalog();
    renderAllowed();
    renderSharePicker();
  }

  /* The tab rail shows one page at a time so nothing scrolls out of sight. */
  function showPage(name) {
    for (const tab of document.querySelectorAll('.tab')) {
      tab.setAttribute('aria-selected', String(tab.dataset.page === name));
    }
    for (const page of document.querySelectorAll('.page')) {
      page.classList.toggle('active', page.id === 'page-' + name);
    }
    location.hash = name;
  }

  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => showPage(tab.dataset.page));
  }
  showPage(document.getElementById('page-' + location.hash.slice(1)) ? location.hash.slice(1) : 'lists');

  /* ---------------------------------------------------------------- */

  function download(name, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: M.normalize(name).replace(/ /g, '-') + '.json' });
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importPayload(raw) {
    const text = raw.trim();
    let data;
    if (/^https?:\/\//i.test(text)) {
      data = await fetchJson(text);
    } else {
      data = JSON.parse(text);
    }
    const incoming = Array.isArray(data) ? data : data.packs && Array.isArray(data.packs) ? data.packs : [data];
    let added = 0;
    for (const item of incoming) {
      const pack = M.sanitizePack(item);
      if (settings.packs.some((p) => p.id === pack.id)) pack.id = M.makePackId(pack.name);
      settings.packs.push(pack);
      added += 1;
    }
    await save();
    renderPacks();
    renderSharePicker();
    return added;
  }

  $('coverStyle').addEventListener('change', (event) => {
    settings.coverStyle = event.target.value;
    save();
  });
  $('revealMinutes').addEventListener('change', (event) => {
    settings.revealMinutes = Math.max(1, Number(event.target.value) || 10);
    save();
  });
  $('enabled').addEventListener('change', (event) => {
    settings.enabled = event.target.checked;
    renderMaster();
    save();
  });
  $('newPack').addEventListener('click', async () => {
    settings.packs.push(M.sanitizePack({ name: 'My new list', enabled: true }));
    await save();
    renderPacks();
    renderSharePicker();
  });
  $('refreshCatalog').addEventListener('click', renderCatalog);
  $('shareBtn').addEventListener('click', () => {
    const pack = settings.packs[Number($('sharePick').value)];
    if (!pack) return;
    const share = {
      id: pack.id,
      name: pack.name,
      label: pack.label,
      terms: pack.terms,
      channels: pack.channels,
      except: pack.except
    };
    const params = new URLSearchParams({
      template: 'share-a-list.yml',
      title: 'Block list: ' + pack.name,
      'list-name': pack.name,
      'list-json': JSON.stringify(share, null, 2)
    });
    const url = SHARE_FORM + '?' + params.toString();
    // Very long lists do not survive a browser address bar, so hand those over
    // as a file the person can drag into the form instead.
    if (url.length > 6000) {
      download(pack.name, share);
      chrome.tabs.create({ url: SHARE_FORM + '?template=share-a-list.yml' });
      return;
    }
    chrome.tabs.create({ url });
  });
  $('importBtn').addEventListener('click', async () => {
    try {
      const added = await importPayload($('importText').value);
      $('importStatus').textContent = 'Added ' + added + (added === 1 ? ' list.' : ' lists.');
      $('importText').value = '';
    } catch (err) {
      $('importStatus').textContent = 'That did not work: ' + err.message;
    }
  });
  $('exportBtn').addEventListener('click', () => download('spoilerguard-packs', { packs: settings.packs }));
  $('clearAllowed').addEventListener('click', async () => {
    settings.allowedVideos = [];
    await save();
    renderAllowed();
  });

  load();
})();
