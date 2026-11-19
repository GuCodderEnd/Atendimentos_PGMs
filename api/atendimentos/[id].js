import { getOne, save, remove } from "../../lib/store.js";
import { parseFields, cleanName, cleanText, LIMITS } from "../../lib/validate.js";
import { send, body, protectedRoute } from "../../lib/http.js";

// PATCH aceita:
//   { action: "edit", link?, desc?, team? }
//   { action: "resolve", note?, author? }
//   { action: "reopen" }
export default protectedRoute(async (req, res) => {
  const id = String(req.query.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return send(res, 400, { error: "Identificador inválido." });

  if (req.method === "DELETE") {
    await remove(id);
    return send(res, 200, { ok: true });
  }

  if (req.method === "PATCH") {
    const item = await getOne(id);
    if (!item) return send(res, 404, { error: "Atendimento não encontrado. Ele pode ter sido excluído." });
    const b = body(req);
    const now = Date.now();

    if (b.action === "edit") {
      const { value, error } = parseFields(b, { partial: true });
      if (error) return send(res, 400, { error });
      Object.assign(item, value, { updatedAt: now });
    } else if (b.action === "resolve") {
      Object.assign(item, {
        status: "resolvido",
        resolvedAt: now,
        resolvedBy: cleanName(b.author),
        note: cleanText(b.note, LIMITS.note),
        updatedAt: now,
      });
    } else if (b.action === "reopen") {
      Object.assign(item, { status: "aberto", resolvedAt: 0, resolvedBy: "", note: "", updatedAt: now });
    } else {
      return send(res, 400, { error: "Ação inválida." });
    }
    await save(item);
    return send(res, 200, item);
  }

  res.setHeader("Allow", "PATCH, DELETE");
  return send(res, 405, { error: "Método não permitido." });
});
