(() => {
  const POLL_MS = 15000;
  const $ = (id) => document.getElementById(id);
  const state = { items: [], version: -1, tab: "open", q: "", team: "", period: "week", loaded: false };
  let editingId = null, resolvingId = null, deletingId = null, pollTimer = null, lastSync = 0;

  // ---------- Nome do usuário (guardado só neste navegador) ----------
  function getName() { try { return localStorage.getItem("atd_name") || ""; } catch { return ""; } }
  function setName(n) { try { localStorage.setItem("atd_name", n); } catch {} }

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
      id: str(x.id), link: str(x.link), desc: str(x.desc), team: str(x.team).trim(), note: str(x.note),
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
    pollTimer = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
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

    if (!state.loaded) return;
    const q = state.q.trim().toLowerCase();
    const match = (i) => (!state.team || i.team === state.team) &&
      (!q || (i.desc + " " + i.link + " " + i.team + " " + i.note).toLowerCase().includes(q));
    const content = $("content");

    if (state.tab === "open") {
      const list = open.filter(match).sort((a, b) => a.createdAt - b.createdAt);
      const older = list.filter((i) => i.createdAt < start);
      const thisWeek = list.filter((i) => i.createdAt >= start);
      if (!list.length) {
        content.replaceChildren(el("div", { class: "empty" },
          open.length ? "Nenhum atendimento em aberto com esses filtros." : "Nenhum atendimento em aberto. Use “Novo atendimento” para incluir um link em análise."));
        return;
      }
      const parts = [];
      if (older.length) parts.push(el("div", { class: "group-title" }, "Pendentes de semanas anteriores · " + older.length), el("div", { class: "list" }, older.map((i) => card(i, true))));
      if (thisWeek.length) parts.push(el("div", { class: "group-title" }, "Incluídos esta semana · " + thisWeek.length), el("div", { class: "list" }, thisWeek.map((i) => card(i, false))));
      content.replaceChildren(el("div", { style: "display:grid;gap:16px" }, parts));
    } else {
      let list = done.filter(match);
      if (state.period === "week") list = list.filter((i) => i.resolvedAt >= start);
      else if (state.period === "last") list = list.filter((i) => i.resolvedAt >= prevStart && i.resolvedAt < start);
      list.sort((a, b) => b.resolvedAt - a.resolvedAt);
      if (!list.length) {
        content.replaceChildren(el("div", { class: "empty" },
          state.period === "week" ? "Nenhum atendimento resolvido nesta semana ainda." :
          state.period === "last" ? "Nenhum atendimento resolvido na semana passada." : "O histórico de resolvidos está vazio."));
        return;
      }
      content.replaceChildren(el("div", { class: "list" }, list.map((i) => card(i, false))));
    }
  }

  function card(i, late) {
    const resolved = i.status === "resolvido";
    const url = safeUrl(i.link);
    const statusPill = resolved ? el("span", { class: "pill done" }, "Resolvido")
      : late ? el("span", { class: "pill late" }, "Aberto " + ageText(i.createdAt))
      : el("span", { class: "pill open" }, "Em análise");
    const meta = [statusPill, el("span", { class: "pill team" }, i.team || "Sem equipe")];
    meta.push(el("span", null, resolved
      ? "Resolvido em " + fmtFull.format(new Date(i.resolvedAt)) + (i.resolvedBy ? " por " + i.resolvedBy : "") + " · levou " + durText(i.createdAt, i.resolvedAt)
      : "Incluído em " + fmtFull.format(new Date(i.createdAt)) + (i.createdBy ? " por " + i.createdBy : "")));
    const actions = resolved
      ? [el("button", { class: "btn ghost", type: "button", onclick: () => reopen(i) }, "Reabrir")]
      : [el("button", { class: "btn ok", type: "button", onclick: () => openResolve(i) }, "Concluir"),
         el("button", { class: "btn ghost", type: "button", onclick: () => openEdit(i) }, "Editar")];
    actions.push(el("button", { class: "btn ghost", type: "button", onclick: () => openDelete(i), "aria-label": "Excluir atendimento" }, "Excluir"));
    return el("article", { class: "card" + (resolved ? " resolved" : late ? " late" : "") },
      el("div", { style: "display:grid;gap:6px;min-width:0" },
        el("div", { class: "meta" }, meta),
        url ? el("a", { class: "link", href: url, target: "_blank", rel: "noopener noreferrer", title: url }, shortUrl(url)) : el("span", { class: "link" }, i.link),
        el("p", { class: "desc" }, i.desc)),
      el("div", { class: "actions" }, actions),
      resolved && i.note ? el("div", { class: "note" }, el("b", null, "Solução: "), i.note) : null);
  }

  // ---------- Ações ----------
  function openEdit(i) {
    editingId = i ? i.id : null;
    $("editTitle").textContent = i ? "Editar atendimento" : "Novo atendimento";
    $("fLink").value = i ? i.link : "";
    $("fDesc").value = i ? i.desc : "";
    $("fTeam").value = i ? i.team : (state.team || "");
    $("editErr").textContent = "";
    $("editDlg").showModal();
    $("fLink").focus();
  }
  $("editForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const link = $("fLink").value.trim(), desc = $("fDesc").value.trim(), team = $("fTeam").value.trim();
    const err = $("editErr");
    if (!safeUrl(link)) { err.textContent = "Informe um link válido começando com http:// ou https://"; return; }
    if (!desc) { err.textContent = "Descreva o que está ocorrendo."; return; }
    if (!team) { err.textContent = "Informe a equipe responsável."; return; }
    $("editSave").disabled = true;
    try {
      if (editingId) await api("/api/atendimentos/" + editingId, { method: "PATCH", body: { action: "edit", link, desc, team } });
      else { await api("/api/atendimentos", { method: "POST", body: { link, desc, team, author: getName() } }); state.tab = "open"; }
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
  $("periodFilter").addEventListener("change", (e) => { state.period = e.target.value; render(); });

  // ---------- Início ----------
  render();
  if (getName()) enterApp(); else showLogin();
})();
