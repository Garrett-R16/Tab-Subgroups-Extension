console.log(chrome.tabGroups);
chrome.tabGroups.onCreated.addListener(tabCreated);

let tabGroupIds = [];
let prevIds = [];

let groupIds = [];
let prevGroups = [];

console.log(tabGroupIds);

function getTabGroupIds() {
    return new Promise((resolve, reject) => {
        chrome.tabs.query({}, tabs => {
            tabGroupIds = tabs.map(tab => ({ id: tab.id, groupId: tab.groupId }));
            resolve(tabGroupIds);
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

getGroupIds().then(groupIds => {
    console.log(groupIds);
    prevGroups = groupIds;
})

getTabGroupIds().then(tabGroupIds => {
    console.log(tabGroupIds);
    prevIds = tabGroupIds;
})

// chrome.tabGroups.query({}, function(groups) {
//     var groupIds = groups.map(group => group.id);
//     console.log(groupIds);
// });

function tabCreated(group) {
    getTabGroupIds().then(tabGroupIds => {
        console.log(tabGroupIds);
        
        tabGroupIds.forEach(tab => {
            if (tab.groupId==group.id) {
                console.log("Tab in group", tab.id);
                
                prevIds.forEach(prevTab => {
                    if (prevTab.id==tab.id && prevTab.groupId!=group.id && prevTab.groupId!=-1) {
                        console.log("tab was in another group", group.id, prevTab.groupId);
                        
                        prevGroups.forEach(pGroup => {
                            if (pGroup.id==prevTab.groupId) {
                                console.log("attempted?")
                                chrome.tabGroups.update(group.id, { title: `sub-${pGroup.title}` });
                            }
                        })
                    } //&& tab.groupId!=null && tab.groupId!=group.id
                })
            }
            // prevIds.forEach(prevTab => {
            //     prevGroups.forEach(groupId => {
            //         //&& prevTab.groupId==groupId
            //         console.log("tab was in another group", groupId, prevTab.groupId)
            //         if (prevTab.id==tab.id){
            //             console.log("tab was in another group", groupId, prevTab.groupId)
            //         }
            //     });
            // });
        })
        prevIds = tabGroupIds;

        getGroupIds().then(groupIds => {
            prevGroups = groupIds;
            console.log(prevGroups)
        })
    });
}