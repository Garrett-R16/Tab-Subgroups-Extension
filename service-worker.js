/**
 * MoreGroups / Tab Subgroups - service worker
 *
 * Modelo de "parking" em vez de destruir/recriar abas:
 *
 * Quando um grupo pai e colapsado, as abas dos subgrupos NAO sao fechadas.
 * Elas sao movidas para dentro do proprio grupo pai (chrome.tabs.group com
 * groupId do pai). Como o pai esta colapsado, o navegador as esconde sozinho.
 * Ao expandir, as mesmas abas sao reagrupadas de volta no subgrupo.
 *
 * Consequencias:
 *  - nenhuma aba e fechada nem recarregada (scroll, formulario, sessao e
 *    historico de navegacao intactos);
 *  - uma unica transicao visual, sem "abrir varias guias" em sequencia;
 *  - o identificador da aba se mantem, entao nao existe janela de tempo em
 *    que a extensao esta criando abas e reagindo aos proprios eventos.
 *
 * @typedef {Object} ParkedTab
 * @property {number|null} id
 * @property {string} url
 * @property {string} title
 * @property {boolean} pinned
 *
 * @typedef {Object} Subgroup
 * @property {number} parentId      - ID Chrome do grupo pai
 * @property {number} childId       - ID Chrome do grupo filho
 * @property {string} name          - Nome base herdado do pai
 * @property {number} count         - Indice para nomeacao automatica
 * @property {boolean} isCollapsed  - Abas estao "estacionadas" no ancestral
 * @property {string} color         - Cor herdada do ancestral raiz
 * @property {string} subTitle      - Titulo customizado pelo usuario
 * @property {number} relativeOrder - Posicao relativa entre irmaos
 * @property {Array<ParkedTab>} parkedTabs - Abas vivas estacionadas
 * @property {Array<ParkedTab>} savedTabs  - Fallback para reinicio do browser
 */

const TITLE_PREFIX = "↳"; // caractere de indentacao mostrado na barra de abas
const MAX_PREFIX_DEPTH = 4;
const ECHO_TTL = 2500;
const GUARD_TAIL = 250;

let subGroupArray = [];
let prevIds = [];
let applying = 0;
let ready = null;
const echo = new Map();
const collapseState = new Map(); // groupId -> ultimo estado colapsado conhecido
const selfCreated = new Set();   // grupos criados pela propria extensao

function isDragError(e) {
    return /drag/i.test(String((e && e.message) || ""));
}
let refreshTimer = null;
let reflowTimer = null;
const reflowQueue = new Set();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

async function loadStorage() {
    const result = await chrome.storage.local.get(["subGroupArray"]);
    subGroupArray = result.subGroupArray || [];
    for (const s of subGroupArray) {
        if (!Array.isArray(s.parkedTabs)) s.parkedTabs = [];
        if (!Array.isArray(s.savedTabs)) s.savedTabs = [];
        if (typeof s.subTitle !== "string") s.subTitle = "";
        if (typeof s.relativeOrder !== "number") s.relativeOrder = 0;
    }
}

function saveStorage() {
    chrome.storage.local.set({ subGroupArray });
}

/* ------------------------------------------------------------------ */
/* Guard de reentrancia + supressao de eco                             */
/* ------------------------------------------------------------------ */

/** Verdadeiro enquanto a extensao esta aplicando mudancas proprias. */
function busy() {
    return applying > 0;
}

/**
 * Executa `fn` marcando a extensao como ocupada. Os listeners de move
 * ignoram eventos nessa janela, o que corta o loop de retroalimentacao
 * (move -> onMoved -> move -> ...) responsavel pela avalanche de acoes.
 */
async function guarded(fn) {
    applying++;
    try {
        return await fn();
    } finally {
        // a fila de eventos do navegador ainda esta drenando; solta depois
        setTimeout(() => { applying = Math.max(0, applying - 1); }, GUARD_TAIL);
    }
}

function markEcho(key) {
    echo.set(key, Date.now() + ECHO_TTL);
}

/** Consome a marca: true se este evento foi causado pela propria extensao. */
function isEcho(key) {
    const expiry = echo.get(key);
    if (expiry == null) return false;
    echo.delete(key);
    return expiry > Date.now();
}

