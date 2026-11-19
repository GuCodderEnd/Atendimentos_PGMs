import { listInbox, inboxVersion, markRead } from "../lib/inbox.js";
import { send, body, protectedRoute } from "../lib/http.js";

// GET  [?since=N] -> notificações do usuário logado (mais novas primeiro)
// POST { action: "read", ids?: [], itemId?: "", all?: true }
export default protectedRoute(async (req, res) => {
  const me = req.user.username;
  if (req.method === "GET") {
    const since = Number(req.query && req.query.since);
    if (Number.isFinite(since) && since >= 0) {
      const version = await inboxVersion(me);
      if (version === since) return send(res, 200, { version, unchanged: true });
    }
    const { items, version } = await listInbox(me);
    return send(res, 200, { version, items: items.slice(0, 100) });
  }
  if (req.method === "POST") {
    const b = body(req);
    if (b.action !== "read") return send(res, 400, { error: "Ação inválida." });
    const ids = Array.isArray(b.ids) ? b.ids.filter((x) => typeof x === "string").slice(0, 200) : [];
    const itemId = typeof b.itemId === "string" ? b.itemId : "";
    const n = await markRead(me, { ids, itemId, all: b.all === true });
    return send(res, 200, { ok: true, updated: n });
  }
  res.setHeader("Allow", "GET, POST");
  return send(res, 405, { error: "Método não permitido." });
});
