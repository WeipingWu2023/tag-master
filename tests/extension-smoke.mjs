// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright index.mjs.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const profile = await mkdtemp(join(tmpdir(), 'tag-master-test-'));
const options = {
  headless: true,
  ignoreDefaultArgs: ['--disable-extensions'],
  ...(process.env.CHROME_BINARY ? { executablePath: process.env.CHROME_BINARY } : { channel: 'chromium' }),
  args: ['--enable-unsafe-extension-debugging'],
};
let context;
try {
  context = await chromium.launchPersistentContext(profile, options);
  const cdp = await context.browser().newBrowserCDPSession();
  const firstUrl = 'http://127.0.0.1:4173/tests/capture-fixture.html?window=one';
  const secondUrl = 'http://127.0.0.1:4173/tests/capture-fixture.html?window=two';
  // Both windows predate installation, so this exercises onInstalled backfilling.
  const page = await context.newPage();
  await page.goto(firstUrl);
  const secondPageEvent = context.waitForEvent('page');
  await cdp.send('Target.createTarget', { url: secondUrl, newWindow: true });
  const secondPage = await secondPageEvent;
  await secondPage.waitForLoadState();
  const firstSession = await context.newCDPSession(page);
  const secondSession = await context.newCDPSession(secondPage);
  const firstWindow = await firstSession.send('Browser.getWindowForTarget');
  const secondWindow = await secondSession.send('Browser.getWindowForTarget');
  assert.notEqual(firstWindow.windowId, secondWindow.windowId, 'two actual Chrome windows');
  await cdp.send('Extensions.loadUnpacked', { path: resolve('.') });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(worker.url()).host;
  await worker.evaluate(async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1:4173/tests/*' });
      const ready = await Promise.all(tabs.map(async tab => {
        const frames = await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},func:()=>globalThis.__tagMasterCaptureVersion});
        return frames.length === 2 && frames.every(f=>f.result==='1.1.0');
      }));
      if (ready.length === 2 && ready.every(Boolean)) return;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw new Error('Existing windows did not receive the shortcut listener.');
  });
  await page.bringToFront();
  await page.keyboard.press('Control+Alt+p');
  await page.waitForFunction(() => !!document.getElementById('tag-master-notice'));
  const library = await context.newPage();
  await library.goto(`chrome-extension://${id}/library.html`);
  await library.locator('.page-link').waitFor();
  assert.equal(await library.locator('.page-link').count(), 1);
  assert.equal(await library.locator('.page-link').getAttribute('href'), firstUrl);
  await secondPage.bringToFront();
  await secondPage.frameLocator('iframe').getByRole('textbox').click();
  await secondPage.keyboard.press('Control+Alt+p');
  await library.waitForFunction(() => document.querySelectorAll('.page-link').length === 2);
  const savedUrls = await library.locator('.page-link').evaluateAll(links=>links.map(a=>a.href));
  assert.deepEqual(savedUrls.sort(), [firstUrl,secondUrl].sort(), 'frame focus saves its containing tab in the correct window');
  const existingWindowIds = await worker.evaluate(async()=> (await chrome.tabs.query({url:'http://127.0.0.1:4173/tests/*'})).map(t=>t.windowId));
  assert.equal(new Set(existingWindowIds).size, 2);
  await page.bringToFront();
  await page.keyboard.press('Control+Alt+p');
  await library.waitForTimeout(350);
  assert.equal(await library.locator('.page-link').count(), 2, 'duplicate capture');
  const dragUrl = 'http://127.0.0.1:4173/tests/capture-fixture.html?window=drag';
  const draggedPage = await context.newPage();
  await draggedPage.goto(dragUrl);
  const draggedTabClosed = draggedPage.waitForEvent('close');
  const groupId = await worker.evaluate(async ({ dragUrl, id }) => {
    const tabs = await chrome.tabs.query({});
    const source = tabs.find(tab => tab.url === dragUrl);
    const anchor = tabs.find(tab => tab.url === `chrome-extension://${id}/library.html`);
    if (!source || !anchor) throw new Error(`Missing group test tabs: ${JSON.stringify(tabs.map(tab => tab.url))}`);
    const groupId = await chrome.tabs.group({ tabIds: anchor.id });
    await chrome.tabGroups.update(groupId, { title: 'Tag Master', color: 'yellow' });
    await chrome.tabs.group({ tabIds: source.id, groupId });
    return groupId;
  }, { dragUrl, id });
  await draggedTabClosed;
  await library.waitForFunction(url => [...document.querySelectorAll('.page-link')].some(link => link.href === url), dragUrl);
  assert.equal((await worker.evaluate(id => chrome.tabGroups.get(id), groupId)).title, 'Tag Master');
  const storage = await worker.evaluate(() => chrome.storage.local.get(null));
  assert.equal(Object.keys(storage).filter(k => k.startsWith('page:')).length, 3, 'dragged tab was stored before closing');
  await library.bringToFront();
  await library.locator('.pin').first().click();
  await library.locator('.favorite').waitFor();
  await library.locator('.delete').first().click();
  await library.getByRole('button', { name: 'Undo', exact: true }).click();
  await library.waitForFunction(() => document.querySelectorAll('.page-link').length === 3);
  await context.close();
  context = await chromium.launchPersistentContext(profile, options);
  const restartCdp = await context.browser().newBrowserCDPSession();
  await restartCdp.send('Extensions.loadUnpacked', { path: resolve('.') });
  const reopened = await context.newPage();
  await reopened.goto(`chrome-extension://${id}/library.html`);
  await reopened.waitForFunction(() => document.querySelectorAll('.page-link').length === 3);
  assert.equal(await reopened.locator('.page-link').count(), 3, 'survives browser restart');
  assert.equal(await reopened.locator('.favorite').count(), 1, 'pin survives restart and undo');
  console.log('PASS: two Chrome windows, shortcut capture, native tab-group capture and close, duplicate handling, pin, delete/undo, browser restart persistence.');
} finally { await context?.close(); }
