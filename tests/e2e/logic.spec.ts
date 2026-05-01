import { test, expect, chromium, type BrowserContext, type Worker } from '@playwright/test';
import path from 'path';

test.describe('Tab Subgroups Logic', () => {
  let context: BrowserContext;
  let worker: Worker;

  test.beforeAll(async () => {
    const pathToExtension = path.resolve(__dirname, '../../');
    context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
      ],
    });

    worker = context.serviceWorkers()[0];
    if (!worker) {
        worker = await context.waitForEvent('serviceworker');
    }
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('should create a subgroup relationship', async () => {
    await worker.evaluate(async () => {
      await chrome.storage.local.clear();
      const [t1] = await chrome.tabs.query({ active: true });
      const t2 = await chrome.tabs.create({ url: 'https://google.com' });
      await new Promise(r => setTimeout(r, 500));
      const pId = await chrome.tabs.group({ tabIds: [t1.id, t2.id] });
      await chrome.tabGroups.update(pId, { title: 'Parent' });
      await new Promise(r => setTimeout(r, 1000));
      await chrome.tabs.group({ tabIds: [t1.id] });
    });

    await new Promise(resolve => setTimeout(resolve, 3000));
    const storage = await worker.evaluate(async () => await chrome.storage.local.get(["subGroupArray"]));
    expect(storage.subGroupArray.length).toBeGreaterThan(0);
    expect(storage.subGroupArray[0].name).toBe('Parent');
  });

  test('should recursively collapse child groups', async () => {
    await worker.evaluate(async () => {
      await chrome.storage.local.clear();
      const t1 = await chrome.tabs.create({ url: 'https://a.com' });
      const t2 = await chrome.tabs.create({ url: 'https://b.com' });
      const pId = await chrome.tabs.group({ tabIds: [t1.id, t2.id] });
      await chrome.tabGroups.update(pId, { title: 'Level1' });
      await new Promise(r => setTimeout(r, 1000));
      await chrome.tabs.group({ tabIds: [t1.id] });
      await new Promise(r => setTimeout(r, 1000));
      await chrome.tabGroups.update(pId, { collapsed: true });
    });

    await new Promise(resolve => setTimeout(resolve, 5000));
    const storage = await worker.evaluate(async () => await chrome.storage.local.get(["subGroupArray"]));
    const child = storage.subGroupArray.find(s => s.name === 'Level1');
    expect(child.isCollapsed).toBe(true);
  });

  test('should recursively expand child groups', async () => {
    await worker.evaluate(async () => {
      await chrome.storage.local.clear();
      const t1 = await chrome.tabs.create({ url: 'https://1.com' });
      const t2 = await chrome.tabs.create({ url: 'https://2.com' });
      const pId = await chrome.tabs.group({ tabIds: [t1.id, t2.id] });
      await chrome.tabGroups.update(pId, { title: 'ExpandTest' });
      await new Promise(r => setTimeout(r, 1000));
      await chrome.tabs.group({ tabIds: [t1.id] });
      await new Promise(r => setTimeout(r, 1000));
      await chrome.tabGroups.update(pId, { collapsed: true });
      await new Promise(r => setTimeout(r, 2000));
      await chrome.tabGroups.update(pId, { collapsed: false });
    });

    await new Promise(resolve => setTimeout(resolve, 5000));
    const groups = await worker.evaluate(async () => {
        const grps = await chrome.tabGroups.query({});
        return grps.map(g => ({ title: g.title, collapsed: g.collapsed }));
    });
    expect(groups).toContainEqual(expect.objectContaining({ title: 'ExpandTest-1', collapsed: true }));
  });

  test('should move subgroups when the parent group is moved', async () => {
    await worker.evaluate(async () => {
      await chrome.storage.local.clear();
      const t1 = await chrome.tabs.create({ url: 'https://p.com' });
      const t2 = await chrome.tabs.create({ url: 'https://c.com' });
      const pId = await chrome.tabs.group({ tabIds: [t1.id, t2.id] });
      await chrome.tabGroups.update(pId, { title: 'MoveP' });
      await new Promise(r => setTimeout(r, 1000));
      await chrome.tabs.group({ tabIds: [t2.id] });
      await new Promise(r => setTimeout(r, 2000));
      await chrome.tabGroups.move(pId, { index: 0 });
    });

    await new Promise(resolve => setTimeout(resolve, 5000));
    const finalPositions = await worker.evaluate(async () => {
        const tabs = await chrome.tabs.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
        return tabs.map(t => ({ url: t.url, index: t.index }));
    });
    const pTab = finalPositions.find(t => t.url.includes('p.com'));
    const cTab = finalPositions.find(t => t.url.includes('c.com'));
    expect(cTab.index).toBeGreaterThan(pTab.index);
  });

  test('should inherit color', async () => {
    await worker.evaluate(async () => {
      await chrome.storage.local.clear();
      const t1 = await chrome.tabs.create({ url: 'https://color-p.com' });
      const t2 = await chrome.tabs.create({ url: 'https://color-c.com' });
      const pId = await chrome.tabs.group({ tabIds: [t1.id, t2.id] });
      await chrome.tabGroups.update(pId, { title: 'ColorP', color: 'blue' });
      await new Promise(r => setTimeout(r, 1000));
      await chrome.tabs.group({ tabIds: [t2.id] });
      await new Promise(r => setTimeout(r, 2000));
      await chrome.tabGroups.update(pId, { color: 'red' });
    });

    await new Promise(resolve => setTimeout(resolve, 5000));
    const colors = await worker.evaluate(async () => {
        const grps = await chrome.tabGroups.query({});
        return grps.map(g => ({ title: g.title, color: g.color }));
    });
    const child = colors.find(g => g.title === 'ColorP-1');
    expect(child.color).toBe('red');
  });
});
