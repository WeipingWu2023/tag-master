const STOP = new Set(('a an the and or but for with without to in on of at by from as is are was be been it its this that your you my our how why what when where using use used guide tutorial tutorials video videos youtube watch learn learning get getting start started best new complete ultimate introduction beginners beginner tips tricks part episode official channel subscribe 的 了 和 是 在 如何 使用 教程 一个').split(' '));
const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
STOP.delete('learning');

export function canonicalUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http and https pages can be saved.');
  if (url.hostname === 'youtu.be') { url.hostname = 'www.youtube.com'; url.searchParams.set('v', url.pathname.slice(1)); url.pathname = '/watch'; }
  if (/(^|\.)youtube\.com$/.test(url.hostname) && url.pathname === '/watch') {
    const video = url.searchParams.get('v');
    url.search = ''; if (video) url.searchParams.set('v', video);
  }
  for (const key of [...url.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/.test(key)) url.searchParams.delete(key);
  return url.href;
}

export function cleanEntry(raw) {
  if (!raw || typeof raw.url !== 'string') throw new Error('Invalid saved page.');
  const url = canonicalUrl(raw.url);
  return {
    id: url, url,
    title: String(raw.title || new URL(url).hostname).slice(0, 500),
    description: String(raw.description || '').slice(0, 1600),
    text: String(raw.text || '').slice(0, 3000),
    savedAt: Number.isFinite(raw.savedAt) && raw.savedAt > 0 ? raw.savedAt : Date.now(),
    pinned: raw.pinned === true
  };
}

function terms(text) {
  return [...segmenter.segment(text)].filter(s => s.isWordLike).map(s => s.segment).filter(w => w.length > 1 && !STOP.has(w.toLowerCase()) && !/^\d+$/.test(w));
}

function topicTerms(text) {
  const words = terms(text);
  const phrases = [];
  for (let i = 0; i < words.length - 1; i++) {
    if (/^[a-z]+$/i.test(words[i]) && /^[a-z]+$/i.test(words[i + 1])) phrases.push(`${words[i]} ${words[i + 1]}`);
  }
  return [...words, ...phrases];
}

// ponytail: lexical topic discovery is offline and explainable; semantic synonyms need an embedding model.
export function groupEntries(entries) {
  const docs = entries.map(entry => {
    const weights = new Map();
    const titleTerms = new Set(topicTerms(entry.title).map(word => word.toLowerCase()));
    for (const [text, weight] of [[entry.title, 4], [entry.description, 0.2]]) {
      for (const word of new Set(topicTerms(text))) {
        const key = word.toLowerCase();
        const old = weights.get(key);
        weights.set(key, { label: old?.label || word, weight: (old?.weight || 0) + weight });
      }
    }
    return { entry, weights, titleTerms };
  });
  const frequency = new Map();
  for (const doc of docs) for (const key of doc.titleTerms) frequency.set(key, (frequency.get(key) || 0) + 1);
  const groups = new Map();
  for (const doc of docs) {
    let best, score = 0;
    for (const [key, value] of doc.weights) {
      const count = frequency.get(key);
      if (!count || count < 2 || !doc.titleTerms.has(key)) continue;
      const distinctive = /[a-z][A-Z]|[A-Z].*[A-Z]/.test(value.label) ? 1.35 : /^[A-Z]/.test(value.label) ? 1.15 : 1;
      const candidate = count * value.weight * distinctive * (key.includes(' ') ? 1.2 : 1);
      if (candidate > score) { best = { key, label: value.label }; score = candidate; }
    }
    if (!best) {
      const first = terms(doc.entry.title)[0];
      const label = first || new URL(doc.entry.url).hostname.replace(/^www\./, '');
      best = { key: label.toLowerCase(), label };
    }
    if (!groups.has(best.key)) groups.set(best.key, { id: best.key, label: best.label[0].toUpperCase() + best.label.slice(1), entries: [] });
    groups.get(best.key).entries.push(doc.entry);
  }
  return [...groups.values()].sort((a, b) => b.entries.length - a.entries.length || a.label.localeCompare(b.label));
}

export function parseBackup(text) {
  const data = JSON.parse(text);
  if (data?.version !== 1 || !Array.isArray(data.entries) || data.entries.length > 20000) throw new Error('Choose a Tag Master backup (up to 20,000 links).');
  return data.entries.map(cleanEntry);
}
