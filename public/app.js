function getToken() {
  return localStorage.getItem("token") || "";
}

function setError(text) {
  const el = document.getElementById("err");
  if (!text) {
    el.textContent = "";
    el.classList.add("hidden");
    return;
  }
  el.textContent = text;
  el.classList.remove("hidden");
}

async function api(path, opts) {
  const res = await fetch(path, {
    ...(opts || {}),
    headers: {
      ...(opts && opts.headers ? opts.headers : {}),
      Authorization: `Bearer ${getToken()}`,
      "Content-Type": "application/json"
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `http_${res.status}`);
  return data;
}

const state = {
  tab: "queue",
  queue: [],
  mine: [],
  history: [],
  activeId: null,
  active: null,
  messages: [],
  newQueueIds: new Set(),
  unreadIds: new Set(),
  lastQueueIds: new Set()
};

const listEl = document.getElementById("list");
const chatEl = document.getElementById("chat");
const msgInputEl = document.getElementById("msgInput");
const sendBtnEl = document.getElementById("sendBtn");
const claimBtnEl = document.getElementById("claimBtn");
const closeBtnEl = document.getElementById("closeBtn");
const chatHeaderEl = document.getElementById("chatHeader");
const chatMetaEl = document.getElementById("chatMeta");
const chatUnreadEl = document.getElementById("chatUnread");
const countEl = document.getElementById("count");
const tabQueueEl = document.getElementById("tabQueue");
const tabMineEl = document.getElementById("tabMine");
const tabHistoryEl = document.getElementById("tabHistory");
const badgeQueueEl = document.getElementById("badgeQueue");
const badgeMineEl = document.getElementById("badgeMine");
const searchEl = document.getElementById("search");
const chatAvatarEl = document.getElementById("chatAvatar");
const leftNavEl = document.getElementById("leftNav");
const mainWrapEl = document.getElementById("mainWrap");
const toggleLeftNavEl = document.getElementById("toggleLeftNav");

function setTab(tab) {
  state.tab = tab;
  const activeCls =
    "px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors bg-slate-100 text-blue-700 border border-slate-200";
  const idleCls =
    "px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors bg-white text-slate-600 border border-slate-200 hover:bg-slate-50";
  tabQueueEl.className = tab === "queue" ? activeCls : idleCls;
  tabMineEl.className = tab === "mine" ? activeCls : idleCls;
  if (tabHistoryEl) tabHistoryEl.className = tab === "history" ? activeCls : idleCls;
  renderList();
  updateControls();
}

async function loadMe() {
  const me = await api("/api/me");
  document.getElementById("me").textContent = me.email;
}

function renderList() {
  const conversations =
    state.tab === "queue" ? state.queue : state.tab === "mine" ? state.mine : state.history;
  const query = (searchEl?.value || "").trim().toLowerCase();
  const filtered = query ? conversations.filter((c) => String(c.waId).toLowerCase().includes(query)) : conversations;
  listEl.innerHTML = "";
  countEl.textContent = `${filtered.length} ${
    state.tab === "queue" ? "EN COLA" : state.tab === "mine" ? "ACTIVOS" : "HISTORIAL"
  }`;
  for (const c of filtered) {
    const isNew = state.tab === "queue" && state.newQueueIds.has(c.id);
    const isUnread = state.tab === "mine" && state.unreadIds.has(c.id);
    const el = document.createElement("div");
    const active = c.id === state.activeId;
    el.className = [
      "p-4 border-b border-slate-100 cursor-pointer transition-colors",
      active ? "bg-slate-100/50 border-l-[3px] border-blue-700" : "hover:bg-slate-50"
    ].join(" ");
    const time = new Date(c.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const statusText =
      c.status === "needs_agent"
        ? "En espera de asesor"
        : c.status === "assigned"
          ? "Asignado"
          : c.status === "bot"
            ? "Atendido por bot"
          : "Finalizado";
    const statusBadge =
      c.status === "needs_agent"
        ? `<span class="bg-orange-50 text-orange-700 text-[10px] px-2 py-0.5 rounded font-bold border border-orange-100">REQUIERE ASESOR</span>`
        : c.status === "assigned"
          ? `<span class="bg-blue-50 text-blue-700 text-[10px] px-2 py-0.5 rounded font-bold border border-blue-100">EN LÍNEA</span>`
          : c.status === "bot"
            ? `<span class="bg-emerald-50 text-emerald-700 text-[10px] px-2 py-0.5 rounded font-bold border border-emerald-100">BOT</span>`
            : `<span class="bg-slate-100 text-slate-600 text-[10px] px-2 py-0.5 rounded font-bold border border-slate-200">FINALIZADO</span>`;
    el.innerHTML = `
      <div class="flex justify-between items-start mb-1 gap-2">
        <span class="font-bold text-slate-900">${c.waId}</span>
        <span class="text-[10px] text-slate-400 font-mono-data">${time}</span>
      </div>
      <p class="text-body-sm text-slate-600 line-clamp-1 mb-2">${statusText}</p>
      <div class="flex gap-2 flex-wrap">
        ${statusBadge}
        ${isNew ? `<span class="bg-blue-50 text-blue-700 text-[10px] px-2 py-0.5 rounded font-bold border border-blue-100">NUEVO</span>` : ""}
        ${
          isUnread
            ? `<span class="bg-orange-50 text-orange-700 text-[10px] px-2 py-0.5 rounded font-bold border border-orange-100">PENDIENTE</span>`
            : ""
        }
      </div>
    `;
    el.addEventListener("click", () => openConversation(c.id));
    listEl.appendChild(el);
  }
}

function renderMessages() {
  chatEl.innerHTML = "";
  for (const m of state.messages) {
    const el = document.createElement("div");
    const isIncoming = m.sender === "customer" && m.direction === "in";
    const isBot = m.sender === "bot";
    const isAgent = m.sender === "agent";
    const wrapperClass = isIncoming ? "items-end self-end" : "items-start";
    const bubbleClass = isIncoming
      ? "bg-blue-700 text-white rounded-xl rounded-tr-none"
      : "bg-slate-100 text-slate-900 rounded-xl rounded-tl-none";
    const label = isIncoming ? "Cliente" : isBot ? "Bot" : isAgent ? "Asesor" : "Sistema";
    const time = new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    el.className = `flex flex-col ${wrapperClass} max-w-[80%]`;
    const mediaUrl =
      m.contentType === "image" && m.mediaId
        ? `/api/media/${encodeURIComponent(m.mediaId)}?token=${encodeURIComponent(getToken())}`
        : "";
    const mediaHtml = mediaUrl
      ? `<a href="${mediaUrl}" target="_blank" rel="noopener">
          <img
            src="${mediaUrl}"
            class="w-auto h-auto max-w-[320px] max-h-[240px] object-contain rounded-lg border border-slate-200 bg-white cursor-zoom-in"
            loading="lazy"
          />
        </a>`
      : "";
    const textHtml = m.body ? `<div class="whitespace-pre-wrap">${escapeHtml(m.body)}</div>` : "";
    el.innerHTML = `
      <div class="${bubbleClass} p-3 font-chat-text shadow-sm">
        ${mediaHtml}
        ${mediaHtml && textHtml ? `<div class="h-2"></div>` : ""}
        ${textHtml}
      </div>
      <span class="text-[10px] text-slate-400 mt-1 font-mono-data">${label} • ${time}</span>
    `;
    chatEl.appendChild(el);
  }
  chatEl.scrollTop = chatEl.scrollHeight;
}

function updateControls() {
  const c = state.active;
  const has = Boolean(c);
  const canSend = has && c.status === "assigned";
  msgInputEl.disabled = !canSend;
  sendBtnEl.disabled = !canSend;
  setSendEnabled(canSend);
  claimBtnEl.disabled = !(has && c.status === "needs_agent");
  closeBtnEl.disabled = !(has && (c.status === "assigned" || c.status === "needs_agent"));
  chatHeaderEl.textContent = c ? c.waId : "Selecciona un chat";
  chatMetaEl.textContent = c
    ? c.status === "needs_agent"
      ? "En espera de asesor"
      : c.status === "assigned"
        ? "En línea"
        : c.status === "bot"
          ? "Atendido por bot"
          : "Finalizado"
    : "";
  if (chatAvatarEl) chatAvatarEl.textContent = c ? getInitials(c.waId) : "—";
  chatUnreadEl.classList.toggle("hidden", !c || !state.unreadIds.has(c.id));
  updateBadges();
}

function updateBadges() {
  const queueCount = state.queue.length;
  const mineCount = state.mine.length;
  const newQueueCount = state.newQueueIds.size;
  const unreadCount = state.unreadIds.size;

  badgeQueueEl.textContent = queueCount > 0 ? String(queueCount) : "";
  badgeMineEl.textContent = mineCount > 0 ? String(mineCount) : "";
  tabQueueEl.classList.toggle("ring-2", newQueueCount > 0);
  tabQueueEl.classList.toggle("ring-blue-200", newQueueCount > 0);
  tabMineEl.classList.toggle("ring-2", unreadCount > 0);
  tabMineEl.classList.toggle("ring-orange-200", unreadCount > 0);

  const attention = newQueueCount + unreadCount;
  document.title = attention > 0 ? `(${attention}) BotControl - Bandeja` : "BotControl - Bandeja";
}

async function refreshAll() {
  setError("");
  const [queueRes, mineRes] = await Promise.all([
    api(`/api/conversations?status=needs_agent&limit=50&offset=0`),
    api(`/api/conversations?status=assigned&limit=50&offset=0`)
  ]);

  const nextQueue = queueRes.items || [];
  const nextMine = mineRes.items || [];
  const historyClosedRes = await api(`/api/conversations?status=closed&limit=50&offset=0`);
  const nextHistory = historyClosedRes.items || [];

  const nextQueueIds = new Set(nextQueue.map((c) => c.id));
  for (const id of nextQueueIds) {
    if (!state.lastQueueIds.has(id)) state.newQueueIds.add(id);
  }
  for (const id of Array.from(state.newQueueIds)) {
    if (!nextQueueIds.has(id)) state.newQueueIds.delete(id);
  }
  state.lastQueueIds = nextQueueIds;
  state.queue = nextQueue;
  state.mine = nextMine;
  state.history = nextHistory;

  if (state.activeId) {
    const active =
      state.queue.find((x) => x.id === state.activeId) ||
      state.mine.find((x) => x.id === state.activeId) ||
      state.history.find((x) => x.id === state.activeId) ||
      null;
    state.active = active;
  }

  renderList();
  updateControls();
}

async function openConversation(id) {
  setError("");
  state.activeId = id;
  state.active = state.queue.find((x) => x.id === id) || state.mine.find((x) => x.id === id) || state.history.find((x) => x.id === id) || null;
  state.newQueueIds.delete(id);
  renderList();
  updateControls();
  const msgs = await api(`/api/conversations/${encodeURIComponent(id)}/messages?limit=200&offset=0`);
  state.messages = msgs.items;
  renderMessages();
  markReadFromMessages(id, state.messages);
}

async function claimActive() {
  if (!state.activeId) return;
  await api(`/api/conversations/${encodeURIComponent(state.activeId)}/claim`, { method: "POST", body: "{}" });
  await refreshAll();
  await openConversation(state.activeId);
}

async function closeActive() {
  if (!state.activeId) return;
  await api(`/api/conversations/${encodeURIComponent(state.activeId)}/close`, { method: "POST", body: "{}" });
  state.unreadIds.delete(state.activeId);
  state.newQueueIds.delete(state.activeId);
  state.activeId = null;
  state.active = null;
  state.messages = [];
  chatEl.innerHTML = "";
  await refreshAll();
}

async function sendMessage() {
  const text = msgInputEl.value.trim();
  if (!text || !state.activeId) return;
  msgInputEl.value = "";
  await sendText(text);
}

function lastReadKey(conversationId) {
  return `lastRead:${conversationId}`;
}

function markReadFromMessages(conversationId, messages) {
  let lastInboundAt = null;
  for (const m of messages) {
    if (m.sender === "customer" && m.direction === "in") lastInboundAt = m.createdAt;
  }
  if (lastInboundAt) {
    localStorage.setItem(lastReadKey(conversationId), lastInboundAt);
  }
  state.unreadIds.delete(conversationId);
  updateControls();
}

async function maybeMarkUnread(conversationId) {
  if (state.activeId === conversationId) return;
  const isMine = state.mine.some((c) => c.id === conversationId);
  if (!isMine) return;
  const latest = await api(`/api/conversations/${encodeURIComponent(conversationId)}/messages?limit=1&offset=0&order=desc`);
  const msg = (latest.items || [])[0];
  if (!msg) return;
  const isCustomerInbound = msg.sender === "customer" && msg.direction === "in";
  if (!isCustomerInbound) return;
  state.unreadIds.add(conversationId);
  renderList();
  updateControls();
}

function connectWs() {
  const token = getToken();
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
  ws.onmessage = async (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.type === "message.new" || data.type === "conversation.updated") {
        if (data.type === "message.new") await maybeMarkUnread(data.conversationId);
        await refreshAll();
        if (state.activeId && data.conversationId === state.activeId) {
          const msgs = await api(`/api/conversations/${encodeURIComponent(state.activeId)}/messages?limit=200&offset=0`);
          state.messages = msgs.items;
          renderMessages();
          const updated =
            state.queue.find((x) => x.id === state.activeId) ||
            state.mine.find((x) => x.id === state.activeId) ||
            state.history.find((x) => x.id === state.activeId);
          if (updated) state.active = updated;
          markReadFromMessages(state.activeId, state.messages);
          updateControls();
        }
      }
    } catch {}
  };
  ws.onclose = () => {
    setTimeout(connectWs, 1500);
  };
}

document.getElementById("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem("token");
  location.href = "/login.html";
});

