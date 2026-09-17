/**
 * Side panel: arvore hierarquica real dos grupos e subgrupos.
 *
 * A barra de abas do navegador nao suporta aninhamento (a API chrome.tabGroups
 * nao expoe isso e a UI e do proprio browser). Este painel e o lugar onde a
 * hierarquia aparece de fato: grupo raiz > subgrupos indentados > abas.
 */

const GROUP_COLORS = {
    grey: "#5f6368",
    blue: "#1a73e8",
    red: "#d93025",
    yellow: "#f9ab00",
    green: "#1e8e3e",
    pink: "#d01884",
    purple: "#9334e6",
    cyan: "#007b83",
    orange: "#fa903e"
};

const PREFIX_RE = /^[↳\s]+/u;
const treeEl = document.getElementById("tree");

let windowId = null;
let renderTimer = null;

// Subgrupos estacionados nao existem como grupo no navegador, entao nao tem
// estado de colapso proprio: o painel guarda o dele.
const localOpen = new Set();

function stripPrefix(title) {
    return String(title || "").replace(PREFIX_RE, "").trim();
}

function colorOf(name) {
    return GROUP_COLORS[name] || GROUP_COLORS.grey;
}

function faviconUrl(pageUrl) {
    try {
        const url = new URL(chrome.runtime.getURL("/_favicon/"));
        url.searchParams.set("pageUrl", pageUrl || "");
        url.searchParams.set("size", "16");
        return url.toString();
    } catch (e) {
        return "";
    }
}

/* ------------------------------------------------------------------ */
/* Leitura de estado                                                   */
/* ------------------------------------------------------------------ */

async function loadState() {
    if (windowId == null) {
        const win = await chrome.windows.getCurrent();
        windowId = win.id;
    }

    const [tabs, groups, store] = await Promise.all([
        chrome.tabs.query({ windowId }),
        chrome.tabGroups.query({ windowId }),
        chrome.storage.local.get(["subGroupArray"])
    ]);

    const subs = store.subGroupArray || [];

    const groupById = new Map(groups.map((g) => [String(g.id), g]));
    const recordByChild = new Map();
    const childrenByParent = new Map();
    const parkedOwner = new Map(); // tabId -> registro do subgrupo estacionado

    for (const rec of subs) {
        recordByChild.set(String(rec.childId), rec);
        const key = String(rec.parentId);
        if (!childrenByParent.has(key)) childrenByParent.set(key, []);
        childrenByParent.get(key).push(rec);
        if (rec.isCollapsed) {
            for (const p of rec.parkedTabs || []) {
                if (p.id != null) parkedOwner.set(p.id, rec);
            }
        }
    }

    for (const list of childrenByParent.values()) {
        list.sort((a, b) => (a.relativeOrder || 0) - (b.relativeOrder || 0));
    }

    const tabsByGroup = new Map();
    const ungrouped = [];
    for (const tab of tabs.sort((a, b) => a.index - b.index)) {
        if (tab.groupId === -1) {
            ungrouped.push(tab);
            continue;
        }
        const key = String(tab.groupId);
        if (!tabsByGroup.has(key)) tabsByGroup.set(key, []);
        tabsByGroup.get(key).push(tab);
    }

    const roots = groups
        .filter((g) => !recordByChild.has(String(g.id)))
        .sort((a, b) => {
            const at = (tabsByGroup.get(String(a.id)) || [{ index: 0 }])[0].index;
            const bt = (tabsByGroup.get(String(b.id)) || [{ index: 0 }])[0].index;
            return at - bt;
        });

    return {
        tabs, groups, subs, groupById, recordByChild,
        childrenByParent, parkedOwner, tabsByGroup, ungrouped, roots
    };
}

/* ------------------------------------------------------------------ */
/* Render                                                              */
/* ------------------------------------------------------------------ */

function row(className) {
    const el = document.createElement("div");
    el.className = `row ${className || ""}`.trim();
    return el;
}

function caret(state) {
    const el = document.createElement("span");
    el.className = `caret ${state}`;
    el.textContent = state === "leaf" ? "" : "▼";
    return el;
}

function renderTab(tab, state, opts = {}) {
    const el = row("tab");
    if (tab.active) el.classList.add("current");
    if (opts.parked) el.classList.add("parked");

    el.appendChild(caret("leaf"));

    const icon = document.createElement("img");
    icon.className = "favicon";
    icon.src = tab.favIconUrl || faviconUrl(tab.url);
    icon.onerror = () => { icon.style.visibility = "hidden"; };
    el.appendChild(icon);

    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = tab.title || tab.url || "(sem titulo)";
    el.appendChild(title);

    el.title = tab.url || "";
    el.addEventListener("click", async () => {
        if (opts.onActivate) {
            await opts.onActivate();
            return;
        }
        try {
            await chrome.tabs.update(tab.id, { active: true });
            await chrome.windows.update(windowId, { focused: true });
        } catch (e) { /* aba fechada */ }
    });

    return el;
}

/** Sobe a arvore ate achar um ancestral que exista de fato na barra de abas. */
function visibleAncestor(record, state) {
    let current = record;
    const seen = new Set();
    while (current && current.isCollapsed) {
        if (seen.has(String(current.childId))) break;
        seen.add(String(current.childId));
        const parentRecord = state.recordByChild.get(String(current.parentId));
        if (!parentRecord) return current.parentId;
        current = parentRecord;
    }
    return current ? current.childId : null;
}

