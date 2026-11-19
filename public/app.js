(() => {
  const POLL_MS = 15000;
  const $ = (id) => document.getElementById(id);
  const PRIO = { urgente: { label: "Urgente", rank: 0 }, alta: { label: "Alta", rank: 1 }, media: { label: "Média", rank: 2 }, baixa: { label: "Baixa", rank: 3 } };
  const prioRank = (i) => (PRIO[i.priority] ? PRIO[i.priority].rank : 2);
  const state = { items: [], version: -1, tab: "open", q: "", team: "", prio: "", period: "week", loaded: false };
  let editingOriginalDate = null, editingId = null, resolvingId = null, deletingId = null, pollTimer = null, lastSync = 0;

  // ---------- Nome do usuário (guardado só neste navegador) ----------
  function getName() { try { return localStorage.getItem("atd_name") || ""; } catch { return ""; } }
  function setName(n) { try { localStorage.setItem("atd_name", n); } catch {} }

  // ---------- Cartões minimizados (guardado só neste navegador) ----------
  const collapsed = new Set((() => { try { return JSON.parse(localStorage.getItem("atd_collapsed") || "[]"); } catch { return []; } })());
  function saveCollapsed() { try { localStorage.setItem("atd_collapsed", JSON.stringify([...collapsed])); } catch {} }
  let visibleIds = [];

  // ---------- Notificações vistas (guardado só neste navegador) ----------
  const BASE_TITLE = document.title;
  function loadJSON(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } }
  function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  const seen = loadJSON("atd_seen", {});
  let seenBase = loadJSON("atd_seen_base", 0);
  if (!seenBase) { seenBase = Date.now(); saveJSON("atd_seen_base", seenBase); }
  let knownNotifIds = null; // ids já mostrados nesta visita (null = primeira carga)
  const notifsOf = (i) => i.notifications;
  const latestNotif = (i) => i.notifications[i.notifications.length - 1] || null;
  function isUnseen(i, n) {
    return n.at > Math.max(seen[i.id] || 0, seenBase) && n.by !== getName();
  }
  const unseenOf = (i) => notifsOf(i).filter((n) => isUnseen(i, n));
  function markSeen(i) {
    const last = latestNotif(i);
    if (!last) return;
    seen[i.id] = Math.max(seen[i.id] || 0, last.at);
    saveJSON("atd_seen", seen);
  }

  // ---------- API ----------
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || "GET",
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(data.error || "Erro " + res.status);
    return data;
  }

  // ---------- Semana (segunda a domingo) ----------
  const DAY = 86400000;
  function weekStart(d) {
    const x = new Date(d); x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x.getTime();
  }
  const fmtDay = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });
  const fmtFull = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const fmtDate = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const fmtTime = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  function weekRange() { const s = weekStart(Date.now()); return { start: s, end: s + 7 * DAY, prevStart: s - 7 * DAY }; }
  function ageText(ms) { const d = Math.floor((Date.now() - ms) / DAY); return d <= 0 ? "hoje" : d === 1 ? "há 1 dia" : "há " + d + " dias"; }
  function durText(a, b) { const h = Math.max(0, (b - a) / 3600000); return h < 1 ? "menos de 1 h" : h < 48 ? Math.round(h) + " h" : Math.round(h / 24) + " dias"; }

  // ---------- Util ----------
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : String(k));
    return e;
  }
  function safeUrl(u) { try { const x = new URL(String(u)); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } }
  function shortUrl(u) { try { const x = new URL(u); const s = x.host + (x.pathname + x.search).replace(/\/$/, ""); return s.length > 70 ? s.slice(0, 67) + "…" : s; } catch { return String(u); } }
  const str = (v) => (typeof v === "string" ? v : "");
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);
  function normalize(x) {
    return {
      id: str(x.id), link: str(x.link), youtrack: str(x.youtrack),
      notifications: Array.isArray(x.notifications) ? x.notifications.filter((n) => n && typeof n === "object").map((n) => ({ id: str(n.id) || String(n.at), at: num(n.at), by: str(n.by), message: str(n.message) })) : [],
      priority: PRIO[x.priority] ? x.priority : "", desc: str(x.desc), team: str(x.team).trim(), note: str(x.note),
      status: x.status === "resolvido" ? "resolvido" : "aberto",
      createdAt: num(x.createdAt), resolvedAt: num(x.resolvedAt),
      createdBy: str(x.createdBy), resolvedBy: str(x.resolvedBy),
    };
  }
  function showBanner(msg) { const b = $("banner"); b.textContent = msg || ""; b.hidden = !msg; }

  // ---------- Sincronização automática ----------
  async function refresh() {
    try {
      const data = await api("/api/atendimentos" + (state.loaded ? "?since=" + state.version : ""));
      lastSync = Date.now();
      showBanner("");
      if (!data.unchanged && (data.version !== state.version || !state.loaded)) {
        state.items = (data.items || []).map(normalize);
        state.version = data.version;
        state.loaded = true;
        detectNewNotifications();
        render();
      }
      $("sync").textContent = "atualizado às " + fmtTime.format(new Date(lastSync));
    } catch (e) {
      if ($("login").hidden) {
        showBanner(state.loaded ? "Sem conexão com o servidor. Os dados podem estar desatualizados; tentando de novo." : e.message);
        $("sync").textContent = "sem conexão";
      }
    }
  }
  function startPolling() {
    stopPolling();
    refresh();
    pollTimer = setInterval(() => {
      if (!document.hidden) refresh();
      else if (alertsOn() && Date.now() - lastSync > 60000) refresh(); // em segundo plano: a cada 1 min
    }, POLL_MS);
  }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && pollTimer) refresh(); });
  window.addEventListener("focus", () => { if (pollTimer) refresh(); });

  // ---------- Nome ----------
  function showLogin() {
    stopPolling();
    $("lName").value = getName();
    $("loginErr").textContent = "";
    $("login").hidden = false;
    $("lName").focus();
  }
  function enterApp() {
    $("login").hidden = true;
    $("whoami").textContent = getName() ? "Olá, " + getName() : "";
    startPolling();
  }
  $("loginForm").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const name = $("lName").value.trim();
    if (!name) { $("loginErr").textContent = "Informe seu nome."; return; }
    setName(name);
    enterApp();
  });
  $("logoutBtn").onclick = () => showLogin();

  // ---------- Render ----------
  function render() {
    const { start, end, prevStart } = weekRange();
    $("weekLabel").textContent = "Semana de " + fmtDay.format(new Date(start)) + " a " + fmtDay.format(new Date(end - DAY));
    const items = state.items;
    const open = items.filter((i) => i.status !== "resolvido");
    const done = items.filter((i) => i.status === "resolvido");
    $("sOpen").textContent = open.length;
    $("sNew").textContent = items.filter((i) => i.createdAt >= start).length;
    $("sDone").textContent = done.filter((i) => i.resolvedAt >= start).length;
    $("sLate").textContent = open.filter((i) => i.createdAt < start).length;
    $("cOpen").textContent = "(" + open.length + ")";
    $("cDone").textContent = "(" + done.length + ")";

    const teams = [...new Set(items.map((i) => i.team).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    const tf = $("teamFilter"), cur = state.team;
    tf.replaceChildren(el("option", { value: "" }, "Todas as equipes"), ...teams.map((t) => el("option", { value: t }, t)));
    tf.value = teams.includes(cur) ? cur : "";
    state.team = tf.value;
    $("teamList").replaceChildren(...teams.map((t) => el("option", { value: t })));

    $("tabOpen").setAttribute("aria-selected", state.tab === "open");
    $("tabDone").setAttribute("aria-selected", state.tab === "done");
    $("periodFilter").hidden = state.tab !== "done";
    $("dateRange").hidden = state.tab !== "done" || state.period !== "custom";

    renderBell();
    if (!state.loaded) return;
    const q = state.q.trim().toLowerCase();
    const match = (i) => (!state.team || i.team === state.team) && (!state.prio || i.priority === state.prio) &&
      (!q || (i.desc + " " + i.link + " " + i.youtrack + " " + i.team + " " + i.note).toLowerCase().includes(q));
    const content = $("content");

    if (state.tab === "open") {
      const list = open.filter(match).sort((a, b) => prioRank(a) - prioRank(b) || a.createdAt - b.createdAt);
      const older = list.filter((i) => i.createdAt < start);
      const thisWeek = list.filter((i) => i.createdAt >= start);
      if (!list.length) {
        visibleIds = []; updateCollapseAll();
        content.replaceChildren(el("div", { class: "empty" },
          open.length ? "Nenhum atendimento em aberto com esses filtros." : "Nenhum atendimento em aberto. Use “Novo atendimento” para incluir um link em análise."));
        return;
      }
      visibleIds = list.map((i) => i.id);
      updateCollapseAll();
      const parts = [];
      if (older.length) parts.push(el("div", { class: "group-title" }, "Pendentes de semanas anteriores · " + older.length), el("div", { class: "list" }, older.map((i) => card(i, true))));
      if (thisWeek.length) parts.push(el("div", { class: "group-title" }, "Incluídos esta semana · " + thisWeek.length), el("div", { class: "list" }, thisWeek.map((i) => card(i, false))));
      content.replaceChildren(el("div", { style: "display:grid;gap:16px" }, parts));
    } else {
      let list = done.filter(match);
      if (state.period === "week") list = list.filter((i) => i.resolvedAt >= start);
      else if (state.period === "last") list = list.filter((i) => i.resolvedAt >= prevStart && i.resolvedAt < start);
      else if (state.period === "custom") {
        const r = customRange();
        if (r) list = list.filter((i) => i.resolvedAt >= r.from && i.resolvedAt < r.to);
      }
      list.sort((a, b) => b.resolvedAt - a.resolvedAt);
      visibleIds = list.map((i) => i.id);
      updateCollapseAll();
      if (!list.length) {
        content.replaceChildren(el("div", { class: "empty" },
          state.period === "week" ? "Nenhum atendimento resolvido nesta semana ainda." :
          state.period === "last" ? "Nenhum atendimento resolvido na semana passada." :
          state.period === "custom" ? (customRange() ? "Nenhum atendimento resolvido " + customRangeLabel() + "." : "Escolha a data inicial para ver os resolvidos.") : "O histórico de resolvidos está vazio."));
        return;
      }
      content.replaceChildren(el("div", { class: "list" }, list.map((i) => card(i, false))));
    }
  }

  const CHEVRON = '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function linkRow(label, raw) {
    const url = safeUrl(raw);
    return el("div", { class: "link-row" },
      el("span", { class: "src" }, label),
      url ? el("a", { class: "link", href: url, target: "_blank", rel: "noopener noreferrer", title: url }, shortUrl(url)) : el("span", { class: "link" }, raw));
  }

  function card(i, late) {
    const resolved = i.status === "resolvido";
    const isCollapsed = collapsed.has(i.id);
    const statusPill = resolved ? el("span", { class: "pill done" }, "Resolvido")
      : late ? el("span", { class: "pill late" }, "Aberto " + ageText(i.createdAt))
      : el("span", { class: "pill open" }, "Em análise");
    const prioPill = i.priority ? el("span", { class: "prio p-" + i.priority, title: "Prioridade " + PRIO[i.priority].label }, PRIO[i.priority].label) : null;
    const meta = [statusPill, el("span", { class: "pill team" }, i.team || "Sem equipe")];
    meta.push(el("span", null, resolved
      ? "Resolvido em " + fmtFull.format(new Date(i.resolvedAt)) + (i.resolvedBy ? " por " + i.resolvedBy : "") + " · levou " + durText(i.createdAt, i.resolvedAt)
      : "Aberto em " + fmtDate.format(new Date(i.createdAt)) + (i.createdBy ? " · incluído por " + i.createdBy : "")));
    const actions = resolved
      ? [el("button", { class: "btn ghost", type: "button", onclick: () => reopen(i) }, "Reabrir")]
      : [el("button", { class: "btn ok", type: "button", onclick: () => openResolve(i) }, "Concluir"),
         el("button", { class: "btn ghost", type: "button", onclick: () => openEdit(i) }, "Editar")];
    actions.splice(resolved ? 1 : 2, 0, el("button", { class: "btn ghost notify", type: "button", onclick: () => openNotify(i), title: "Avisar os outros usuários que este atendimento teve atualização" }, "Notificar"));
    actions.push(el("button", { class: "btn ghost", type: "button", onclick: () => openDelete(i), "aria-label": "Excluir atendimento" }, "Excluir"));

    const unseen = unseenOf(i);
    const last = latestNotif(i);
    let upd = null;
    if (last) {
      const isNew = unseen.length > 0;
      const box = el("div", { class: "upd" + (isNew ? "" : " seen") });
      box.innerHTML = BELL;
      box.append(
        el("div", { class: "upd-text" },
          el("div", null, last.message || "Atendimento atualizado."),
          el("div", { class: "upd-when" }, (isNew ? "Nova atualização" : "Última atualização") + (last.by ? " de " + last.by : "") + " · " + relTime(last.at) + (unseen.length > 1 ? " · " + unseen.length + " não vistas" : ""))),
        isNew ? el("button", { class: "btn", type: "button", onclick: () => { markSeen(i); render(); } }, "Marcar como vista") : null);
      upd = box;
    }
    const newBadge = unseen.length ? el("span", { class: "new-badge", title: "Este atendimento teve atualização" }, unseen.length > 1 ? unseen.length + " atualizações" : "Atualizado") : null;

    const toggle = el("button", {
      class: "toggle", type: "button",
      "aria-expanded": String(!isCollapsed),
      "aria-label": isCollapsed ? "Expandir detalhes" : "Minimizar detalhes",
      title: isCollapsed ? "Expandir" : "Minimizar",
      onclick: () => { if (collapsed.has(i.id)) collapsed.delete(i.id); else collapsed.add(i.id); saveCollapsed(); render(); },
    });
    toggle.innerHTML = CHEVRON;

    return el("article", { "data-id": i.id, class: "card" + (resolved ? " resolved" : late ? " late" : "") + (isCollapsed ? " collapsed" : "") + (i.priority === "urgente" && !resolved ? " prio-urgente" : "") + (unseen.length ? " has-new" : "") },
      el("div", { style: "display:grid;gap:6px;min-width:0" },
        el("div", { class: "head" }, toggle, prioPill, newBadge,
          el("div", { class: "links" },
            linkRow("Zendesk", i.link),
            !isCollapsed && i.youtrack ? linkRow("YouTrack", i.youtrack) : null)),
        el("div", { class: "body" },
          el("div", { class: "meta" }, meta),
          el("p", { class: "desc" }, i.desc),
          upd)),
      el("div", { class: "actions" }, actions),
      resolved && i.note ? el("div", { class: "note" }, el("b", null, "Solução: "), i.note) : null);
  }

  function updateCollapseAll() {
    const btn = $("collapseAll");
    const allCollapsed = visibleIds.length > 0 && visibleIds.every((id) => collapsed.has(id));
    btn.textContent = allCollapsed ? "Expandir todos" : "Minimizar todos";
    btn.disabled = visibleIds.length === 0;
  }
  $("collapseAll").onclick = () => {
    const allCollapsed = visibleIds.every((id) => collapsed.has(id));
    for (const id of visibleIds) { if (allCollapsed) collapsed.delete(id); else collapsed.add(id); }
    saveCollapsed(); render();
  };

  // ---------- Notificações ----------
  const BELL = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function relTime(ms) {
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return "agora";
    if (m < 60) return "há " + m + " min";
    const h = Math.round(m / 60);
    if (h < 24) return "há " + h + " h";
    return fmtFull.format(new Date(ms));
  }
  function allUnseen() {
    const out = [];
    for (const i of state.items) for (const n of unseenOf(i)) out.push({ i, n });
    return out.sort((a, b) => b.n.at - a.n.at);
  }
  function renderBell() {
    const list = state.loaded ? allUnseen() : [];
    const count = list.length;
    $("bellCount").hidden = count === 0;
    $("bellCount").textContent = count > 99 ? "99+" : String(count);
    $("bellBtn").classList.toggle("has-new", count > 0);
    $("bellBtn").setAttribute("aria-label", count ? count + " notificações não vistas" : "Notificações");
    document.title = (count ? "(" + count + ") " : "") + BASE_TITLE;
    $("markAllSeen").disabled = count === 0;
    const box = $("notifList");
    if (!count) { box.replaceChildren(el("div", { class: "np-empty" }, "Nenhuma notificação nova.")); }
    else box.replaceChildren(...list.slice(0, 30).map(({ i, n }) =>
      el("button", { class: "np-item", type: "button", onclick: () => { closePanel(); goToItem(i.id); } },
        el("span", { class: "np-link" }, shortUrl(i.link)),
        el("span", { class: "np-msg" }, n.message || "Atendimento atualizado."),
        el("span", { class: "np-when" }, (n.by ? n.by + " · " : "") + relTime(n.at) + (i.team ? " · " + i.team : "")))));
    renderAlertsBtn();
  }
  function detectNewNotifications() {
    const fresh = allUnseen();
    if (knownNotifIds === null) { knownNotifIds = new Set(fresh.map((x) => x.n.id)); return; }
    const added = fresh.filter((x) => !knownNotifIds.has(x.n.id));
    for (const x of fresh) knownNotifIds.add(x.n.id);
    for (const { i, n } of added.slice(0, 3)) {
      const title = (n.by || "Alguém") + " atualizou um atendimento";
      const body = (n.message || "Atendimento atualizado.") + " — " + shortUrl(i.link);
      toast(title, body, () => goToItem(i.id));
      if (alertsOn() && document.hidden) {
        try { const bn = new Notification(title, { body, tag: n.id }); bn.onclick = () => { window.focus(); goToItem(i.id); bn.close(); }; } catch {}
      }
    }
  }
  function toast(title, body, onclick) {
    const t = el("button", { class: "toast", type: "button" }, el("b", null, title), el("span", null, body), el("small", null, "Clique para ver"));
    t.onclick = () => { t.remove(); if (onclick) onclick(); };
    $("toasts").append(t);
    setTimeout(() => t.remove(), 9000);
  }
  function goToItem(id) {
    const i = state.items.find((x) => x.id === id);
    if (!i) return;
    markSeen(i);
    state.tab = i.status === "resolvido" ? "done" : "open";
    if (i.status === "resolvido") state.period = "all", $("periodFilter").value = "all";
    state.q = ""; $("q").value = ""; state.team = ""; state.prio = ""; $("prioFilter").value = "";
    collapsed.delete(id); saveCollapsed();
    render();
    const node = document.querySelector('.card[data-id="' + CSS.escape(id) + '"]');
    if (node) { node.scrollIntoView({ behavior: "smooth", block: "center" }); node.classList.add("flash"); setTimeout(() => node.classList.remove("flash"), 1300); }
  }
  // Painel do sino
  function closePanel() { $("notifPanel").hidden = true; $("bellBtn").setAttribute("aria-expanded", "false"); }
  $("bellBtn").onclick = (e) => {
    e.stopPropagation();
    const open = $("notifPanel").hidden;
    $("notifPanel").hidden = !open;
    $("bellBtn").setAttribute("aria-expanded", String(open));
    if (open) placePanel();
  };
  function placePanel() {
    const panel = $("notifPanel"), r = $("bellBtn").getBoundingClientRect();
    const w = panel.offsetWidth;
    const left = Math.min(Math.max(16, r.right - w), window.innerWidth - w - 16);
    panel.style.left = Math.max(16, left) + "px";
    panel.style.top = (r.bottom + 8) + "px";
  }
  window.addEventListener("resize", () => { if (!$("notifPanel").hidden) placePanel(); });
  window.addEventListener("scroll", () => { if (!$("notifPanel").hidden) placePanel(); }, { passive: true });
  document.addEventListener("click", (e) => { if (!$("notifPanel").hidden && !e.target.closest(".bell-wrap")) closePanel(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePanel(); });
  $("markAllSeen").onclick = () => { for (const i of state.items) markSeen(i); render(); };
  // Alertas do navegador
  function alertsOn() { return "Notification" in window && Notification.permission === "granted"; }
  function renderAlertsBtn() {
    const b = $("enableAlerts");
    if (!("Notification" in window)) { b.textContent = "Este navegador não suporta alertas"; b.disabled = true; }
    else if (Notification.permission === "granted") { b.textContent = "Alertas do navegador ativados"; b.disabled = true; }
    else if (Notification.permission === "denied") { b.textContent = "Alertas bloqueados nas configurações do navegador"; b.disabled = true; }
    else { b.textContent = "Ativar alertas do navegador"; b.disabled = false; }
  }
  $("enableAlerts").onclick = async () => { try { await Notification.requestPermission(); } catch {} renderAlertsBtn(); };
  // Enviar notificação
  let notifyingId = null;
  function openNotify(i) {
    notifyingId = i.id;
    $("notifySummary").textContent = shortUrl(i.link) + " · " + (i.desc.length > 100 ? i.desc.slice(0, 97) + "…" : i.desc);
    $("fNotify").value = ""; $("notifyErr").textContent = "";
    $("notifyDlg").showModal(); $("fNotify").focus();
  }
  $("notifyForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    $("notifySave").disabled = true;
    try {
      await api("/api/atendimentos/" + notifyingId, { method: "PATCH", body: { action: "notify", message: $("fNotify").value.trim(), author: getName() } });
      $("notifyDlg").close();
      await refresh();
      toast("Notificação enviada", "Os outros usuários verão o aviso neste atendimento.");
    } catch (e) { $("notifyErr").textContent = e.message; }
    finally { $("notifySave").disabled = false; }
  });
  $("notifyCancel").onclick = () => $("notifyDlg").close();

  // ---------- Período escolhido no histórico ----------
  function dayStart(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null;
  }
  function customRange() {
    const from = dayStart($("dFrom").value);
    if (from == null) return null;
    let toDay = dayStart($("dTo").value);
    if (toDay == null || toDay < from) toDay = from;
    const to = new Date(toDay); to.setDate(to.getDate() + 1);
    return { from, to: to.getTime() };
  }
  function customRangeLabel() {
    const r = customRange();
    const a = fmtDate.format(new Date(r.from)), b = fmtDate.format(new Date(r.to - 1));
    return a === b ? "em " + a : "de " + a + " a " + b;
  }

  // ---------- Datas do formulário ----------
  function toInputDate(ms) {
    const d = new Date(ms);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function fromInputDate(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || "");
    if (!m) return null;
    if (v === toInputDate(Date.now())) return Date.now();
    return new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0).getTime();
  }

  // ---------- Ações ----------
  function openEdit(i) {
    editingId = i ? i.id : null;
    $("editTitle").textContent = i ? "Editar atendimento" : "Novo atendimento";
    $("fLink").value = i ? i.link : "";
    $("fYt").value = i ? i.youtrack : "";
    const pr = (i && i.priority) || "media";
    for (const r of document.querySelectorAll('input[name="fPrio"]')) r.checked = r.value === pr;
    $("fDate").value = toInputDate(i ? i.createdAt : Date.now());
    $("fDate").max = toInputDate(Date.now());
    editingOriginalDate = i ? toInputDate(i.createdAt) : null;
    $("fDesc").value = i ? i.desc : "";
    $("fTeam").value = i ? i.team : (state.team || "");
    $("editErr").textContent = "";
    $("editDlg").showModal();
    $("fLink").focus();
  }
  $("editForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const link = $("fLink").value.trim(), youtrack = $("fYt").value.trim(), desc = $("fDesc").value.trim(), team = $("fTeam").value.trim();
    const dateStr = $("fDate").value;
    const checked = document.querySelector('input[name="fPrio"]:checked');
    const priority = checked ? checked.value : "";
    const err = $("editErr");
    if (!safeUrl(link)) { err.textContent = "Informe um link do Zendesk válido, começando com http:// ou https://"; return; }
    if (!priority) { err.textContent = "Escolha a prioridade."; return; }
    if (youtrack && !safeUrl(youtrack)) { err.textContent = "O link do YouTrack precisa começar com http:// ou https://"; return; }
    const createdAt = fromInputDate(dateStr);
    if (!createdAt) { err.textContent = "Informe a data de abertura."; return; }
    if (dateStr > toInputDate(Date.now())) { err.textContent = "A data de abertura não pode ser no futuro."; return; }
    if (!desc) { err.textContent = "Descreva o que está ocorrendo."; return; }
    if (!team) { err.textContent = "Informe a equipe responsável."; return; }
    $("editSave").disabled = true;
    try {
      if (editingId) await api("/api/atendimentos/" + editingId, { method: "PATCH", body: Object.assign({ action: "edit", link, youtrack, priority, desc, team }, dateStr !== editingOriginalDate ? { createdAt } : {}) });
      else { await api("/api/atendimentos", { method: "POST", body: { link, youtrack, priority, desc, team, createdAt, author: getName() } }); state.tab = "open"; }
      $("editDlg").close();
      await refresh();
    } catch (e) { err.textContent = e.message; }
    finally { $("editSave").disabled = false; }
  });

  function openResolve(i) {
    resolvingId = i.id;
    $("doneSummary").textContent = i.team + " · " + (i.desc.length > 120 ? i.desc.slice(0, 117) + "…" : i.desc);
    $("fNote").value = ""; $("doneErr").textContent = "";
    $("doneDlg").showModal(); $("fNote").focus();
  }
  $("doneForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    $("doneSave").disabled = true;
    try {
      await api("/api/atendimentos/" + resolvingId, { method: "PATCH", body: { action: "resolve", note: $("fNote").value.trim(), author: getName() } });
      $("doneDlg").close();
      await refresh();
    } catch (e) { $("doneErr").textContent = e.message; }
    finally { $("doneSave").disabled = false; }
  });

  async function reopen(i) {
    try { await api("/api/atendimentos/" + i.id, { method: "PATCH", body: { action: "reopen" } }); state.tab = "open"; await refresh(); render(); }
    catch (e) { showBanner(e.message); }
  }

  function openDelete(i) { deletingId = i.id; $("delErr").textContent = ""; $("delDlg").showModal(); }
  $("delForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try { await api("/api/atendimentos/" + deletingId, { method: "DELETE" }); $("delDlg").close(); await refresh(); }
    catch (e) { $("delErr").textContent = e.message; }
  });

  $("editCancel").onclick = () => $("editDlg").close();
  $("doneCancel").onclick = () => $("doneDlg").close();
  $("delCancel").onclick = () => $("delDlg").close();
  $("addBtn").onclick = () => openEdit(null);
  $("tabOpen").onclick = () => { state.tab = "open"; render(); };
  $("tabDone").onclick = () => { state.tab = "done"; render(); };
  $("q").addEventListener("input", (e) => { state.q = e.target.value; render(); });
  $("teamFilter").addEventListener("change", (e) => { state.team = e.target.value; render(); });
  $("prioFilter").addEventListener("change", (e) => { state.prio = e.target.value; render(); });
  $("periodFilter").addEventListener("change", (e) => {
    state.period = e.target.value;
    if (state.period === "custom" && !$("dFrom").value) {
      $("dFrom").value = toInputDate(Date.now());
      $("dFrom").max = $("dTo").max = toInputDate(Date.now());
    }
    render();
    if (state.period === "custom") $("dFrom").focus();
  });
  $("dFrom").addEventListener("change", () => { $("dTo").min = $("dFrom").value; render(); });
  $("dTo").addEventListener("change", render);

  setInterval(() => { if (state.loaded && !document.hidden) render(); }, 60000); // atualiza "há X min"

  // ---------- Início ----------
  render();
  if (getName()) enterApp(); else showLogin();
})();
