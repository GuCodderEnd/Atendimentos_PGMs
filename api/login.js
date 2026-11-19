import { checkPassword, setSession, clearSession, isAuthed } from "../lib/auth.js";
import { send, body } from "../lib/http.js";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") return send(res, 200, { authed: isAuthed(req) });
    if (req.method === "POST") {
      const { password } = body(req);
      if (!checkPassword(password)) {
        await new Promise((r) => setTimeout(r, 600)); // desacelera tentativas
        return send(res, 401, { error: "Senha incorreta." });
      }
      setSession(res);
      return send(res, 200, { ok: true });
    }
    if (req.method === "DELETE") {
      clearSession(res);
      return send(res, 200, { ok: true });
    }
    res.setHeader("Allow", "GET, POST, DELETE");
    return send(res, 405, { error: "Método não permitido." });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: e.message || "Erro interno." });
  }
}