tabQueueEl.addEventListener("click", () => setTab("queue"));
tabMineEl.addEventListener("click", () => setTab("mine"));
if (tabHistoryEl) tabHistoryEl.addEventListener("click", () => setTab("history"));
sendBtnEl.addEventListener("click", sendMessage);
claimBtnEl.addEventListener("click", claimActive);
closeBtnEl.addEventListener("click", closeActive);
msgInputEl.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey) {
    ev.preventDefault();
    sendMessage();
  }
});
searchEl.addEventListener("input", () => renderList());

const rightSidebarEl = document.getElementById("rightSidebar");
const toggleRightEl = document.getElementById("toggleRight");
function setRightHidden(hidden) {
  if (!rightSidebarEl) return;
  rightSidebarEl.classList.toggle("hidden", hidden);
  localStorage.setItem("rightHidden", hidden ? "1" : "0");
}
if (toggleRightEl) {
  toggleRightEl.addEventListener("click", () => {
    const hidden = rightSidebarEl?.classList.contains("hidden");
    setRightHidden(!hidden);
  });
}

setRightHidden(localStorage.getItem("rightHidden") === "1");

function setLeftNavHidden(hidden) {
  if (leftNavEl) leftNavEl.style.display = hidden ? "none" : "";
  if (mainWrapEl) mainWrapEl.style.marginLeft = hidden ? "0px" : "260px";
  localStorage.setItem("leftNavHidden", hidden ? "1" : "0");
}

