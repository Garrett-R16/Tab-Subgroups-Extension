# Design Specification: Tab Subgroups Extension - Persistent ID Mapping

## 1. Problem Statement
The current Tab-Subgroups-Extension has several bugs:
- Opening/closing/naming of groups is inconsistent.
- "Re-opening" groups causes index-out-of-bounds errors.
- Color consistency between parent and children is not enforced.
- The logic for nesting is fragile, relying on title parsing and stale global arrays.

## 2. Proposed Solution: Persistent ID Mapping
We will shift from a "reactive title-based" model to a "persistent metadata-based" model using `chrome.storage.local`.

### 2.1 Storage Schema
A flat list of `subGroupArray` containing `Subgroup` objects:
```typescript
interface Subgroup {
  parentId: number;      // Chrome ID of the parent group
  childId: number;       // Chrome ID of the child group
  name: string;          // The base name (e.g., "Development")
  count: number;         // Index for naming (e.g., 1 for "Development-1")
  isCollapsed: boolean;  // Tracks if child tabs are saved/hidden
  color: string;         // The inherited color
  savedTabs: Array<{     // Tabs removed from browser when parent collapsed
    url: string;
    title: string;
    pinned: boolean;
  }>;
}
```

### 2.2 Key Logic & Rules

#### Priority & Creation
- When a group is created from multiple tabs, the **first tab** (leftmost) that already belongs to a group determines the parent.
- If multiple parent groups are involved, priority is given to the leftmost tab's group.

#### Color Consistency
- Subgroups must always inherit the color of their highest-level ancestor ("root parent").
- Any change to a parent's color propagates down the entire chain.

#### Recursive Collapse/Expand
- **Collapse Parent:** All direct and indirect children are saved to `savedTabs`, their tabs are removed from the browser, and `isCollapsed` is set to `true`.
- **Expand Parent:** Direct children with `isCollapsed: true` are re-created. Their tabs are grouped into a *new* group ID, and the mapping is updated.
- **Initialization:** When a subgroup is re-opened, it should be initialized as **collapsed**.

#### Membership Changes
- If a tab is moved out of a subgroup (to another group or "none"), it is removed from the `savedTabs` or tracking for that subgroup.
- If a subgroup becomes empty, it is deleted from storage.

## 3. Implementation Details

### Events to Monitor
- `chrome.tabGroups.onUpdated`: Handle collapse/expand and color changes.
- `chrome.tabGroups.onRemoved`: Cleanup child groups if parent is deleted.
- `chrome.tabs.onUpdated`: Handle tabs moving in/out of groups.
- `chrome.tabGroups.onCreated`: Handle new nesting triggers.

### Helper Functions
- `getRootParentColor(groupId)`: Traverse up the chain to find the top-level ancestor's color.
- `syncDescendantColors(parentId, color)`: Propagate color changes down.
- `recursiveCollapse(parentId)`: Iteratively handle nested closures.

## 4. Testing Plan (Playwright)
Automated tests will verify:
1. **Nesting Logic:** Correct naming and parent assignment.
2. **Color Inheritance:** Instant propagation from root to nth-child.
3. **Recursive Lifecycle:** 3-level deep collapse/expand behavior.
4. **Resilience:** Correct behavior when tabs are removed or groups are deleted.
