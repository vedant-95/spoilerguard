/**
 * Offscreen document that runs the on-device sentence embedding model.
 *
 * The model (all-MiniLM-L6-v2, quantized) is bundled with the extension and
 * runs through onnxruntime-web, so titles never leave the browser. It scores
 * how close a video title is in meaning to a pack's topics, which catches
 * spoilers that avoid every keyword ("HE FINALLY MEETS HIS SON").
 */
import { pipeline, env } from './vendor/transformers.min.js';

env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = chrome.runtime.getURL('models/');
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('src/vendor/');
env.backends.onnx.wasm.numThreads = 1;

const MODEL = 'all-MiniLM-L6-v2';

let extractorPromise = null;
const topicCache = new Map();
const titleCache = new Map();

function extractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', MODEL, { dtype: 'q8' });
  }
  return extractorPromise;
}

async function embed(text) {
  const pipe = await extractor();
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

async function embedTitle(title) {
  if (titleCache.has(title)) return titleCache.get(title);
  const vector = await embed(title);
  if (titleCache.size > 500) titleCache.clear();
  titleCache.set(title, vector);
  return vector;
}

async function embedTopic(topic) {
  if (topicCache.has(topic)) return topicCache.get(topic);
  const vector = await embed(topic);
  topicCache.set(topic, vector);
  return vector;
}

function cosine(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

/** A pack with no topics still needs something to compare against. */
function defaultTopic(pack) {
  return [pack.name].concat((pack.terms || []).slice(0, 8)).join(', ');
}

function aiPacks(settings) {
  const now = Date.now();
  return (settings.packs || []).filter(
    (pack) =>
      pack.enabled !== false &&
      (!pack.expiresAt || pack.expiresAt > now) &&
      pack.ai &&
      pack.ai.enabled
  );
}

async function classify(items) {
  const { settings } = await chrome.storage.sync.get('settings');
  const packs = aiPacks(settings || {});
  if (!packs.length) return [];

  const topicVectors = [];
  for (const pack of packs) {
    const topics = pack.ai.topics.length ? pack.ai.topics : [defaultTopic(pack)];
    for (const topic of topics) {
      topicVectors.push({ pack, topic, vector: await embedTopic(topic) });
    }
  }

  const results = [];
  for (const item of items) {
    if (!item || !item.title) continue;
    const titleVector = await embedTitle(item.title);
    let best = null;
    for (const entry of topicVectors) {
      const score = cosine(titleVector, entry.vector);
      if (score < entry.pack.ai.threshold) continue;
      if (!best || score > best.score) best = { entry, score };
    }
    if (best) {
      results.push({
        id: item.id,
        packId: best.entry.pack.id,
        label: best.entry.pack.label || best.entry.pack.name,
        reason: 'AI: close to "' + best.entry.topic + '" (' + best.score.toFixed(2) + ')'
      });
    }
  }
  return results;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.target !== 'sg-offscreen') return undefined;

  if (message.type === 'sg:ai-classify') {
    classify(message.items)
      .then((results) => sendResponse({ ok: true, results }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === 'sg:ai-warmup') {
    embedTopic('warmup')
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  return undefined;
});