if (toggleLeftNavEl) {
  toggleLeftNavEl.addEventListener("click", () => {
    const hidden = leftNavEl ? leftNavEl.style.display === "none" : false;
    setLeftNavHidden(!hidden);
  });
}

setLeftNavHidden(localStorage.getItem("leftNavHidden") === "1");

const imageInputEl = document.getElementById("imageInput");
const imageBtnEl = document.getElementById("imageBtn");
const imageBtn2El = document.getElementById("imageBtn2");
function openImagePicker() {
  if (imageInputEl) imageInputEl.click();
}
if (imageBtnEl) imageBtnEl.addEventListener("click", openImagePicker);
if (imageBtn2El) imageBtn2El.addEventListener("click", openImagePicker);
if (imageInputEl) {
  imageInputEl.addEventListener("change", async () => {
    const file = imageInputEl.files && imageInputEl.files[0];
    imageInputEl.value = "";
    if (!file || !state.activeId) return;
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch(`/api/conversations/${encodeURIComponent(state.activeId)}/image`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
        body: form
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `http_${res.status}`);
      const msgs = await api(`/api/conversations/${encodeURIComponent(state.activeId)}/messages?limit=200&offset=0`);
      state.messages = msgs.items;
      renderMessages();
    } catch (e) {
      setError(e?.message || String(e));
    }
  });
}