/** chrome.tabGroups.update marcando as propriedades escritas como eco. */
async function updateGroup(groupId, props) {
    for (const [k, v] of Object.entries(props)) markEcho(`${k}:${groupId}:${v}`);
    try {
        return await chrome.tabGroups.update(parseInt(groupId), props);
    } catch (e) {
        return null;
    }
}

/* ------------------------------------------------------------------ */
/* Hierarquia                                                          */
/* ------------------------------------------------------------------ */

function recordOfChild(groupId) {
    return subGroupArray.find((s) => s.childId == groupId);
}

function childrenOf(groupId) {
    return subGroupArray.filter((s) => s.parentId == groupId);
}

/** Profundidade do grupo na arvore (0 = grupo raiz). */
function depthOf(groupId) {
    let depth = 0;
    let current = groupId;
    const seen = new Set();
    while (true) {
        const rec = recordOfChild(current);
        if (!rec || seen.has(String(current))) break;
        seen.add(String(current));
        depth++;
        current = rec.parentId;
    }
    return depth;
}

/** Sobe a arvore ate o grupo raiz. */
function rootOf(groupId) {
    let current = groupId;
    const seen = new Set();
    while (true) {
        const rec = recordOfChild(current);
        if (!rec || seen.has(String(current))) break;
        seen.add(String(current));
        current = rec.parentId;
    }
    return current;
}

async function getRootColor(groupId) {
    try {
        const rec = recordOfChild(groupId);
        if (rec) return await getRootColor(rec.parentId);
        const group = await chrome.tabGroups.get(parseInt(groupId));
        return group.color || "grey";
    } catch (e) {
        return "grey";
    }
}

/* ------------------------------------------------------------------ */
/* Titulos (pseudo-aninhamento na barra de abas)                       */
/* ------------------------------------------------------------------ */

/** Remove o prefixo de indentacao para ler o titulo "puro" do usuario. */
function stripPrefix(title) {
    return String(title || "").replace(/^[↳\s]+/u, "").trim();
}

function baseTitleOf(sub) {
    const custom = (sub.subTitle || "").trim();
    if (custom && custom !== "$b") return custom;
    return `${sub.name}-${sub.count}`;
}

/** Titulo final exibido, com indentacao proporcional a profundidade. */
function displayTitleOf(sub) {
    const depth = Math.min(Math.max(depthOf(sub.childId), 1), MAX_PREFIX_DEPTH);
    return `${TITLE_PREFIX.repeat(depth)} ${baseTitleOf(sub)}`;
}

async function applyTitle(sub) {
    if (sub.isCollapsed) return;
    await updateGroup(sub.childId, { title: displayTitleOf(sub) });
}

/* ------------------------------------------------------------------ */
/* Ordenacao e posicionamento                                          */
/* ------------------------------------------------------------------ */

async function updateSiblingOrder(parentId) {
    const siblings = childrenOf(parentId);
    const positioned = [];
    for (const s of siblings) {
        if (s.isCollapsed) continue;
        try {
            const tabs = await chrome.tabs.query({ groupId: parseInt(s.childId) });
            if (tabs.length > 0) {
                positioned.push({ s, index: Math.min(...tabs.map((t) => t.index)) });
            }
        } catch (e) { /* grupo sumiu */ }
    }

    positioned.sort((a, b) => a.index - b.index);
    positioned.forEach((item, i) => { item.s.relativeOrder = i; });

    if (positioned.length > 0) saveStorage();
}

function byRelativeOrder(a, b) {
    return (a.relativeOrder || 0) - (b.relativeOrder || 0);
}

/**
 * Cola os subgrupos expandidos imediatamente apos as abas do pai, em ordem.
 * So mexe no que esta fora de lugar, para nao gerar movimento visual inutil.
 */
async function recursiveMove(parentId, retryCount = 0) {
    const children = childrenOf(parentId).filter((s) => !s.isCollapsed);
    if (children.length === 0) return;

    children.sort(byRelativeOrder);

    try {
        const parentTabs = await chrome.tabs.query({ groupId: parseInt(parentId) });
        if (parentTabs.length === 0) return;

        let nextIndex = Math.max(...parentTabs.map((t) => t.index)) + 1;

        for (const child of children) {
            let childTabs = await chrome.tabs.query({ groupId: parseInt(child.childId) });
            if (childTabs.length === 0) continue;

            const firstIndex = Math.min(...childTabs.map((t) => t.index));
            if (firstIndex !== nextIndex) {
                await chrome.tabGroups.move(parseInt(child.childId), { index: nextIndex });
                childTabs = await chrome.tabs.query({ groupId: parseInt(child.childId) });
            }

            if (childTabs.length > 0) {
                nextIndex = Math.max(...childTabs.map((t) => t.index)) + 1;
            }

            await recursiveMove(child.childId);
        }
    } catch (e) {
        // o usuario ainda esta com a aba presa no mouse; espera o gesto acabar
        // sem sair do guard, senao a nova tentativa vira mais um ciclo de eventos
        if (isDragError(e) && retryCount < 8) {
            await sleep(250 * (retryCount + 1));
            return recursiveMove(parentId, retryCount + 1);
        }
    }
}

