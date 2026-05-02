import { test, expect, chromium, type BrowserContext, type Worker } from '@playwright/test';
import path from 'path';

test.describe('Bug Reproduction: Move & Persistence', () => {
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
    
    // Pipe logs
    worker.on('console', msg => console.log(`WORKER: ${msg.text()}`));
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('subgroup should follow parent move and remain collapsible after reopen', async () => {
    await worker.evaluate(async () => {
      await chrome.storage.local.clear();
      
      const t1 = await chrome.tabs.create({ url: 'https://p1.com' });
      const t2 = await chrome.tabs.create({ url: 'https://p2.com' });
      const t3 = await chrome.tabs.create({ url: 'https://other.com' });
      
      // 1. Create Parent group
      const pId = await chrome.tabs.group({ tabIds: [t1.id, t2.id] });
      await chrome.tabGroups.update(pId, { title: 'Parent' });
      await new Promise(r => setTimeout(r, 2000)); // Allow refreshIds to catch it
      
      // 2. Create Subgroup from t1
      const cId = await chrome.tabs.group({ tabIds: [t1.id] });
      await new Promise(r => setTimeout(r, 2000));

      // 3. Collapse Parent (Subgroup should disappear)
      await chrome.tabGroups.update(pId, { collapsed: true });
      await new Promise(r => setTimeout(r, 2000));

      // 4. Move Parent to far right (index 2)
      await chrome.tabGroups.move(pId, { index: 2 });
      await new Promise(r => setTimeout(r, 1000));

      // 5. Expand Parent
      await chrome.tabGroups.update(pId, { collapsed: false });
      await new Promise(r => setTimeout(r, 3000));
    });

    const state = await worker.evaluate(async () => {
        const tabs = await chrome.tabs.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
        const groups = await chrome.tabGroups.query({});
        const storage = await chrome.storage.local.get(["subGroupArray"]);
        return {
            tabs: tabs.map(t => ({ url: t.url, index: t.index, groupId: t.groupId })),
            groups: groups.map(g => ({ id: g.id, title: g.title, collapsed: g.collapsed })),
            storage: storage.subGroupArray
        };
    });

    console.log("FINAL STATE:", JSON.stringify(state, null, 2));

    const pTab = state.tabs.find(t => t.url.includes('p2.com'));
    const cTab = state.tabs.find(t => t.url.includes('p1.com'));
    
    // Check Problem 1: Placement
    // Parent is at index 1 (t3 is index 0, Parent header is index 1, p2 is index 1, p1 should be index 2)
    // Wait, let's just check adjacency.
    expect(cTab.index).toBe(pTab.index + 1);

    // Check Problem 2: Relationship still works
    // Collapse Parent again
    await worker.evaluate(async () => {
        const groups = await chrome.tabGroups.query({});
        const pId = groups.find(g => g.title === 'Parent').id;
        await chrome.tabGroups.update(pId, { collapsed: true });
    });

    await new Promise(r => setTimeout(r, 3000));

    const finalTabs = await worker.evaluate(async () => {
        const tabs = await chrome.tabs.query({});
        return tabs.map(t => t.url);
    });

    // Subgroup tab (p1.com) should be gone
    expect(finalTabs).not.toContain('https://p1.com/');
  });

  test('subgroup should be created when tab is moved into group first', async () => {
    const result = await worker.evaluate(async () => {
      // @ts-ignore
      if (typeof subGroupArray !== 'undefined') subGroupArray = []; 
      await chrome.storage.local.clear();
      
      const t1 = await chrome.tabs.create({ url: 'https://p1.com' });
      const t2 = await chrome.tabs.create({ url: 'https://p2.com' });
      
      // 1. Create Parent group for t2
      const pId = await chrome.tabs.group({ tabIds: [t2.id] });
      await chrome.tabGroups.update(pId, { title: 'Parent' });
      await new Promise(r => setTimeout(r, 1000));
      
      // 2. Move t1 into Parent group
      await chrome.tabs.group({ tabIds: [t1.id], groupId: pId });
      await new Promise(r => setTimeout(r, 2000)); // Allow refreshIds to catch it
      
      // 3. Create a new group from t1 (should become subgroup of Parent)
      await chrome.tabs.group({ tabIds: [t1.id] });
      await new Promise(r => setTimeout(r, 2000));

      const storage = await chrome.storage.local.get(["subGroupArray"]);
      return storage.subGroupArray || [];
    });

    console.log("STORAGE AFTER MOVE & GROUP:", JSON.stringify(result, null, 2));
    // Find the relationship where Parent is the parent
    const rel = result.find((r: any) => r.name === 'Parent');
    expect(rel).toBeDefined();
  });

  test('subgroups should be deleted when parent group is deleted', async () => {
    const finalTabs = await worker.evaluate(async () => {
      // @ts-ignore
      if (typeof subGroupArray !== 'undefined') subGroupArray = []; 
      await chrome.storage.local.clear();
      const allTabs = await chrome.tabs.query({});
      for (const t of allTabs) {
          if (!t.url.includes('about:blank') && t.url !== '') {
              await chrome.tabs.remove(t.id).catch(()=>{});
          }
      }
      await new Promise(r => setTimeout(r, 1000));
      
      const t1 = await chrome.tabs.create({ url: 'https://p1.com' });
      const t2 = await chrome.tabs.create({ url: 'https://p2.com' });
      const t3 = await chrome.tabs.create({ url: 'https://p3.com' });
      
      // G1(t3, t2, t1)
      const pId = await chrome.tabs.group({ tabIds: [t1.id, t2.id, t3.id] });
      await chrome.tabGroups.update(pId, { title: 'G1' });
      await new Promise(r => setTimeout(r, 1000));
      
      // G2(t2, t1) inside G1
      await chrome.tabs.group({ tabIds: [t1.id, t2.id] });
      await new Promise(r => setTimeout(r, 1000));

      // G3(t1) inside G2
      await chrome.tabs.group({ tabIds: [t1.id] });
      await new Promise(r => setTimeout(r, 1000));

      const beforeStorage = await chrome.storage.local.get(["subGroupArray"]);
      console.log("SUBGROUPS BEFORE DELETE:", JSON.stringify(beforeStorage.subGroupArray, null, 2));

      // Simulate closing G1 by removing its tabs
      const pTabs = await chrome.tabs.query({ groupId: pId });
      for (const t of pTabs) {
          await chrome.tabs.remove(t.id);
      }
      await new Promise(r => setTimeout(r, 3000));

      const tabs = await chrome.tabs.query({});
      return tabs.map(t => t.url);
    });

    expect(finalTabs).not.toContain('https://p1.com/');
    expect(finalTabs).not.toContain('https://p2.com/');
    expect(finalTabs).not.toContain('https://p3.com/');
  });

  test('subgroups should retain relative order after reopen', async () => {
    const order = await worker.evaluate(async () => {
      // @ts-ignore
      if (typeof subGroupArray !== 'undefined') subGroupArray = []; 
      await chrome.storage.local.clear();
      const allTabs = await chrome.tabs.query({});
      for (const t of allTabs) {
          if (!t.url.includes('about:blank') && t.url !== '') {
              await chrome.tabs.remove(t.id).catch(()=>{});
          }
      }
      await new Promise(r => setTimeout(r, 1000));
      
      const t4 = await chrome.tabs.create({ url: 'https://parent.com' }); // parent
      const t1 = await chrome.tabs.create({ url: 'https://p1.com' }); // child 1
      const t2 = await chrome.tabs.create({ url: 'https://p2.com' }); // child 2
      const t3 = await chrome.tabs.create({ url: 'https://p3.com' }); // child 3
      
      const pId = await chrome.tabs.group({ tabIds: [t4.id] });
      await chrome.tabGroups.update(pId, { title: 'Parent' });
      await new Promise(r => setTimeout(r, 1000));

      const c1Id = await chrome.tabs.group({ tabIds: [t1.id] });
      await new Promise(r => setTimeout(r, 1000));
      const c2Id = await chrome.tabs.group({ tabIds: [t2.id] });
      await new Promise(r => setTimeout(r, 1000));
      const c3Id = await chrome.tabs.group({ tabIds: [t3.id] });
      await new Promise(r => setTimeout(r, 2000));

      // Initial order: Parent, C1, C2, C3
      // Rearrange to: Parent, C3, C1, C2
      
      // Move t3 immediately after parent (index 2)
      await chrome.tabs.move(t3.id, { index: 2 });
      await new Promise(r => setTimeout(r, 1000));
      
      // Move t1 after t3 (index 3)
      await chrome.tabs.move(t1.id, { index: 3 });
      await new Promise(r => setTimeout(r, 1000));

      // Move t2 after t1 (index 4)
      await chrome.tabs.move(t2.id, { index: 4 });
      await new Promise(r => setTimeout(r, 2000));
      
      const beforeCollapse = await chrome.tabs.query({});
      console.log("ORDER BEFORE COLLAPSE:", beforeCollapse.map(t => t.url));

      // Collapse Parent
      await chrome.tabGroups.update(pId, { collapsed: true });
      await new Promise(r => setTimeout(r, 3000));
      
      // Expand Parent
      await chrome.tabGroups.update(pId, { collapsed: false });
      await new Promise(r => setTimeout(r, 5000));
      
      const tabs = await chrome.tabs.query({});
      return tabs.map(t => t.url);
    });

    console.log("ORDER AFTER REOPEN:", order);
    const parentIdx = order.findIndex(u => u.includes('parent.com'));
    const p3Idx = order.findIndex(u => u.includes('p3.com'));
    const p1Idx = order.findIndex(u => u.includes('p1.com'));
    const p2Idx = order.findIndex(u => u.includes('p2.com'));
    
    expect(p3Idx).toBe(parentIdx + 1);
    expect(p1Idx).toBe(p3Idx + 1);
    expect(p2Idx).toBe(p1Idx + 1);
  });
});
