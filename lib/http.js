import { sessionUser } from "./auth.js";

export function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

export function body(req) {
  const b = req.body;
  if (b && typeof b === "object") return b;
  if (typeof b === "string") { try { return JSON.parse(b); } catch { return {}; } }
  return {};
}

// Envolve um handler: exige login (e, se pedido, perfil de administrador).
// O usuário logado fica em req.user.
export function protectedRoute(handler, { admin = false } = {}) {
  return async (req, res) => {
    try {
      const user = await sessionUser(req);
      if (!user) return send(res, 401, { error: "Sua sessão expirou. Entre novamente." });
      if (admin && user.role !== "admin") return send(res, 403, { error: "Somente administradores podem fazer isso." });
      req.user = user;
      return await handler(req, res);
    } catch (e) {
      console.error(e);
      return send(res, 500, { error: e && e.message ? e.message : "Erro interno." });
    }
  };
}

export function route(handler) {
  return async (req, res) => {
    try { return await handler(req, res); }
    catch (e) { console.error(e); return send(res, 500, { error: e && e.message ? e.message : "Erro interno." }); }
  };
}
