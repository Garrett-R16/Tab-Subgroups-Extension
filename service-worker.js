/**
 * @typedef {Object} Subgroup
 * @property {number} parentId - Chrome ID of the parent group
 * @property {number} childId - Chrome ID of the child group
 * @property {string} name - Base name (e.g., "Parent")
 * @property {number} count - Index for naming (e.g., 1 for "Parent-1")
 * @property {boolean} isCollapsed - Tracks if child tabs are saved
 * @property {string} color - Inherited color from root parent
 * @property {string} subTitle - Custom sub-title for the group
 * @property {Array<{url: string, title: string, pinned: boolean}>} savedTabs - Tabs removed when parent collapsed
 */

let subGroupArray = []; 
let prevIds = [];
let prevGroups = [];

async function loadStorage() {
    const result = await chrome.storage.local.get(["subGroupArray"]);
    subGroupArray = result.subGroupArray || [];
}

function saveStorage() {
    chrome.storage.local.set({ subGroupArray });
}

async function getRootColor(groupId) {
    try {
        const subgroup = subGroupArray.find(s => s.childId == groupId);
        if (subgroup) {
            return await getRootColor(subgroup.parentId);
        }
        const group = await chrome.tabGroups.get(groupId);
        return group.color || "grey";
    } catch (e) {
        return "grey";
    }
}

async function recursiveMove(parentId) {
    const children = subGroupArray.filter(s => s.parentId == parentId && !s.isCollapsed);
    if (children.length === 0) return;

    const parentTabs = await chrome.tabs.query({ groupId: parentId });
    if (parentTabs.length === 0) return;
    
    const lastParentTabIndex = Math.max(...parentTabs.map(t => t.index));
    let nextIndex = lastParentTabIndex + 1;

    for (const child of children) {
        try {
            await chrome.tabGroups.move(child.childId, { index: nextIndex });
            const childTabs = await chrome.tabs.query({ groupId: child.childId });
            if (childTabs.length > 0) {
                nextIndex = Math.max(...childTabs.map(t => t.index)) + 1;
            }
            await recursiveMove(child.childId);
        } catch (e) {}
    }
}

chrome.tabGroups.onUpdated.addListener(groupUpdated);
chrome.tabGroups.onCreated.addListener(tabCreated);
chrome.tabGroups.onRemoved.addListener(onGroupDeleted);
chrome.tabGroups.onMoved.addListener(async (group) => {
    await recursiveMove(group.id);
    await refreshIds();
});

chrome.tabs.onUpdated.addListener(tabUpdateListener);
chrome.tabs.onRemoved.addListener(refreshIds);

(async () => {
    await loadStorage();
    await refreshIds();
})();

function getTabIds() {
    return new Promise((resolve) => {
        chrome.tabs.query({}, tabs => {
            const list = tabs.map(tab => ({ 
                id: tab.id, 
                groupId: tab.groupId, 
                url: tab.url,
                title: tab.title,
                pinned: tab.pinned
            }));
            resolve(list);
        });
    });
}

function getGroupIds() {
    return new Promise((resolve) => {
        chrome.tabGroups.query({}, function(groups) {
            const list = groups.map(group => ({ id: group.id, title: group.title, color: group.color }));
            resolve(list);
        });
    });
}

async function refreshIds() {
    prevGroups = await getGroupIds();
    prevIds = await getTabIds();
}

function tabUpdateListener(tabId, changeInfo, tab) {
    if (changeInfo.status === 'complete' || changeInfo.url) {
        refreshIds();
    }
}

function newTitle(count, subTitle, mainTitle) {
    if (subTitle=="$b" || subTitle=="") {
        return `${mainTitle}-${count}`;
    } else {
        return `${subTitle}`;
    }
}

async function recursiveCollapse(groupId) {
    const children = subGroupArray.filter(s => s.parentId == groupId);
    for (const child of children) {
        if (!child.isCollapsed) {
            const tabs = await chrome.tabs.query({ groupId: child.childId });
            child.savedTabs = tabs.map(t => ({ url: t.url, title: t.title, pinned: t.pinned }));
            child.isCollapsed = true;
            
            await recursiveCollapse(child.childId);
            
            for (const tab of tabs) {
                try {
                    await chrome.tabs.remove(tab.id);
                } catch (e) {}
            }
        }
    }
    saveStorage();
}

