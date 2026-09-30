(function () {
  'use strict';

  const M = self.SGMatcher;
  const $ = (id) => document.getElementById(id);

  let settings = M.withDefaults(null);

  async function load() {
    settings = M.withDefaults(await M.readSettings());
    render();
  }

  async function save() {
    await M.writeSettings(settings);
    render();
  }

  function statusText() {
    if (!settings.enabled) return 'Off. Nothing is hidden.';
    if (settings.snoozeUntil > Date.now()) {
      const minutes = Math.ceil((settings.snoozeUntil - Date.now()) / 60000);
      return 'Taking a break for ' + minutes + ' more minute' + (minutes === 1 ? '' : 's') + '.';
    }
    const active = M.activePacks(settings).length;
    return active
      ? 'Hiding ' + active + (active === 1 ? ' thing' : ' things') + ' on YouTube.'
      : 'No list is on yet, so nothing is hidden.';
  }

  function render() {
    $('status').textContent = statusText();
    $('enabled').checked = settings.enabled;
    $('scopeSearch').checked = settings.scope.search !== false;

    const list = $('packs');
    list.textContent = '';
    if (!settings.packs.length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'No lists yet. Open settings to pick one.';
      list.appendChild(empty);
      return;
    }

    for (const pack of settings.packs) {
      const row = document.createElement('label');
      row.className = 'row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = pack.enabled !== false;
      box.addEventListener('change', () => {
        pack.enabled = box.checked;
        save();
      });
      const text = document.createElement('span');
      text.textContent = pack.name;
      row.appendChild(box);
      row.appendChild(text);
      list.appendChild(row);
    }
  }

  function snooze(minutes) {
    settings.snoozeUntil = Date.now() + minutes * 60000;
    save();
  }

  $('enabled').addEventListener('change', (event) => {
    settings.enabled = event.target.checked;
    save();
  });
  $('scopeSearch').addEventListener('change', (event) => {
    settings.scope.search = event.target.checked;
    save();
  });
  $('snooze15').addEventListener('click', () => snooze(15));
  $('snooze60').addEventListener('click', () => snooze(60));
  $('unsnooze').addEventListener('click', () => {
    settings.snoozeUntil = 0;
    save();
  });
  $('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());

  $('quickAdd').addEventListener('click', () => {
    const raw = $('quick').value.trim();
    if (!raw) return;
    const terms = raw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    let pack = settings.packs.find((p) => p.id === 'my-blocks');
    if (!pack) {
      pack = M.sanitizePack({ id: 'my-blocks', name: 'My words', label: 'You asked to hide this' });
      settings.packs.unshift(pack);
    }
    for (const term of terms) if (!pack.terms.includes(term)) pack.terms.push(term);
    pack.enabled = true;
    $('quick').value = '';
    save();
  });

  load();
})();
