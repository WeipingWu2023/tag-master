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
  const storage = await worker.evaluate(() => chrome.storage.local.get(null));
  assert.equal(Object.keys(storage).filter(k => k.startsWith('page:')).length, 2);
  await library.bringToFront();
  await library.locator('.pin').first().click();
  await library.locator('.favorite').waitFor();
  await library.locator('.delete').first().click();
  await library.getByRole('button', { name: 'Undo', exact: true }).click();
  await library.waitForFunction(() => document.querySelectorAll('.page-link').length === 2);
  await context.close();
  context = await chromium.launchPersistentContext(profile, options);
  const restartCdp = await context.browser().newBrowserCDPSession();
  await restartCdp.send('Extensions.loadUnpacked', { path: resolve('.') });
  const reopened = await context.newPage();
  await reopened.goto(`chrome-extension://${id}/library.html`);
  await reopened.waitForFunction(() => document.querySelectorAll('.page-link').length === 2);
  assert.equal(await reopened.locator('.page-link').count(), 2, 'survives browser restart');
  assert.equal(await reopened.locator('.favorite').count(), 1, 'pin survives restart and undo');
  console.log('PASS: two pre-existing Chrome windows, Ctrl+Alt+P, embedded frame focus, correct source tab, duplicate handling, pin, delete/undo, browser restart persistence.');
} finally { await context?.close(); }
