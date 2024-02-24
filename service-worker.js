// Refreshing current list if tab/group orientation has changed

chrome.tabGroups.onUpdated.addListener(tabUpdated);
chrome.tabGroups.onCreated.addListener(tabCreated);
chrome.tabGroups.onRemoved.addListener(onGroupDeleted);

// chrome.tabs.onUpdated.addListener(tabUpdateListener);
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

refreshIds();

// functions for getting the list of open group ids and tabs
function getTabIds() {
    return new Promise((resolve) => {
        chrome.tabs.query({}, tabs => {
            tabIdsList = tabs.map(tab => ({ id: tab.id, groupId: tab.groupId, url: tab.url }));
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
    })
    
    getTabIds().then(tabIdsList => {
        prevIds = tabIdsList;
    })
}

// attempted to make it so it would update on update but not working atm
// async function tabUpdateListener(tab, changeInfo) {
//     let groupInList = false;

//     if (changeInfo.groupId && changeInfo.groupId!=-1) {
//         groupIds.forEach(groupId => {
//             if (changeInfo.groupId == groupId.id) groupInList = true;
//         });
//         console.log(groupInList);
//         if (!groupInList) {
//             console.log("func not doin notin");
//             return;
//         }
//     }
//     // console.log("tab Update", tab, changeInfo);
    
//     // console.log(changeInfo.groupId);
//     if(changeInfo.status!='loading') {
//         console.log("refreshing");
//         refreshIds();
//     }
// }


// typing in $b reverts the title back to the origional title
function newTitle(count, subTitle, mainTitle) {
    if (subTitle=="$b" || subTitle=="") {
        return `${count}-${mainTitle}`;
    } else {
        return `${subTitle}`;
    }
}

// function for getting the group object assosiate with x id
function tabUpdated(group) {
    console.log("TAB IS UPDATED");

    subGroupIds.forEach(subGroup => {
        console.log(group.title.substring(0, subGroup.title.length), subGroup.title);

        // ensuring colors of group are the same
        if (subGroup.subId==group.id && group.color != subGroup.color && !subGroup.mainGroupClosed) {
            chrome.tabGroups.update(group.id, { color: subGroup.color });
        } else if (subGroup.mainId==group.id && group.color != subGroup.color && !subGroup.mainGroupClosed) {
            subGroup.color = group.color;
            chrome.tabGroups.update(subGroup.subId, { color: subGroup.color });
        }

        // if/else for closing subgroups and updating names of subgroups
        if (subGroup.subId == group.id && group.title.substring(0, subGroup.title.length)!=subGroup.title) {
            console.log("1 num", subGroup.title);
            subGroup.subTitle = group.title;

            if (group.title=="$b") {
                let Title = newTitle(subGroup.count, subGroup.subTitle, subGroup.title);
                chrome.tabGroups.update(group.id, { title: Title });
            }

        } else if (subGroup.mainId == group.id && subGroup.title!=group.title && !subGroup.mainGroupClosed) {
            console.log("2 num", subGroup.title, group.collapsed, subGroup.mainGroupClosed);
            subGroup.title = group.title;

            let Title = newTitle(subGroup.count, subGroup.subTitle, subGroup.title);

            chrome.tabGroups.update(subGroup.subId, { title: Title });

        } else if (subGroup.mainId == group.id && group.collapsed && !subGroup.mainGroupClosed) {
            console.log("3", group.title);
            
            let tabUrls = []
            console.log(tabIdsList);
            getTabIds().then(async tabIdsList => {
                await chrome.tabGroups.update(subGroup.subId, { collapsed: true });
                tabIdsList.forEach(tabId => {
                    if (tabId.groupId == subGroup.subId) {
                        
                        console.log(tabId.url, "tabUrl");
                        tabUrls.push(tabId.url);
                        chrome.tabs.remove(tabId.id);
                    }
                });

                subGroup.tabs = tabUrls;

                subGroup.mainGroupClosed = true;

                console.log(subGroup, "SUBGROUP!!?!??!?!?!?", subGroup.mainGroupClosed);

            });

        } else if (subGroup.mainId == group.id && !group.collapsed && subGroup.mainGroupClosed && group.title!="") {
            console.log("4", group.title, group.collapsed);
            
            console.log(subGroup, "current subgroup being created");

            let totalList = [];

            const createTabPromises = subGroup.tabs.map(tabUrl => {
                return new Promise(resolve => {
                    chrome.tabs.create({ url: tabUrl, active: false }, tab => {
                        totalList.push(tab.id);
                        console.log("Tab created with ID:", tab.id);
                        resolve(tab.id);
                    });
                });
            });
            
            Promise.all(createTabPromises).then(totalList => {
                console.log("All tabs created:", totalList);
                // Once all tabs are created, group them
                chrome.tabs.group({ tabIds: totalList }, async newId => {
                    console.log("New group ID:", newId);

                    console.log(newId, "newId");

                    console.log("ids changed", subGroupIds);
                    subGroupIds.forEach(subGroup2 => {
                        if (subGroup2.mainId == subGroup.subId) {
                            console.log(subGroup2.mainId, "initial mainID")
                            subGroup2.mainId = newId;
                            console.log(subGroup2.mainId, "Changed mainID")
                        }
                    });

                    let Title = newTitle(subGroup.count, subGroup.subTitle, subGroup.title);

                    subGroup.subId = newId;
                    console.log(subGroup.subId, "UPDATED??");

                    await chrome.tabGroups.update(newId, { color: group.color, collapsed: true, title: Title });
                });
            });

            subGroup.mainGroupClosed = false;
        
        }
    })
}

function onGroupDeleted(group) {
    console.log("deleted function called");
    for(let i = 0; i < subGroupIds.length; i++) {
        console.log(subGroupIds[i].mainGroupClosed);
        if (group.id == subGroupIds[i].subId && !subGroupIds[i].mainGroupClosed) {
            console.log(subGroupIds[i], "Subgroup Deleted", subGroupIds.length);
            
            subGroupIds.splice(i, 1);
            i--;
            console.log(subGroupIds.length);
        }
    }
    refreshIds();
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
                    console.log(group.id, subGroup.subId);
                    if (subGroup.subId==group.id) {
                        SubGroupExists = true;
                        return;
                    }
                });

                //iterating through array with previous group ids and comparing it to new group for that tab
                prevIds.forEach(prevTab => {
                    if (prevTab.id==tab.id && prevTab.groupId!=group.id && prevTab.groupId!=-1 && !SubGroupExists) {
                        console.log("tab was in another group", group.id, prevTab.groupId);
                        
                        //updating tab to become a subgroup if it was origionally in another tabgroup
                        prevGroups.forEach(pGroup => {
                            if (pGroup.id==prevTab.groupId) {
                                
                                let count = 1;
                                subGroupIds.forEach(subGroup => {
                                    if (subGroup.mainId == pGroup.id) {
                                        count++;
                                    }
                                })
                                
                                subGroupIds.push({ mainId: pGroup.id, subId: group.id, title: pGroup.title, subTitle: "", count: count, tabs: [], mainGroupClosed: false, color: pGroup.color });
                                chrome.tabGroups.update(group.id, { title: `${pGroup.title}-${count}`, color: pGroup.color });
                            }
                        })
                    }
                })
            }
        })
        prevIds = tabIdsList;

        getGroupIds().then(groupIds => {
            prevGroups = groupIds;
        })
    });
}