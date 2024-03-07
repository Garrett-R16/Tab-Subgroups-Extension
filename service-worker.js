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
// subgroup array
let subGroupIds = [];

// Initial function for checking if groups array exists in storage, and if the groups array aligns with the current groups open, setting the subgroup array equal to the subgroup array in storage
getGroupIds().then(groupIds => {
    chrome.storage.local.get(["groups"], (result) => {
        if (result.groups) {
            if (groupIds.length!=result.groups.length) {
                return;
            } else {
                for (let i = 0; i<groupIds.length; i++) {
                    if (groupIds[i].id!=result.groups[i].id) {
                        return;
                    }
                }
                chrome.storage.local.get(["subGroupArray"], (result) => {
                    if (result.subGroupArray) {
                        subGroupIds = result.subGroupArray;
                    } else {
                    }
                });
            }
        }
    });
})

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
            tabIdsList = tabs.map(tab => ({ id: tab.id, groupId: tab.groupId, url: tab.url}));
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

    subGroupIds.forEach(subGroup => {
        // ensuring colors of group are the same
        if (subGroup.subId==group.id && group.color != subGroup.color && !subGroup.mainGroupClosed) {
            chrome.tabGroups.update(group.id, { color: subGroup.color });
        } else if (subGroup.mainId==group.id && group.color != subGroup.color && !subGroup.mainGroupClosed) {
            subGroup.color = group.color;
            chrome.tabGroups.update(subGroup.subId, { color: subGroup.color });
        }

        // if/else for closing subgroups and updating names of subgroups
        if (subGroup.subId == group.id && group.title.substring(0, subGroup.title.length)!=subGroup.title) {
            let Title = newTitle(subGroup.count, subGroup.subTitle, subGroup.title);
            if (Title != group.title) {
                subGroup.subTitle = group.title;
            }
            
            if (group.title=="$b") {
                subGroup.subTitle = "";
                let Title = newTitle(subGroup.count, subGroup.subTitle, subGroup.title);
                chrome.tabGroups.update(group.id, { title: Title });
            }
            refreshSubStorage();

        } else if (subGroup.mainId == group.id && subGroup.title!=group.title) {
            subGroup.title = group.title;

            if (!subGroup.mainGroupClosed) {
                let Title = newTitle(subGroup.count, subGroup.subTitle, subGroup.title);

                chrome.tabGroups.update(subGroup.subId, { title: Title });
                refreshSubStorage();
            }

        } else if (subGroup.mainId == group.id && group.collapsed && !subGroup.mainGroupClosed) {
            
            let tabUrls = []
            getTabIds().then(async tabIdsList => {
                await chrome.tabGroups.update(subGroup.subId, { collapsed: true });
                tabIdsList.forEach(tabId => {
                    if (tabId.groupId == subGroup.subId) {
                        
                        tabUrls.push(tabId.url);
                        chrome.tabs.remove(tabId.id);
                    }
                });

                subGroup.tabs = tabUrls;
                subGroup.mainGroupClosed = true;

                refreshSubStorage();
            });

        } else if (subGroup.mainId == group.id && !group.collapsed && subGroup.mainGroupClosed && group.title!="") {

            let totalList = [];

            const createTabPromises = subGroup.tabs.map(tabUrl => {
                return new Promise(resolve => {
                    chrome.tabs.create({ url: tabUrl, active: false }, tab => {
                        totalList.push(tab.id);
                        resolve(tab.id);
                    });
                });
            });
            
            Promise.all(createTabPromises).then(totalList => {
                // Once all tabs are created, group them
                chrome.tabs.group({ tabIds: totalList }, async newId => {

                    subGroupIds.forEach(subGroup2 => {
                        if (subGroup2.mainId == subGroup.subId) {
                            subGroup2.mainId = newId;
                        }
                    });

                    let Title = newTitle(subGroup.count, subGroup.subTitle, subGroup.title);

                    subGroup.subId = newId;

                    let newIndex;
                    for (let i = 0; i < tabIdsList.length; i++) {
                        if (tabIdsList[i].groupId==subGroup.mainId && tabIdsList[i+1].groupId!=subGroup.mainId) {
                            newIndex = i+1;
                            break;
                        }
                    }

                    await chrome.tabGroups.update(newId, { color: group.color, collapsed: true, title: Title });
                    await chrome.tabGroups.move(newId, { index: newIndex })

                    subGroup.mainGroupClosed = false;
                    
                    refreshSubStorage();
                    
                });
            });

            
        }
    });
}

function onGroupDeleted(group) {
    for(let i = 0; i < subGroupIds.length; i++) {
        if (group.id == subGroupIds[i].subId && !subGroupIds[i].mainGroupClosed) {
            
            subGroupIds.splice(i, 1);
            i--;
        }
    }
    refreshSubStorage();
    getTabIds().then(tabIdsList => {
        prevIds = tabIdsList;
    });
    getGroupIds().then(groupIds => {
        prevGroups = groupIds;

        chrome.storage.local.set({ groups: groupIds });
    });
}

//main function for updating the tab groups
function tabCreated(group) {
    //getting current tabids
    getTabIds().then(tabIdsList => {
        //iterating through tabs
        tabIdsList.forEach(tab => {
            if (tab.groupId==group.id) {
                // checking if a subgroup with that group.id already exists
                let SubGroupExists = false;

                subGroupIds.forEach(subGroup => {
                    if (subGroup.subId==group.id) {
                        SubGroupExists = true;
                        return;
                    }
                });

                //iterating through array with previous group ids and comparing it to new group for that tab
                prevIds.forEach(prevTab => {
                    if (prevTab.id==tab.id && prevTab.groupId!=group.id && prevTab.groupId!=-1 && !SubGroupExists) {
                        
                        //updating tab to become a subgroup if it was origionally in another tabgroup
                        prevGroups.forEach(pGroup => {
                            if (pGroup.id==prevTab.groupId) {
                                
                                let count = 1;
                                subGroupIds.forEach(subGroup => {
                                    if (subGroup.mainId == pGroup.id) {
                                        count++;
                                    }
                                });
                                
                                subGroupIds.push({ mainId: pGroup.id, subId: group.id, title: pGroup.title, subTitle: "", count: count, tabs: [], mainGroupClosed: false, color: pGroup.color });
                                chrome.tabGroups.update(group.id, { title: `${pGroup.title}-${count}`, color: pGroup.color });

                                refreshSubStorage();
                            }
                        });
                    }
                });
            }
        });
        prevIds = tabIdsList;

        getGroupIds().then(groupIds => {
            prevGroups = groupIds;
            
            chrome.storage.local.set({ groups: groupIds });
        });
    });
}

// function for updating subgroup storage
function refreshSubStorage() {
    chrome.storage.local.set({ subGroupArray: subGroupIds });
}