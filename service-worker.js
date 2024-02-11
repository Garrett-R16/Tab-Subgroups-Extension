console.log(chrome.tabGroups);

//Refreshing current list if tab/group orientation has changed
chrome.tabGroups.onRemoved.addListener(refreshIds);
chrome.tabs.onCreated.addListener(refreshIds);
chrome.tabs.onMoved.addListener(refreshIds);

//connecting tabgroup listener
chrome.tabGroups.onCreated.addListener(tabCreated);

let tabIds = [];
let prevIds = [];

let groupIds = [];
let prevGroups = [];

refreshIds();

function getTabIds() {
    return new Promise((resolve, reject) => {
        chrome.tabs.query({}, tabs => {
            tabIds = tabs.map(tab => ({ id: tab.id, groupId: tab.groupId }));
            resolve(tabIds);
        });
    });
}

function getGroupIds() {
    return new Promise((resolve, reject) => {
        chrome.tabGroups.query({}, function(groups) {
            groupIds = groups.map(group => ({ id: group.id, title: group.title }));
            resolve(groupIds);
        });
    });
}

function refreshIds() {
    getGroupIds().then(groupIds => {
        console.log(groupIds);
        prevGroups = groupIds;
    })
    
    getTabIds().then(tabIds => {
        console.log(tabIds);
        prevIds = tabIds;
    })
}

//main function for updating the tab groups

function tabCreated(group) {
    //getting current tabids
    getTabIds().then(tabIds => {
        console.log(tabIds);
        
        //iterating through tabs
        tabIds.forEach(tab => {
            if (tab.groupId==group.id) {
                console.log("Tab in group", tab.id);
                //logging new group

                //iterating through array with previous group ids and comparing it to new group for that tab
                prevIds.forEach(prevTab => {
                    if (prevTab.id==tab.id && prevTab.groupId!=group.id && prevTab.groupId!=-1) {
                        console.log("tab was in another group", group.id, prevTab.groupId);
                        
                        //updating tab to become a subgroup if it was origionally in another tabgroup
                        prevGroups.forEach(pGroup => {
                            if (pGroup.id==prevTab.groupId) {
                                console.log("attempted?")
                                chrome.tabGroups.update(group.id, { title: `sub-${pGroup.title}` });
                            }
                        })
                    }
                })
            }
        })
        prevIds = tabIds;

        getGroupIds().then(groupIds => {
            prevGroups = groupIds;
            console.log(prevGroups)
        })
    });
}