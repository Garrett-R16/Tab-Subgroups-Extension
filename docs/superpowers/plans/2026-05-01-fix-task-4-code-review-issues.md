# Tab Subgroups Final Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement recursive group movement to keep hierarchies together and ensure robust color inheritance.

**Architecture:** Add an `onMoved` listener for tab groups that triggers a recursive movement of all child groups to be adjacent to their parent. Refactor color syncing to be truly recursive and use the `getRootColor` helper.

**Tech Stack:** JavaScript (Chrome Extension Manifest V3), Playwright (for E2E testing).

---

### Task 8: Recursive Group Movement

**Files:**
- Modify: `service-worker.js`

- [ ] **Step 1: Implement recursiveMove function**
```javascript
async function recursiveMove(parentId) {
    const children = subGroupArray.filter(s => s.parentId === parentId && !s.isCollapsed);
    if (children.length === 0) return;

    // Get the parent group to find its last tab's index
    const parentTabs = await chrome.tabs.query({ groupId: parentId });
    if (parentTabs.length === 0) return;
    
    // Sort tabs by index and find the highest index
    const lastParentTabIndex = Math.max(...parentTabs.map(t => t.index));
    let nextIndex = lastParentTabIndex + 1;

    for (const child of children) {
        // Move the child group to be immediately after the parent's last tab
        await chrome.tabGroups.move(child.childId, { index: nextIndex });
        
        // Find the new 'next' index based on the child's tabs
        const childTabs = await chrome.tabs.query({ groupId: child.childId });
        if (childTabs.length > 0) {
            nextIndex = Math.max(...childTabs.map(t => t.index)) + 1;
        }

        // Recursively move this child's own children
        await recursiveMove(child.childId);
    }
}
```

- [ ] **Step 2: Add onMoved listener**
Replace `chrome.tabGroups.onMoved.addListener(refreshIds);` with:
```javascript
chrome.tabGroups.onMoved.addListener(async (group) => {
    await recursiveMove(group.id);
    await refreshIds();
});
```

- [ ] **Step 3: Commit**
```bash
git add service-worker.js
git commit -m "feat: implement recursive group movement to keep hierarchies together"
```

### Task 9: Recursive Color Propagation Fix

**Files:**
- Modify: `service-worker.js`

- [ ] **Step 1: Refactor color inheritance in groupUpdated**
Ensure that when a parent color changes, it doesn't just update the immediate child, but the child's update then triggers its own children.
Actually, the current event-chain handles this, but let's make it explicit and efficient.
```javascript
// Inside groupUpdated loop
if (subGroup.parentId == group.id && group.color != subGroup.color) {
    subGroup.color = group.color;
    chrome.tabGroups.update(subGroup.childId, { color: subGroup.color });
    // The resulting onUpdated for the child will handle the grandchild
}
```

- [ ] **Step 2: Commit**
```bash
git add service-worker.js
git commit -m "refactor: ensure robust recursive color inheritance"
```

### Task 10: Final Verification

**Files:**
- Modify: `tests/e2e/logic.spec.ts`

- [ ] **Step 1: Add movement test case**
```javascript
  test('should move subgroups when the parent group is moved', async () => {
    const [worker] = context.serviceWorkers();
    
    await worker.evaluate(async () => {
      await chrome.storage.local.clear();
      
      const t1 = await chrome.tabs.create({ url: 'https://p.com' });
      const t2 = await chrome.tabs.create({ url: 'https://c.com' });
      
      const pId = await chrome.tabs.group({ tabIds: [t1.id] });
      await new Promise(r => setTimeout(r, 500));
      const cId = await chrome.tabs.group({ tabIds: [t2.id] });
      await new Promise(r => setTimeout(r, 1000));

      // Move parent group to the end (index 100 or something large)
      await chrome.tabGroups.move(pId, { index: -1 });
    });

    await new Promise(resolve => setTimeout(resolve, 3000));

    const finalPositions = await worker.evaluate(async () => {
        const grps = await chrome.tabGroups.query({});
        const tabs = await chrome.tabs.query({});
        return {
            pGroupId: grps.find(g => !g.title.includes('-'))?.id,
            cGroupId: grps.find(g => g.title.includes('-'))?.id,
            tabs: tabs.map(t => ({ url: t.url, index: t.index, groupId: t.groupId }))
        };
    });

    const pTab = finalPositions.tabs.find(t => t.url.includes('p.com'));
    const cTab = finalPositions.tabs.find(t => t.url.includes('c.com'));

    // Child tab should be immediately after parent tab
    expect(cTab.index).toBe(pTab.index + 1);
  });
```

- [ ] **Step 2: Run all tests**
Run: `npx playwright test`

- [ ] **Step 3: Commit**
```bash
git add tests/e2e/logic.spec.ts
git commit -m "test: add verification for recursive group movement"
```
