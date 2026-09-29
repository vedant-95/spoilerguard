(function () {
  'use strict';

  const M = self.SGMatcher;
  const $ = (id) => document.getElementById(id);

  const SCOPE_LABELS = {
    home: 'Home page and subscription feeds',
    search: 'Search results (off by default — that is where you go looking on purpose)',
    watchSidebar: 'Suggested videos next to the one you are watching',
    shorts: 'Shorts shelves',
    channel: 'Channel pages',
    comments: 'Comments (they spoil too)',
    playlist: 'Playlists'
  };

  let settings = M.withDefaults(null);

  async function load() {
    const stored = await chrome.storage.sync.get('settings');
    settings = M.withDefaults(stored.settings);
    renderAll();
  }

  async function save() {
    await chrome.storage.sync.set({ settings });
  }

  function el(tag, props, children) {
    const node = document.createElement(tag);
    Object.assign(node, props || {});
    for (const child of children || []) node.appendChild(child);
    return node;
  }

  function field(labelText, input) {
    return el('div', { className: 'field' }, [el('span', { textContent: labelText }), input]);
  }

  function lines(values) {
    return (values || []).join('\n');
  }

  function parseLines(text) {
    return text
      .split(/[\n,]/)
      .map((t) => t.trim())
      .filter(Boolean);
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
      host.appendChild(el('label', { className: 'row' }, [box, el('span', { textContent: SCOPE_LABELS[key] })]));
    }
  }

  function renderBehaviour() {
    $('coverStyle').value = settings.coverStyle;
    $('revealMinutes').value = settings.revealMinutes;
  }

  function renderPack(pack) {
    const enabled = el('input', { type: 'checkbox', checked: pack.enabled !== false });
    enabled.addEventListener('change', () => {
      pack.enabled = enabled.checked;
      save();
    });

    const head = el('div', { className: 'card-head' }, [
      el('label', { className: 'row' }, [enabled, el('span', { className: 'card-title', textContent: pack.name })]),
      el('span', {
        className: 'pill',
        textContent:
          pack.terms.length + ' words \u00b7 ' + pack.channels.length + ' channels'
      })
    ]);

    const label = el('input', { type: 'text', value: pack.label });
    label.addEventListener('change', () => {
      pack.label = label.value;
      save();
    });

    const terms = el('textarea', { value: lines(pack.terms) });
    terms.addEventListener('change', () => {
      pack.terms = parseLines(terms.value);
      save();
      renderPacks();
    });

    const channels = el('textarea', { value: lines(pack.channels) });
    channels.addEventListener('change', () => {
      pack.channels = parseLines(channels.value);
      save();
      renderPacks();
    });

    const except = el('textarea', { value: lines(pack.except) });
    except.addEventListener('change', () => {
      pack.except = parseLines(except.value);
      save();
    });

    const expires = el('input', {
      type: 'date',
      value: pack.expiresAt ? new Date(pack.expiresAt).toISOString().slice(0, 10) : ''
    });
    expires.addEventListener('change', () => {
      pack.expiresAt = expires.value ? new Date(expires.value + 'T23:59:59').getTime() : 0;
      save();
    });

    const remove = el('button', { className: 'danger', textContent: 'Delete pack' });
    remove.addEventListener('click', () => {
      settings.packs = settings.packs.filter((p) => p !== pack);
      save();
      renderPacks();
    });

    const exportOne = el('button', { textContent: 'Export' });
    exportOne.addEventListener('click', () => download(pack.name, pack));

    return el('div', { className: 'card' }, [
      head,
      field('Text shown on the cover', label),
      field('Words and phrases to hide (one per line)', terms),
      field('Channels to hide (name or @handle, one per line)', channels),
      field('Never hide when the title contains (one per line)', except),
      field('Switch this pack off automatically after', expires),
      el('div', { className: 'actions' }, [exportOne, remove])
    ]);
  }

  function renderPacks() {
    const host = $('packs');
    host.textContent = '';
    if (!settings.packs.length) {
      host.appendChild(el('p', { className: 'hint', textContent: 'No packs yet — add one below.' }));
      return;
    }
    for (const pack of settings.packs) host.appendChild(renderPack(pack));
  }

  async function renderCatalog() {
    const host = $('catalog');
    host.textContent = '';
    let catalog;
    try {
      const response = await fetch(chrome.runtime.getURL('packs/index.json'));
      catalog = await response.json();
    } catch (err) {
      host.appendChild(el('p', { className: 'hint', textContent: 'Catalog unavailable.' }));
      return;
    }
    for (const entry of catalog.packs || []) {
      const installed = settings.packs.some((p) => p.id === entry.id);
      const add = el('button', {
        className: installed ? '' : 'primary',
        textContent: installed ? 'Already added' : 'Add',
        disabled: installed
      });
      add.addEventListener('click', async () => {
        const response = await fetch(chrome.runtime.getURL(entry.file));
        const pack = M.sanitizePack(await response.json());
        pack.enabled = true;
        settings.packs.push(pack);
        await save();
        renderPacks();
        renderCatalog();
      });
      host.appendChild(
        el('div', { className: 'card' }, [
          el('div', { className: 'card-head' }, [
            el('span', { className: 'card-title', textContent: entry.name }),
            add
          ]),
          el('p', { className: 'hint', textContent: entry.description || '' })
        ])
      );
    }
  }

  function renderAllowed() {
    $('allowCount').textContent =
      settings.allowedVideos.length + ' video(s) marked "always allow".';
  }

  function renderAll() {
    renderScope();
    renderBehaviour();
    renderPacks();
    renderCatalog();
    renderAllowed();
  }

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
      const response = await fetch(text);
      data = await response.json();
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
  $('newPack').addEventListener('click', async () => {
    settings.packs.push(M.sanitizePack({ name: 'New pack', enabled: false }));
    await save();
    renderPacks();
  });
  $('importBtn').addEventListener('click', async () => {
    try {
      const added = await importPayload($('importText').value);
      $('importStatus').textContent = 'Imported ' + added + ' pack(s).';
      $('importText').value = '';
    } catch (err) {
      $('importStatus').textContent = 'Could not import: ' + err.message;
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
