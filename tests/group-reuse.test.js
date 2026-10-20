import test from 'node:test';
import assert from 'node:assert/strict';

test('toolbar clicks in different windows reuse one Tag Master group', async () => {
  const url = 'chrome-extension://test/library.html';
  const tabs = [{ id: 1, windowId: 1, url: 'https://example.com', groupId: -1 }, { id: 2, windowId: 2, url: 'https://example.org', groupId: -1 }];
  const groups = new Map();
  let clicked;
  let focusedWindow;
  const addListener = () => {};
  globalThis.chrome = {
    runtime: { id: 'test', getURL: path => `chrome-extension://test/${path}`, onMessage: { addListener }, onInstalled: { addListener }, onStartup: { addListener } },
    storage: { local: { setAccessLevel: async () => {} } },
    tabs: {
      query: async () => tabs,
      create: async details => { const tab = { id: tabs.length + 1, groupId: -1, ...details }; tabs.push(tab); return tab; },
      group: async ({ tabIds }) => { const id = groups.size + 1; groups.set(id, {}); tabs.find(tab => tab.id === tabIds).groupId = id; return id; },
      update: async (id, details) => Object.assign(tabs.find(tab => tab.id === id), details),
      onUpdated: { addListener }
    },
    tabGroups: { update: async (id, details) => Object.assign(groups.get(id), details) },
    windows: { getLastFocused: async () => ({ id: 1 }), update: async id => { focusedWindow = id; } },
    action: { onClicked: { addListener: listener => { clicked = listener; } } },
    commands: { onCommand: { addListener } }
  };
  try {
    await import('../background.js');
    await Promise.all([clicked({ windowId: 1 }), clicked({ windowId: 2 })]);
    const library = tabs.find(tab => tab.url === url);
    library.url += '?demo=1';
    await clicked({ windowId: 2 });
    assert.equal(groups.size, 1);
    assert.equal(tabs.filter(tab => tab.url === url).length, 1);
    assert.equal(library.groupId, 1);
    assert.equal(focusedWindow, 1);
  } finally { delete globalThis.chrome; }
});