function renderGroupNode(group, record, state, depth) {
    const wrapper = document.createElement("div");
    const collapsed = !!group.collapsed;

    const header = row("group");
    header.appendChild(caret(collapsed ? "collapsed" : "expanded"));

    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = colorOf(group.color);
    header.appendChild(dot);

    const title = document.createElement("span");
    title.className = "group-title";
    title.textContent = stripPrefix(group.title) || "(sem nome)";
    header.appendChild(title);

    const ownTabs = (state.tabsByGroup.get(String(group.id)) || [])
        .filter((t) => !state.parkedOwner.has(t.id));
    const childRecords = state.childrenByParent.get(String(group.id)) || [];

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = childRecords.length
        ? `${ownTabs.length} · ${childRecords.length} sub`
        : String(ownTabs.length);
    header.appendChild(badge);

    header.title = collapsed ? "Clique para abrir o grupo" : "Clique para fechar o grupo";
    header.addEventListener("click", async () => {
        try {
            await chrome.tabGroups.update(group.id, { collapsed: !collapsed });
        } catch (e) { /* ignora */ }
    });

    wrapper.appendChild(header);

    // grupo fechado na barra de abas fica fechado aqui tambem
    if (collapsed || (!ownTabs.length && !childRecords.length)) {
        return wrapper;
    }

    const children = document.createElement("div");
    children.className = "children";

    for (const tab of ownTabs) {
        children.appendChild(renderTab(tab, state));
    }

    for (const child of childRecords) {
        children.appendChild(renderChildRecord(child, state, depth + 1));
    }

    wrapper.appendChild(children);

    return wrapper;
}

function renderChildRecord(record, state, depth) {
    const liveGroup = state.groupById.get(String(record.childId));

    if (liveGroup && !record.isCollapsed) {
        return renderGroupNode(liveGroup, record, state, depth);
    }

    // subgrupo estacionado: as abas existem, mas estao escondidas dentro do
    // ancestral colapsado. Mostramos igual, apenas atenuado.
    const wrapper = document.createElement("div");
    const key = `rec:${record.childId}`;
    const open = localOpen.has(key);

    const header = row("group parked");

    const toggle = caret(open ? "expanded" : "collapsed");
    toggle.title = open ? "Esconder as abas" : "Mostrar as abas";
    toggle.addEventListener("click", (event) => {
        event.stopPropagation();
        if (open) localOpen.delete(key); else localOpen.add(key);
        render().catch(() => {});
    });
    header.appendChild(toggle);

    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = colorOf(record.color);
    dot.style.opacity = ".55";
    header.appendChild(dot);

    const title = document.createElement("span");
    title.className = "group-title";
    const base = (record.subTitle || "").trim();
    title.textContent = base && base !== "$b" ? base : `${record.name}-${record.count}`;
    header.appendChild(title);

    const parked = record.parkedTabs && record.parkedTabs.length
        ? record.parkedTabs
        : (record.savedTabs || []);

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = `${parked.length} oculta${parked.length === 1 ? "" : "s"}`;
    header.appendChild(badge);

    const restore = async () => {
        const ancestorId = visibleAncestor(record, state);
        if (ancestorId == null) return;
        try {
            await chrome.tabGroups.update(parseInt(ancestorId), { collapsed: false });
        } catch (e) { /* ignora */ }
    };

    header.title = "Clique para reabrir o grupo que contem estas abas";
    header.addEventListener("click", restore);
    wrapper.appendChild(header);

    const nested = state.childrenByParent.get(String(record.childId)) || [];
    if (!open || (!parked.length && !nested.length)) {
        return wrapper;
    }

    const children = document.createElement("div");
    children.className = "children";
    for (const p of parked) {
        children.appendChild(renderTab(
            { id: p.id, title: p.title, url: p.url, favIconUrl: null, active: false },
            state,
            { parked: true, onActivate: restore }
        ));
    }
    for (const child of nested) {
        children.appendChild(renderChildRecord(child, state, depth + 1));
    }
    wrapper.appendChild(children);

    return wrapper;
}

async function render() {
    const state = await loadState();
    const scroller = document.scrollingElement || document.documentElement;
    const scrollTop = scroller.scrollTop;
    const frag = document.createDocumentFragment();

    if (!state.roots.length && !state.ungrouped.length) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "Nenhum grupo nesta janela.";
        frag.appendChild(empty);
    }

    for (const group of state.roots) {
        frag.appendChild(renderGroupNode(group, null, state, 0));
    }

    if (state.ungrouped.length) {
        const label = document.createElement("div");
        label.className = "section-label";
        label.textContent = "Sem grupo";
        frag.appendChild(label);
        for (const tab of state.ungrouped) {
            frag.appendChild(renderTab(tab, state));
        }
    }

    treeEl.replaceChildren(frag);
    scroller.scrollTop = scrollTop;
}

function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => { render().catch(() => {}); }, 90);
}

/* ------------------------------------------------------------------ */
/* Atualizacao ao vivo                                                 */
/* ------------------------------------------------------------------ */

document.getElementById("collapse-all").addEventListener("click", async () => {
    const state = await loadState();
    for (const group of state.roots) {
        try {
            await chrome.tabGroups.update(group.id, { collapsed: true });
        } catch (e) { /* ignora */ }
    }
});

for (const event of [
    chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onMoved,
    chrome.tabs.onActivated, chrome.tabs.onAttached, chrome.tabs.onDetached,
    chrome.tabGroups.onCreated, chrome.tabGroups.onUpdated,
    chrome.tabGroups.onRemoved, chrome.tabGroups.onMoved
]) {
    event.addListener(scheduleRender);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.title || changeInfo.favIconUrl || changeInfo.status === "complete" ||
        changeInfo.groupId !== undefined || changeInfo.url) {
        scheduleRender();
    }
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.subGroupArray) scheduleRender();
});

render().catch(() => {});
