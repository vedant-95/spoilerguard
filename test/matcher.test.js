const assert = require('node:assert');
const test = require('node:test');
const M = require('../src/matcher.js');

const gow = M.sanitizePack({
  id: 'gow',
  name: 'God of War',
  terms: ['god of war', 'gow', 'kratos', 'ragnarok'],
  channels: ['@SpoilerChannel', 'Gaming Leaks'],
  except: ['thor ragnarok']
});

const settings = M.withDefaults({ packs: [gow] });

test('hides an obvious title', () => {
  const verdict = M.evaluate({ title: 'God of War Ragnarok ENDING explained' }, settings);
  assert.equal(verdict.blocked, true);
  assert.equal(verdict.label, 'God of War related content');
});

test('hides a title that only names a character', () => {
  assert.equal(M.evaluate({ title: 'Kratos vs the Valkyrie Queen' }, settings).blocked, true);
});

test('does not hide unrelated words that merely contain a term', () => {
  assert.equal(M.evaluate({ title: 'Warframe build guide' }, settings).blocked, false);
  assert.equal(M.evaluate({ title: 'Glasgow street food tour' }, settings).blocked, false);
});

test('exception terms win over matches', () => {
  assert.equal(M.evaluate({ title: 'Thor Ragnarok is still great' }, settings).blocked, false);
});

test('matches channels by name and handle', () => {
  assert.equal(M.evaluate({ title: 'Random clip', channel: 'Gaming Leaks' }, settings).blocked, true);
  assert.equal(M.evaluate({ title: 'Random clip', handle: '@SpoilerChannel' }, settings).blocked, true);
});

test('respects the global switch and snooze', () => {
  const off = M.withDefaults({ packs: [gow], enabled: false });
  assert.equal(M.evaluate({ title: 'Kratos' }, off).blocked, false);
  const snoozed = M.withDefaults({ packs: [gow], snoozeUntil: Date.now() + 60000 });
  assert.equal(M.evaluate({ title: 'Kratos' }, snoozed).blocked, false);
});

test('expired packs stop matching', () => {
  const expired = M.withDefaults({
    packs: [M.sanitizePack({ name: 'Old', terms: ['kratos'], expiresAt: Date.now() - 1000 })]
  });
  assert.equal(M.evaluate({ title: 'Kratos returns' }, expired).blocked, false);
});

test('ignores accents, punctuation and casing', () => {
  assert.equal(M.evaluate({ title: 'GOD-OF-WAR: Ragnarök!' }, settings).blocked, true);
});

test('allowed channels are never hidden', () => {
  const s = M.withDefaults({ packs: [gow], allowedChannels: ['Safe Channel'] });
  assert.equal(M.evaluate({ title: 'Kratos', channel: 'Safe Channel' }, s).blocked, false);
});

test('parses YouTube upload ages', () => {
  assert.equal(M.parseAgeDays('3 years ago'), 1095);
  assert.equal(M.parseAgeDays('2 days ago'), 2);
  assert.equal(M.parseAgeDays('Streamed 1 week ago'), 7);
  assert.equal(M.parseAgeDays('1.2M views'), null);
});

test('maxAgeDays keeps older uploads visible', () => {
  const s = M.withDefaults({
    packs: [M.sanitizePack({ name: 'Match spoilers', terms: ['arsenal'], maxAgeDays: 7 })]
  });
  assert.equal(M.evaluate({ title: 'Arsenal highlights', age: '2 days ago' }, s).blocked, true);
  assert.equal(M.evaluate({ title: 'Arsenal highlights', age: '3 years ago' }, s).blocked, false);
  assert.equal(M.evaluate({ title: 'Arsenal highlights' }, s).blocked, true);
});

test('sanitizePack fills in AI defaults', () => {
  const pack = M.sanitizePack({ name: 'X' });
  assert.deepEqual(pack.ai, { enabled: false, topics: [], threshold: 0.35 });
  const configured = M.sanitizePack({ name: 'X', ai: { enabled: true, topics: ['god of war'] } });
  assert.equal(configured.ai.enabled, true);
  assert.deepEqual(configured.ai.topics, ['god of war']);
});

test('broken user regex does not throw', () => {
  const s = M.withDefaults({ packs: [M.sanitizePack({ name: 'Bad', regex: ['([a-z'] })] });
  assert.equal(M.evaluate({ title: 'anything' }, s).blocked, false);
});
