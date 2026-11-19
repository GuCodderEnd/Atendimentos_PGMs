import { listAll, getVersion, save, newId } from "../../lib/store.js";
import { parseFields, cleanName } from "../../lib/validate.js";
import { send, body, protectedRoute } from "../../lib/http.js";

export default protectedRoute(async (req, res) => {
  if (req.method === "GET") {
    // ?since=N: se nada mudou, responde só a versão (1 comando no Redis).
    const since = Number(req.query && req.query.since);
    if (Number.isFinite(since) && since >= 0) {
      const version = await getVersion();
      if (version === since) return send(res, 200, { version, unchanged: true });
    }
    return send(res, 200, await listAll());
  }
  if (req.method === "POST") {
    const b = body(req);
    const { value, error } = parseFields(b);
    if (error) return send(res, 400, { error });
    const now = Date.now();
    const item = {
      id: newId(),
      ...value,
      status: "aberto",
      createdAt: now,
      createdBy: cleanName(b.author),
      updatedAt: now,
      resolvedAt: 0,
      resolvedBy: "",
      note: "",
    };
    await save(item);
    return send(res, 201, item);
  }
  res.setHeader("Allow", "GET, POST");
  return send(res, 405, { error: "Método não permitido." });
});
