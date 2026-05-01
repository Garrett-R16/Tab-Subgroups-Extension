# Tab Subgroups Persistent ID Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the extension to use persistent ID mapping for robust nested tab grouping, including recursive collapse/expand and color inheritance.

**Architecture:** Use `chrome.storage.local` to maintain a source-of-truth mapping between parents and children. Replace title-based lookup with direct ID lookup. Use recursion for color and collapse propagation.

**Tech Stack:** JavaScript (Chrome Extension Manifest V3), Playwright (for E2E testing).

---

### Task 1: Project Initialization & Test Setup

**Files:**
- Create: `package.json`
- Create: `tests/e2e/setup.ts`
- Create: `tests/e2e/extension.spec.ts`

- [ ] **Step 1: Create package.json with Playwright dependencies**
```json
{
  "name": "tab-subgroups-extension",
  "version": "1.0.0",
  "description": "E2E tests for Tab Subgroups",
  "devDependencies": {
    "@playwright/test": "^1.42.0",
    "typescript": "^5.3.3"
  },
  "scripts": {
    "test": "playwright test"
  }
}
```

- [ ] **Step 2: Install dependencies**
Run: `npm install`

- [ ] **Step 3: Create Playwright test to verify extension load**
```typescript
import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import path from 'path';

test('extension loads successfully', async () => {
  const pathToExtension = path.resolve(__dirname, '../../');
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${pathToExtension}`,
      `--load-extension=${pathToExtension}`,
    ],
  });
  const [background] = context.serviceWorkers();
  expect(background).toBeTruthy();
  await context.close();
});
```

- [ ] **Step 4: Run test to verify failure (expect failure if no service worker matches)**
Run: `npx playwright test`

- [ ] **Step 5: Commit**
```bash
git add package.json package-lock.json tests/
git commit -m "chore: setup playwright testing framework"
```

### Task 2: Core Data Structure & Helper Refactor

**Files:**
- Modify: `service-worker.js`

- [ ] **Step 1: Define Subgroup interface and initialize storage helpers**
Add at the top of `service-worker.js`:
```javascript
let subGroupArray = []; // Using local variable for speed, sync with storage

async function loadStorage() {
    const result = await chrome.storage.local.get(["subGroupArray"]);
    subGroupArray = result.subGroupArray || [];
}