function setSendEnabled(canSend) {
  if (imageBtnEl) imageBtnEl.disabled = !canSend;
  if (imageBtn2El) imageBtn2El.disabled = !canSend;
}

const templatesListEl = document.getElementById("templatesList");
const tplTitleEl = document.getElementById("tplTitle");
const tplBodyEl = document.getElementById("tplBody");
const tplAddBtnEl = document.getElementById("tplAddBtn");

function templatesKey() {
  return "quickTemplates:v1";
}

function loadTemplates() {
  const defaults = [
    { id: "d1", title: "Saludo", text: "Hola. Gracias por contactarnos. ¿En qué te puedo ayudar?" },
    { id: "d2", title: "Diagnóstico", text: "¿Cuál es el módulo/pantalla? ¿Qué error exacto te aparece y qué pasos hiciste antes?" },
    { id: "d3", title: "Escalar", text: "Perfecto, voy a escalar este caso. Un momento por favor." }
  ];
  const raw = localStorage.getItem(templatesKey());
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaults;
    const custom = parsed
      .filter((x) => x && typeof x.id === "string" && typeof x.title === "string" && typeof x.text === "string")
      .map((x) => ({ id: x.id, title: x.title, text: x.text }));
    return defaults.concat(custom);
  } catch {
    return defaults;
  }
}

