console.log(chrome.tabGroups);

//Refreshing current list if tab/group orientation has changed
chrome.tabGroups.onRemoved.addListener(tabRemoved);

//this isn't working!!!!!!!!!!!!!!!!!!!!!
chrome.tabGroups.onUpdated.addListener(tabUpdated);


chrome.tabs.onCreated.addListener(refreshIds);
chrome.tabs.onMoved.addListener(refreshIds);

//connecting tabgroup listener
chrome.tabGroups.onCreated.addListener(tabCreated);

let tabIds = [];
let prevIds = [];

let groupIds = [];
let prevGroups = [];

let subGroupIds = [];

refreshIds();

// functions for getting the list of open group ids and tabs

function getTabIds() {
    return new Promise((resolve, reject) => {
        chrome.tabs.query({}, tabs => {
            tabIds = tabs.map(tab => ({ id: tab.id, groupId: tab.groupId, url: tab.url }));
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

//combining the functions into one

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

// function for getting the group object assosiate with x id

function getGroupObject(groupId) {
    groupIds.forEach(groupObj => {
        if (groupObj.id==groupId) {
            return groupObj;
        }
    })
    return {};
}

//this isn't working!!!!!!!!!!!!!!!!!!!!!
function tabUpdated(group) {
    subGroupIds.forEach(subGroup => {
        if (subGroup.subId == group.id && group.title.substring(0,3)!='sub') {

            subGroup.subTitle = group.title;

            chrome.tabGroups.update(group.id, { title: `sub-${subGroup.title} ${subGroup.subTitle}` });
            return;
        }
        if (subGroup.mainId == group.id) {
            subGroup.title = group.title;
            chrome.tabGroups.update(subGroup.subId, { title: `sub-${subGroup.title} ${subGroup.subTitle}` });
        }
    })
}

function tabRemoved(group) {
    for(let i = 0; i < subGroupIds.length; i++) {
        console.log(subGroupIds[i])
        if (group.id == subGroupIds[i].subId) {
            subGroupIds.splice(i, 1);
            break;
        }
    }
    refreshIds();
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

                                subGroupIds.push({ mainId: pGroup.id, subId: group.id, title: pGroup.title, subTitle: ""});

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

// function constructTabArrays() {

//     // for iterating through the tabs
//     tabIds.forEach(tabObj => {
        

//         if (groupDoesNotExist) {
//             // create Tab Array Object
//             addObject(getGroupObject(tabObj.groupId));
//         }
//         if (tabObj.groupId==current) {
//             // if object with that group id exists?
//             addObject(tabObj);
//         }
//         else if (tabObj.groupId!=null) {
//             //
//             tabObj.groupId = new tabArray;
//         }
//     })

//     if (groupId) {
//         addObject({})
//     }
// }

// //class for creating instances of tab arrays

// class tabArrays {

//     tabArray = []

//     addObject(tabObject) {
//         this.tabArray.push(tabObject)
//     }
// }

//[ {Groupid: 1231231312, groupName: "whatever"}, {tabName: "soemthing", url: "soemthing", id: ""}, {groupName: "whatever", id: 321321123, tabGroups: [{tabname: "whatever"}, {tabName: "son"}]}]