function saveStorage() {
    chrome.storage.local.set({ subGroupArray });
}
```

- [ ] **Step 2: Implement recursive color finder**
```javascript
async function getRootColor(groupId) {
    const subgroup = subGroupArray.find(s => s.childId === groupId);
    if (subgroup) {
        return await getRootColor(subgroup.parentId);
    }
    const group = await chrome.tabGroups.get(groupId);
    return group.color;
}
```

- [ ] **Step 3: Commit**
```bash
git add service-worker.js
git commit -m "refactor: add core storage and color helpers"
```

### Task 4: Implementation of Nested Group Creation

**Files:**
- Modify: `service-worker.js`

- [ ] **Step 1: Update tabCreated listener with Priority logic**
```javascript
async function tabCreated(group) {
    const tabs = await chrome.tabs.query({ groupId: group.id });
    if (tabs.length === 0) return;

    // Find the first tab (left-to-right) that belonged to a group
    let parentGroupId = -1;
    for (const tab of tabs) {
        const prevTab = prevIds.find(t => t.id === tab.id);
        if (prevTab && prevTab.groupId !== -1 && prevTab.groupId !== group.id) {
            parentGroupId = prevTab.groupId;
            break;
        }
    }

    if (parentGroupId !== -1) {
        const parentGroup = await chrome.tabGroups.get(parentGroupId);
        const rootColor = await getRootColor(parentGroupId);
        const count = subGroupArray.filter(s => s.parentId === parentGroupId).length + 1;
        
        subGroupArray.push({
            parentId: parentGroupId,
            childId: group.id,
            name: parentGroup.title,
            count: count,
            isCollapsed: false,
            color: rootColor,
            savedTabs: []
        });

        await chrome.tabGroups.update(group.id, { 
            title: `${parentGroup.title}-${count}`,
            color: rootColor
        });
        saveStorage();
    }
    refreshIds();
}
```

- [ ] **Step 2: Commit**
```bash
git add service-worker.js
git commit -m "feat: implement priority-based nesting in tabCreated"
```

### Task 5: Recursive Collapse & Save Implementation

**Files:**
- Modify: `service-worker.js`

- [ ] **Step 1: Implement recursiveCollapse function**
```javascript
async function recursiveCollapse(groupId) {
    const children = subGroupArray.filter(s => s.parentId === groupId);
    for (const child of children) {
        if (!child.isCollapsed) {
            const tabs = await chrome.tabs.query({ groupId: child.childId });
            child.savedTabs = tabs.map(t => ({ url: t.url, title: t.title, pinned: t.pinned }));
            child.isCollapsed = true;
            
            // Recursively collapse children of this child
            await recursiveCollapse(child.childId);
            
            // Remove tabs from browser
            for (const tab of tabs) {
                await chrome.tabs.remove(tab.id);
            }
        }
    }
    saveStorage();
}
```

- [ ] **Step 2: Update groupUpdated to trigger collapse**
```javascript
async function groupUpdated(group) {
    if (group.collapsed) {
        await recursiveCollapse(group.id);
    } else {
        await recursiveExpand(group.id);
    }
}
```

- [ ] **Step 3: Commit**
```bash
git add service-worker.js
git commit -m "feat: implement recursive collapse and tab saving"
```

### Task 6: Recursive Expand & Re-group Implementation

**Files:**
- Modify: `service-worker.js`

- [ ] **Step 1: Implement recursiveExpand function**
```javascript
async function recursiveExpand(parentId) {
    const children = subGroupArray.filter(s => s.parentId === parentId);
    for (const child of children) {
        if (child.isCollapsed && child.savedTabs.length > 0) {
            const createdTabs = [];
            for (const savedTab of child.savedTabs) {
                const tab = await chrome.tabs.create({ url: savedTab.url, active: false });
                createdTabs.push(tab.id);
            }
            
            const newGroupId = await chrome.tabs.group({ tabIds: createdTabs });
            const title = `${child.name}-${child.count}`;
            
            await chrome.tabGroups.update(newGroupId, { 
                title: title, 
                color: child.color,
                collapsed: true // Subgroups initialize as collapsed
            });

            // Update childId in storage since it's a new group
            child.childId = newGroupId;
            child.isCollapsed = true; // Still collapsed (as requested)
            
            saveStorage();
        }
    }
}
```

- [ ] **Step 2: Commit**
```bash
git add service-worker.js
git commit -m "feat: implement recursive expand and initialization as collapsed"
```

### Task 7: Cleanup & Membership Logic

**Files:**
- Modify: `service-worker.js`

- [ ] **Step 1: Handle tab removal from group**
Add to `refreshIds` or a dedicated listener:
```javascript
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.groupId === -1 || (changeInfo.groupId && changeInfo.groupId !== tab.groupId)) {
        // Tab moved out of its group. 
        // If the subgroup it was in becomes empty, Chrome will delete the group, 
        // which triggers onGroupDeleted. No extra logic needed for storage cleanup here.
    }
    refreshIds();
});
```

- [ ] **Step 2: Implement onGroupDeleted cleanup**
```javascript
function onGroupDeleted(groupId) {
    // Remove the subgroup entry if it was the child
    // Also remove any entries where it was the parent (orphaning the children)
    subGroupArray = subGroupArray.filter(s => s.childId !== groupId && s.parentId !== groupId);
    saveStorage();
    refreshIds();
}
```

- [ ] **Step 3: Commit**
```bash
git add service-worker.js
git commit -m "feat: implement cleanup logic for deleted groups"
```