/** Reposicionamento agrupado: varios eventos em rajada viram um unico ajuste. */
function scheduleReflow(groupId) {
    if (groupId == null) return;
    reflowQueue.add(String(groupId));
    clearTimeout(reflowTimer);
    reflowTimer = setTimeout(async () => {
        const ids = [...reflowQueue];
        reflowQueue.clear();
        await guarded(async () => {
            for (const id of ids) {
                await updateSiblingOrder(id);
                await recursiveMove(id);
            }
        });
        scheduleRefresh();
    }, 220);
}

/* ------------------------------------------------------------------ */
/* Snapshot de abas (usado para descobrir o pai de um grupo novo)      */
/* ------------------------------------------------------------------ */

async function getTabIds() {
    const tabs = await chrome.tabs.query({});
    return tabs.map((tab) => ({
        id: tab.id,
        groupId: tab.groupId,
        url: tab.url,
        title: tab.title,
        pinned: tab.pinned
    }));
}

async function refreshIds() {
    prevIds = await getTabIds();
}

function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshIds, 150);
}

/* ------------------------------------------------------------------ */
/* Colapsar: estacionar as abas dentro do ancestral colapsado          */
/* ------------------------------------------------------------------ */

function snapshotTabs(tabs) {
    return tabs.map((t) => ({
        id: t.id,
        url: t.url,
        title: t.title,
        pinned: t.pinned
    }));
}

/** Todos os registros descendentes, em ordem de profundidade. */
function descendantRecords(groupId) {
    const out = [];
    const walk = (pid) => {
        for (const child of childrenOf(pid)) {
            out.push(child);
            walk(child.childId);
        }
    };
    walk(groupId);
    return out;
}

function descendantGroupIds(groupId) {
    return descendantRecords(groupId).map((r) => String(r.childId));
}

/**
 * Se a aba ativa pertence a um subgrupo que esta a ponto de ser estacionado,
 * o navegador seria obrigado a reabrir o grupo pai para nao esconder a aba
 * ativa. Trocamos a aba ativa antes, para o colapso sair limpo.
 */
async function ensureActiveOutside(groupId) {
    const blocked = new Set([String(groupId), ...descendantGroupIds(groupId)]);
    try {
        const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!active || !blocked.has(String(active.groupId))) return;

        const tabs = await chrome.tabs.query({ currentWindow: true });
        const fallback = tabs.find((t) => !blocked.has(String(t.groupId)) && t.id !== active.id);
        if (fallback) await chrome.tabs.update(fallback.id, { active: true });
    } catch (e) { /* ignora */ }
}

async function recursiveCollapse(groupId) {
    await updateSiblingOrder(groupId);

    const children = childrenOf(groupId);
    children.sort(byRelativeOrder);

    for (const child of children) {
        if (child.isCollapsed) continue;

        // abas proprias do filho, antes de receber os netos
        const ownTabs = await chrome.tabs.query({ groupId: parseInt(child.childId) });

        // primeiro os netos sao estacionados dentro do filho...
        await recursiveCollapse(child.childId);

        // ...depois tudo que esta no filho sobe de uma vez para o ancestral
        const allTabs = await chrome.tabs.query({ groupId: parseInt(child.childId) });

        child.parkedTabs = snapshotTabs(ownTabs);
        child.savedTabs = snapshotTabs(ownTabs); // fallback se o browser reiniciar
        // marcado ANTES do move: esvaziar o grupo dispara onRemoved, e
        // onGroupDeleted precisa saber que foi a extensao que o esvaziou
        child.isCollapsed = true;

        if (allTabs.length > 0) {
            try {
                await chrome.tabs.group({
                    tabIds: allTabs.map((t) => t.id),
                    groupId: parseInt(groupId)
                });
            } catch (e) {
                if (isDragError(e)) {
                    child.isCollapsed = false;
                    await sleep(400);
                    return recursiveCollapse(groupId);
                }
            }
        }
    }

    saveStorage();
}