function saveCustomTemplates(templates) {
  const custom = templates.filter((t) => !String(t.id).startsWith("d"));
  localStorage.setItem(templatesKey(), JSON.stringify(custom));
}

let templates = loadTemplates();

function renderTemplates() {
  if (!templatesListEl) return;
  templatesListEl.innerHTML = "";
  for (const t of templates) {
    const row = document.createElement("div");
    row.className = "flex gap-2";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "flex-1 text-left p-3 text-xs bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 text-slate-700 transition-colors";
    btn.innerHTML = `<div class="font-bold mb-1">${escapeHtml(t.title)}</div><div class="text-slate-600 line-clamp-2">${escapeHtml(
      t.text
    )}</div>`;
    btn.addEventListener("click", async () => {
      if (!state.activeId) return;
      if (msgInputEl.disabled) {
        msgInputEl.value = t.text;
        return;
      }
      await sendText(t.text);
    });

    row.appendChild(btn);

    if (!String(t.id).startsWith("d")) {
      const del = document.createElement("button");
      del.type = "button";
      del.className =
        "w-10 flex items-center justify-center bg-white border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50";
      del.innerHTML = `<span class="material-symbols-outlined text-[18px]">delete</span>`;
      del.addEventListener("click", () => {
        templates = templates.filter((x) => x.id !== t.id);
        saveCustomTemplates(templates);
        renderTemplates();
      });
      row.appendChild(del);
    }

    templatesListEl.appendChild(row);
  }
}

async function sendText(text) {
  if (!text || !state.activeId) return;
  try {
    await api(`/api/conversations/${encodeURIComponent(state.activeId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ text })
    });
    const msgs = await api(`/api/conversations/${encodeURIComponent(state.activeId)}/messages?limit=200&offset=0`);
    state.messages = msgs.items;
    renderMessages();
    markReadFromMessages(state.activeId, state.messages);
  } catch (e) {
    setError(e?.message || String(e));
  }
}

if (tplAddBtnEl) {
  tplAddBtnEl.addEventListener("click", () => {
    const title = String(tplTitleEl?.value || "").trim();
    const text = String(tplBodyEl?.value || "").trim();
    if (!title || !text) return;
    const id = `c_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    templates = templates.concat([{ id, title, text }]);
    saveCustomTemplates(templates);
    if (tplTitleEl) tplTitleEl.value = "";
    if (tplBodyEl) tplBodyEl.value = "";
    renderTemplates();
  });
}

renderTemplates();

(async function init() {
  try {
    if (!getToken()) {
      location.href = "/login.html";
      return;
    }
    await loadMe();
    await refreshAll();
    connectWs();
    setTab("queue");
  } catch (e) {
    setError(e?.message || String(e));
    if ((e?.message || "").includes("unauthorized")) {
      localStorage.removeItem("token");
      location.href = "/login.html";
    }
  }
})();

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getInitials(waId) {
  const digits = String(waId || "").replace(/\D/g, "");
  if (!digits) return "WA";
  return digits.slice(-2).padStart(2, "0");
}
