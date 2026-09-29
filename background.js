import { cleanEntry, cleanTopic, parseBackup } from './core.js';

let queue = Promise.resolve();
function serialize(task) { const result = queue.then(task); queue = result.catch(() => {}); return result; }
const key = id => `page:${id}`;
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

async function save(raw) {
  const entry = cleanEntry(raw);
  const previous = (await chrome.storage.local.get(key(entry.id)))[key(entry.id)];
  if (previous) { entry.savedAt = previous.savedAt; entry.pinned = previous.pinned; entry.topic = previous.topic || ''; }
  await chrome.storage.local.set({ [key(entry.id)]: entry });
  return { ok: true, duplicate: !!previous };
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const trusted = sender.url === chrome.runtime.getURL('library.html') || sender.url?.startsWith(chrome.runtime.getURL('library.html') + '?');
  if (sender.id !== chrome.runtime.id) return;
  serialize(async () => {
    if (message.type === 'capture-current' && sender.tab?.id) {
      // Bind to the requesting tab, even when another window owns the library.
      return captureTab(sender.tab.id);
    }
    if (!trusted) throw new Error('This action is only available in your library.');
    if (message.type === 'save') return save(message.page);
    if (message.type === 'delete') { await chrome.storage.local.remove(key(message.id)); return { ok: true }; }
    if (message.type === 'pin') {
      const entry = (await chrome.storage.local.get(key(message.id)))[key(message.id)];
      if (entry) await chrome.storage.local.set({ [key(entry.id)]: { ...entry, pinned: !entry.pinned } });
      return { ok: true };
    }
    if (message.type === 'create-topic') {
      const label = cleanTopic(message.topic);
      const { topics = [] } = await chrome.storage.local.get('topics');
      if (topics.some(topic => topic.toLowerCase() === label.toLowerCase())) throw new Error('That topic already exists.');
      await chrome.storage.local.set({ topics: [...topics, label] });
      return { ok: true };
    }
    if (message.type === 'set-topic') {
      const label = cleanTopic(message.topic);
      const entry = (await chrome.storage.local.get(key(message.id)))[key(message.id)];
      if (!entry) throw new Error('This link is no longer in your library.');
      const { topics = [] } = await chrome.storage.local.get('topics');
      await chrome.storage.local.set({
        [key(entry.id)]: { ...entry, topic: label },
        topics: topics.some(topic => topic.toLowerCase() === label.toLowerCase()) ? topics : [...topics, label]
      });
      return { ok: true };
    }
    if (message.type === 'rename-topic') {
      const label = cleanTopic(message.topic);
      if (!Array.isArray(message.ids) || message.ids.length > 20000) throw new Error('Could not rename this topic.');
      const ids = message.ids.filter(id => typeof id === 'string');
      const stored = await chrome.storage.local.get([...ids.map(key), 'topics']);
      const updates = Object.fromEntries(ids.filter(id => stored[key(id)]).map(id => [key(id), { ...stored[key(id)], topic: label }]));
      const topics = (stored.topics || []).filter(topic => topic.toLowerCase() !== String(message.oldTopic).toLowerCase());
      if (!topics.some(topic => topic.toLowerCase() === label.toLowerCase())) topics.push(label);
      await chrome.storage.local.set({ ...updates, topics });
      return { ok: true };
    }
    if (message.type === 'import') {
      const { entries, topics } = parseBackup(message.text);
      const existing = await chrome.storage.local.get(null);
      const additions = Object.fromEntries(entries.filter(e => !existing[key(e.id)]).map(e => [key(e.id), e]));
      const mergedTopics = [...(existing.topics || [])];
      for (const topic of topics) if (!mergedTopics.some(value => value.toLowerCase() === topic.toLowerCase())) mergedTopics.push(topic);
      await chrome.storage.local.set({ ...additions, topics: mergedTopics });
      return { ok: true, count: Object.keys(additions).length };
    }
    throw new Error('Unknown action.');
  }).then(reply, error => reply({ ok: false, error: error.message }));
  return true;
});

async function captureTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!/^https?:/.test(tab.url || '')) throw new Error('Open a website to save it.');
  const [{ result: page }] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    func: () => {
      const meta = name => document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.content || '';
      return {
        url: location.href,
        title: document.querySelector('ytd-watch-metadata h1')?.textContent?.trim() || document.title,
        description: meta('description') || meta('og:description'),
        text: (document.querySelector('article, main, [role="main"]')?.innerText || '').slice(0, 3000)
      };
    }
  });
  const result = await save(page);
  await chrome.action.setBadgeText({ text: '', tabId });
  await chrome.action.setTitle({ title: 'Open Tag Master', tabId });
  return result;
}

async function enableExistingTabs() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  // Restricted pages and discarded tabs may reject injection. New loads get the manifest script.
  await Promise.allSettled(tabs.filter(tab => !tab.discarded).map(tab =>
    chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['capture.js'] })
  ));
}
chrome.runtime.onInstalled.addListener(enableExistingTabs);
chrome.runtime.onStartup.addListener(enableExistingTabs);

chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('library.html');
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find(tab => tab.url === url);
  if (existing) { await chrome.tabs.update(existing.id, { active: true }); await chrome.windows.update(existing.windowId, { focused: true }); }
  else await chrome.tabs.create({ url });
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'save-page') return;
  try {
    if (!tab?.id) [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) throw new Error('Open a website to save it.');
    const result = await serialize(() => captureTab(tab.id));
    // A missing listener must not turn a successful save into an error.
    await chrome.tabs.sendMessage(tab.id, { type: 'capture-feedback', ...result }, { frameId: 0 }).catch(() => {});
  } catch (error) {
    await chrome.action.setBadgeText({ text: '!', tabId: tab?.id });
    await chrome.action.setTitle({ title: error.message, tabId: tab?.id });
  }
});
