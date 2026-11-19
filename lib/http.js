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

// Envolve um handler e trata erros de configuração.
export function protectedRoute(handler) {
  return async (req, res) => {
    try {
      return await handler(req, res);
    } catch (e) {
      console.error(e);
      return send(res, 500, { error: e && e.message ? e.message : "Erro interno." });
    }
  };
}
