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

let subGroupArray = []; // Using local variable for speed, sync with storage

async function loadStorage() {
    const result = await chrome.storage.local.get(["subGroupArray"]);
    subGroupArray = result.subGroupArray || [];
}

function saveStorage() {
    chrome.storage.local.set({ subGroupArray });
}

async function getRootColor(groupId) {
    try {
        const subgroup = subGroupArray.find(s => s.childId === groupId);
        if (subgroup) {
            return await getRootColor(subgroup.parentId);
        }
        const group = await chrome.tabGroups.get(groupId);
        return group.color;
    } catch (e) {
        return "grey";
    }
}

// Refreshing current list if tab/group orientation has changed
chrome.tabGroups.onUpdated.addListener(groupUpdated);
chrome.tabGroups.onCreated.addListener(tabCreated);
chrome.tabGroups.onRemoved.addListener(onGroupDeleted);

chrome.tabs.onUpdated.addListener(tabUpdateListener);
chrome.tabs.onCreated.addListener(refreshIds);
chrome.tabs.onMoved.addListener(refreshIds);
chrome.tabs.onRemoved.addListener(refreshIds);

// tab arrays
let tabIdsList = [];
let prevIds = [];
// group arrays
let groupIds = [];
let prevGroups = [];

// Initialize storage
loadStorage();

// Initially getting ids
getTabIds().then(tabIdsList => {
    prevIds = tabIdsList;
});
getGroupIds().then(groupIds => {
    prevGroups = groupIds;

    chrome.storage.local.set({ groups: groupIds });
});

// functions for getting the list of open group ids and tabs
function getTabIds() {
    return new Promise((resolve) => {
        chrome.tabs.query({}, tabs => {
            tabIdsList = tabs.map(tab => ({ 
                id: tab.id, 
                groupId: tab.groupId, 
                url: tab.url,
                title: tab.title,
                pinned: tab.pinned
            }));
            resolve(tabIdsList);
        });
    });
    
}

function getGroupIds() {
    return new Promise((resolve) => {
        chrome.tabGroups.query({}, function(groups) {
            groupIds = groups.map(group => ({ id: group.id, title: group.title, color: group.color }));
            resolve(groupIds);
        });
    });
}

//combining the functions into one
function refreshIds() {
    getGroupIds().then(groupIds => {
        prevGroups = groupIds;
    });
    
    getTabIds().then(tabIdsList => {
        prevIds = tabIdsList;
    });
}

function tabUpdateListener(tab, changeInfo) {
    let groupInList = false;
    if (changeInfo.groupId == -1) return;
    if (changeInfo.groupId) {
        groupIds.forEach(groupId => {
            if (changeInfo.groupId == groupId.id) groupInList = true;
        });

        if (!groupInList) {
            return;
        }
    }
    refreshIds();
}

// typing in $b reverts the title back to the origional title
function newTitle(count, subTitle, mainTitle) {
    if (subTitle=="$b" || subTitle=="") {
        return `${count}-${mainTitle}`;
    } else {
        return `${subTitle}`;
    }
}

// function for getting the group object assosiate with x id
function groupUpdated(group) {

    subGroupArray.forEach(subGroup => {
        // ensuring colors of group are the same
        if (subGroup.childId==group.id && group.color != subGroup.color && !subGroup.isCollapsed) {
            chrome.tabGroups.update(group.id, { color: subGroup.color });
        } else if (subGroup.parentId==group.id && group.color != subGroup.color && !subGroup.isCollapsed) {
            subGroup.color = group.color;
            chrome.tabGroups.update(subGroup.childId, { color: subGroup.color });
        }

        // if/else for closing subgroups and updating names of subgroups
        if (subGroup.childId == group.id && group.title.substring(0, subGroup.name.length)!=subGroup.name) {
            let Title = newTitle(subGroup.count, subGroup.subTitle, subGroup.name);
            if (Title != group.title) {
                subGroup.subTitle = group.title;
            }
            
            if (group.title=="$b") {
                subGroup.subTitle = "";
                let Title = newTitle(subGroup.count, subGroup.subTitle, subGroup.name);
                chrome.tabGroups.update(group.id, { title: Title });
            }
            saveStorage();

        } else if (subGroup.parentId == group.id && subGroup.name!=group.title) {
            subGroup.name = group.title;

            if (!subGroup.isCollapsed) {
                let Title = newTitle(subGroup.count, subGroup.subTitle, subGroup.name);

                chrome.tabGroups.update(subGroup.childId, { title: Title });
                saveStorage();
            }

        } else if (subGroup.parentId == group.id && group.collapsed && !subGroup.isCollapsed) {
            
            let tabData = []
            getTabIds().then(async tabIdsList => {
                await chrome.tabGroups.update(subGroup.childId, { collapsed: true });
                tabIdsList.forEach(tab => {
                    if (tab.groupId == subGroup.childId) {
                        tabData.push({
                            url: tab.url,
                            title: tab.title,
                            pinned: tab.pinned
                        });
                        chrome.tabs.remove(tab.id);
                    }
                });

                subGroup.savedTabs = tabData;
                subGroup.isCollapsed = true;

                saveStorage();
            });

        } else if (subGroup.parentId == group.id && !group.collapsed && subGroup.isCollapsed && group.title!="") {

            let totalList = [];

            const createTabPromises = subGroup.savedTabs.map(tab => {
                return new Promise(resolve => {
                    chrome.tabs.create({ url: tab.url, pinned: tab.pinned, active: false }, newTab => {
                        totalList.push(newTab.id);
                        resolve(newTab.id);
                    });
                });
            });
            
            Promise.all(createTabPromises).then(totalList => {
                // Once all tabs are created, group them
                chrome.tabs.group({ tabIds: totalList }, async newId => {

                    subGroupArray.forEach(subGroup2 => {
                        if (subGroup2.parentId == subGroup.childId) {
                            subGroup2.parentId = newId;
                        }
                    });

                    let Title = newTitle(subGroup.count, subGroup.subTitle, subGroup.name);

                    subGroup.childId = newId;

                    let newIndex;
                    for (let i = 0; i < tabIdsList.length; i++) {
                        if (tabIdsList[i].groupId==subGroup.parentId && tabIdsList[i+1].groupId!=subGroup.parentId) {
                            newIndex = i+1;
                            break;
                        }
                    }

                    await chrome.tabGroups.update(newId, { color: group.color, collapsed: true, title: Title });
                    await chrome.tabGroups.move(newId, { index: newIndex })

                    subGroup.isCollapsed = false;
                    
                    saveStorage();
                    
                });
            });

            
        }
    });
}

function onGroupDeleted(group) {
    subGroupArray = subGroupArray.filter(s => s.childId !== group.id && s.parentId !== group.id);
    saveStorage();
    getTabIds().then(tabIdsList => {
        prevIds = tabIdsList;
    });
    getGroupIds().then(groupIds => {
        prevGroups = groupIds;

        chrome.storage.local.set({ groups: groupIds });
    });
}

//main function for updating the tab groups
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
            savedTabs: [],
            subTitle: "" // Ensure subTitle is initialized
        });

        await chrome.tabGroups.update(group.id, { 
            title: `${parentGroup.title}-${count}`,
            color: rootColor
        });
        saveStorage();
    }
    refreshIds();
}