async function recursiveExpand(parentId) {
    const children = subGroupArray.filter(s => s.parentId == parentId);
    for (const child of children) {
        if (child.isCollapsed && child.savedTabs.length > 0) {
            try {
                const createdTabs = [];
                for (const savedTab of child.savedTabs) {
                    const tab = await chrome.tabs.create({ url: savedTab.url, pinned: savedTab.pinned, active: false });
                    createdTabs.push(tab.id);
                }
                
                const newGroupId = await chrome.tabs.group({ tabIds: createdTabs });
                const Title = newTitle(child.count, child.subTitle, child.name);
                
                await chrome.tabGroups.update(newGroupId, { 
                    title: Title, 
                    color: child.color,
                    collapsed: true 
                });

                const oldChildId = child.childId;
                child.childId = newGroupId;
                child.isCollapsed = true; 
                child.savedTabs = []; 

                subGroupArray.forEach(s => {
                    if (s.parentId == oldChildId) {
                        s.parentId = newGroupId;
                    }
                });
                
                saveStorage();
            } catch (e) {}
        }
    }
}

async function groupUpdated(group) {
    if (group.collapsed !== undefined) {
        if (group.collapsed) {
            await recursiveCollapse(group.id);
        } else {
            await recursiveExpand(group.id);
        }
    }

    subGroupArray.forEach(subGroup => {
        if (subGroup.parentId == group.id && group.color && group.color != subGroup.color) {
            subGroup.color = group.color;
            if (!subGroup.isCollapsed) {
                chrome.tabGroups.update(subGroup.childId, { color: subGroup.color }).catch(()=>{});
            }
            saveStorage();
        }

        if (subGroup.childId == group.id && group.title && group.title.substring(0, subGroup.name.length) != subGroup.name) {
            let Title = newTitle(subGroup.count, subGroup.subTitle, subGroup.name);
            if (Title != group.title) {
                subGroup.subTitle = group.title;
            }
            
            if (group.title == "$b") {
                subGroup.subTitle = "";
                let Title = newTitle(subGroup.count, subGroup.subTitle, subGroup.name);
                chrome.tabGroups.update(group.id, { title: Title }).catch(()=>{});
            }
            saveStorage();
        } else if (subGroup.parentId == group.id && group.title && subGroup.name != group.title) {
            subGroup.name = group.title;
            if (!subGroup.isCollapsed) {
                let Title = newTitle(subGroup.count, subGroup.subTitle, subGroup.name);
                chrome.tabGroups.update(subGroup.childId, { title: Title }).catch(()=>{});
            }
            saveStorage();
        }
    });
}

function onGroupDeleted(group) {
    const wasChild = subGroupArray.find(s => s.childId == group.id);

    if (wasChild && wasChild.isCollapsed) {
        return; 
    }

    subGroupArray = subGroupArray.filter(s => {
        if (s.childId == group.id) return false;
        if (s.parentId == group.id) {
            return false;
        }
        return true;
    });
    saveStorage();
    refreshIds();
}

async function tabCreated(group) {
    await new Promise(r => setTimeout(r, 200));
    
    const tabs = await chrome.tabs.query({ groupId: group.id });
    if (tabs.length === 0) return;

    let parentGroupId = -1;
    for (const tab of tabs) {
        const prevTab = prevIds.find(t => t.id === tab.id);
        if (prevTab && prevTab.groupId !== -1 && prevTab.groupId !== group.id) {
            parentGroupId = prevTab.groupId;
            break;
        }
    }

    if (parentGroupId !== -1) {
        try {
            const parentGroup = await chrome.tabGroups.get(parentGroupId);
            const rootColor = await getRootColor(parentGroupId);
            const count = subGroupArray.filter(s => s.parentId == parentGroupId).length + 1;
            
            subGroupArray.push({
                parentId: parentGroupId,
                childId: group.id,
                name: parentGroup.title,
                count: count,
                isCollapsed: false,
                color: rootColor,
                savedTabs: [],
                subTitle: "" 
            });

            await chrome.tabGroups.update(group.id, { 
                title: `${parentGroup.title}-${count}`,
                color: rootColor
            });
            saveStorage();

            await recursiveMove(parentGroupId);
        } catch (e) {}
    }
    
    refreshIds();
}