/* ------------------------------------------------------------------ */
/* Expandir: devolver as abas estacionadas ao subgrupo                 */
/* ------------------------------------------------------------------ */

function sameUrl(a, b) {
    const norm = (u) => String(u || "").replace(/#.*$/, "").replace(/\/$/, "");
    return norm(a) === norm(b);
}

/**
 * Devolve as abas vivas que pertencem a este registro, em ordem.
 * 1) por ID - caso normal, instantaneo, nenhuma aba e criada;
 * 2) por URL entre as abas do ancestral - o navegador reiniciou e trocou
 *    todos os IDs, mas as abas ainda existem na sessao restaurada;
 * 3) criando a aba - unico caminho que ainda abre guias, e so acontece se
 *    a aba original realmente desapareceu.
 */
async function materialize(record, ancestorGroupId, claimed) {
    const wanted = (record.parkedTabs && record.parkedTabs.length)
        ? record.parkedTabs
        : (record.savedTabs || []);
    if (!wanted.length) return [];

    let ancestorTabs = [];
    try {
        ancestorTabs = await chrome.tabs.query({ groupId: parseInt(ancestorGroupId) });
    } catch (e) { /* ancestral pode nao existir mais */ }

    const out = [];
    for (const p of wanted) {
        let id = null;

        if (p.id != null && !claimed.has(p.id)) {
            try {
                await chrome.tabs.get(p.id);
                id = p.id;
            } catch (e) { /* ID morto */ }
        }

        if (id == null) {
            const match = ancestorTabs.find((t) => !claimed.has(t.id) && sameUrl(t.url, p.url));
            if (match) id = match.id;
        }

        if (id == null) {
            try {
                const tab = await chrome.tabs.create({ url: p.url, pinned: p.pinned, active: false });
                id = tab.id;
            } catch (e) { /* url invalida */ }
        }

        if (id != null) {
            claimed.add(id);
            out.push({ id, url: p.url, title: p.title, pinned: p.pinned });
        }
    }
    return out;
}

/**
 * Expande os filhos diretos. Os netos continuam estacionados, mas precisam
 * viajar junto: eles sao movidos para dentro do grupo do filho (que volta
 * colapsado), senao apareceriam soltos como abas do proprio pai.
 */
async function recursiveExpand(parentId) {
    const children = childrenOf(parentId).filter((s) => s.isCollapsed);
    if (children.length === 0) return;

    children.sort(byRelativeOrder);

    const claimed = new Set();
    let touched = false;

    for (const child of children) {
        const ownTabs = await materialize(child, parentId, claimed);

        // capturado antes de religar os parentIds
        const nested = descendantRecords(child.childId);
        const nestedTabs = [];
        for (const record of nested) {
            const mats = await materialize(record, parentId, claimed);
            record.parkedTabs = mats; // segue estacionado, agora com IDs novos
            record.savedTabs = mats;
            nestedTabs.push(...mats);
        }

        const tabIds = [...ownTabs, ...nestedTabs].map((t) => t.id);
        if (tabIds.length === 0) continue;

        try {
            const newGroupId = await chrome.tabs.group({ tabIds });
            selfCreated.add(newGroupId);
            const oldChildId = child.childId;

            child.childId = newGroupId;
            child.isCollapsed = false;
            child.parkedTabs = [];
            child.savedTabs = [];

            // netos apontavam para o ID antigo do grupo
            for (const s of subGroupArray) {
                if (s.parentId == oldChildId) s.parentId = newGroupId;
            }

            await updateGroup(newGroupId, {
                title: displayTitleOf(child),
                color: child.color,
                collapsed: true
            });
            collapseState.set(String(newGroupId), true);

            touched = true;
        } catch (e) { /* ignora este filho */ }
    }

    if (touched) {
        saveStorage();
        // um unico reposicionamento no fim, em vez de um por filho
        await recursiveMove(parentId);
    }
}

/* ------------------------------------------------------------------ */
/* Sincronizacao de titulo e cor                                       */
/* ------------------------------------------------------------------ */

async function syncTitles(group) {
    const raw = group.title;
    if (raw === undefined) return;

    const plain = stripPrefix(raw);
    let changed = false;

    const self = recordOfChild(group.id);
    if (self) {
        if (plain === "$b") {
            self.subTitle = "";
            changed = true;
            await applyTitle(self);
        } else if (plain && plain !== baseTitleOf(self)) {
            self.subTitle = plain;
            changed = true;
            await applyTitle(self);
        } else if (raw !== displayTitleOf(self)) {
            // o usuario renomeou e o prefixo de indentacao se perdeu
            await applyTitle(self);
        }
    }

    for (const kid of childrenOf(group.id)) {
        if (plain && kid.name !== plain) {
            kid.name = plain;
            changed = true;
            await applyTitle(kid);
        }
    }

    if (changed) saveStorage();
}

async function syncColors(group) {
    if (!group.color) return;
    let changed = false;

    for (const kid of childrenOf(group.id)) {
        if (kid.color !== group.color) {
            kid.color = group.color;
            changed = true;
            if (!kid.isCollapsed) {
                await updateGroup(kid.childId, { color: group.color });
                await syncColors({ id: kid.childId, color: group.color });
            }
        }
    }

    if (changed) saveStorage();
}

/* ------------------------------------------------------------------ */
/* Listeners                                                           */
/* ------------------------------------------------------------------ */

async function groupUpdated(group) {
    await ready;

    // chrome.tabGroups.onUpdated entrega o objeto completo a cada mudanca,
    // inclusive quando so o titulo mudou. So reagimos a transicao real.
    const key = String(group.id);
    const collapsed = !!group.collapsed;
    const previous = collapseState.get(key);
    collapseState.set(key, collapsed);

    const transitioned = previous !== collapsed;
    const selfMade = isEcho(`collapsed:${group.id}:${group.collapsed}`);

    if (transitioned && !selfMade) {
        await guarded(async () => {
            if (collapsed) {
                await ensureActiveOutside(group.id);
                await recursiveCollapse(group.id);
                // alguns navegadores reabrem o grupo ao receber abas novas;
                // se isso acontecer, fecha de volta sem gerar novo ciclo
                try {
                    const fresh = await chrome.tabGroups.get(parseInt(group.id));
                    if (fresh && !fresh.collapsed) {
                        await updateGroup(group.id, { collapsed: true });
                    }
                } catch (e) { /* grupo sumiu */ }
            } else {
                await recursiveExpand(group.id);
            }
        });
    }

    if (group.color !== undefined && !isEcho(`color:${group.id}:${group.color}`)) {
        await guarded(() => syncColors(group));
    }

    if (group.title !== undefined && !isEcho(`title:${group.id}:${group.title}`)) {
        await guarded(() => syncTitles(group));
    }
}

async function onGroupDeleted(group) {
    await ready;

    const wasChild = recordOfChild(group.id);

    // grupo esvaziado pela propria extensao ao estacionar as abas
    if (wasChild && wasChild.isCollapsed) return;

    const descendants = [];
    const walk = (pid) => {
        for (const child of childrenOf(pid)) {
            descendants.push(child);
            walk(child.childId);
        }
    };
    walk(group.id);

    // abas estacionadas viviam dentro do grupo fechado, entao o navegador
    // ja as fechou junto; aqui so sobram os descendentes expandidos
    for (const desc of descendants) {
        if (desc.isCollapsed) continue;
        try {
            const tabs = await chrome.tabs.query({ groupId: parseInt(desc.childId) });
            for (const tab of tabs) {
                await chrome.tabs.remove(tab.id);
            }
        } catch (e) {
            if (isDragError(e)) {
                setTimeout(() => onGroupDeleted(group), 500);
                return;
            }
        }
    }

    const descIds = descendants.map((d) => String(d.childId));
    subGroupArray = subGroupArray.filter((s) =>
        s.childId != group.id &&
        s.parentId != group.id &&
        !descIds.includes(String(s.childId))
    );

    saveStorage();
    scheduleRefresh();
}

async function tabCreated(group) {
    await ready;

    // grupo criado pela propria extensao ao expandir um subgrupo.
    // Conferido por ID (e nao por "esta ocupada"), senao um subgrupo criado
    // pelo usuario durante uma operacao interna seria silenciosamente perdido.
    if (selfCreated.has(group.id)) {
        selfCreated.delete(group.id);
        scheduleRefresh();
        return;
    }

    const snapshotIds = [...prevIds];
    await sleep(busy() ? 400 : 120);

    if (selfCreated.has(group.id)) {
        selfCreated.delete(group.id);
        scheduleRefresh();
        return;
    }

    const tabs = await chrome.tabs.query({ groupId: parseInt(group.id) });
    if (tabs.length === 0) return;

    let parentGroupId = -1;
    for (const source of [snapshotIds, prevIds]) {
        for (const tab of tabs) {
            const prevTab = source.find((t) => t.id === tab.id);
            if (prevTab && prevTab.groupId !== -1 && prevTab.groupId !== group.id) {
                parentGroupId = prevTab.groupId;
                break;
            }
        }
        if (parentGroupId !== -1) break;
    }

    if (parentGroupId === -1) {
        scheduleRefresh();
        return;
    }

    await guarded(async () => {
        try {
            if (recordOfChild(group.id)) return;
            // nao criar relacao nova enquanto um irmao esta sendo restaurado
            if (childrenOf(parentGroupId).some((s) => s.isCollapsed)) return;

            const parentGroup = await chrome.tabGroups.get(parseInt(parentGroupId));
            const rootColor = await getRootColor(parentGroupId);
            const count = childrenOf(parentGroupId).length + 1;

            const record = {
                parentId: parentGroupId,
                childId: group.id,
                name: stripPrefix(parentGroup.title) || "Group",
                count: count,
                isCollapsed: false,
                color: rootColor,
                parkedTabs: [],
                savedTabs: [],
                subTitle: "",
                relativeOrder: count - 1
            };
            subGroupArray.push(record);

            await updateGroup(group.id, {
                title: displayTitleOf(record),
                color: rootColor
            });
            saveStorage();

            await recursiveMove(parentGroupId);
        } catch (e) { /* grupo ja desapareceu */ }
    });

    scheduleRefresh();
}

async function onTabRemoved(tabId) {
    await ready;

    let changed = false;
    for (const s of subGroupArray) {
        const before = (s.parkedTabs || []).length;
        if (before) {
            s.parkedTabs = s.parkedTabs.filter((p) => p.id !== tabId);
            s.savedTabs = (s.savedTabs || []).filter((p) => p.id !== tabId);
            if (s.parkedTabs.length !== before) changed = true;
        }
    }
    // subgrupo estacionado que perdeu todas as abas deixa de existir
    const empty = subGroupArray.filter((s) =>
        s.isCollapsed &&
        (s.parkedTabs || []).length === 0 &&
        (s.savedTabs || []).length === 0
    );
    if (empty.length) {
        const emptyIds = empty.map((s) => String(s.childId));
        subGroupArray = subGroupArray.filter((s) => !emptyIds.includes(String(s.childId)));
        changed = true;
    }
    if (changed) saveStorage();

    scheduleRefresh();
}

chrome.tabGroups.onCreated.addListener(tabCreated);
chrome.tabGroups.onUpdated.addListener(groupUpdated);
chrome.tabGroups.onRemoved.addListener(onGroupDeleted);

chrome.tabGroups.onMoved.addListener(async (group) => {
    await ready;
    if (busy()) return;
    const rec = recordOfChild(group.id);
    scheduleReflow(rec ? rec.parentId : group.id);
});

chrome.tabs.onMoved.addListener(async (tabId) => {
    await ready;
    if (busy()) return;
    try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.groupId === -1) return;
        const rec = recordOfChild(tab.groupId);
        scheduleReflow(rec ? rec.parentId : tab.groupId);
    } catch (e) { /* aba fechada */ }
});

chrome.tabs.onRemoved.addListener(onTabRemoved);

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "complete" || changeInfo.url || changeInfo.groupId !== undefined) {
        scheduleRefresh();
    }
});

/* ------------------------------------------------------------------ */
/* Side panel (arvore hierarquica real)                                */
/* ------------------------------------------------------------------ */

function enableSidePanel() {
    if (!chrome.sidePanel) return;
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(enableSidePanel);
chrome.runtime.onStartup.addListener(enableSidePanel);
enableSidePanel();

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

ready = (async () => {
    await loadStorage();
    await refreshIds();
    // collapseState fica vazio de proposito: o service worker acorda por
    // causa do evento que interessa, e estado desconhecido e tratado como
    // transicao real. Colapsar/expandir sao idempotentes no estado estavel.
})();
