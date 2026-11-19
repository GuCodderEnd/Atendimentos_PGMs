import {
  getUser, saveUser, countUsers, publicUser, cleanUsername,
  hashPassword, verifyPassword, passwordProblem, setSession, clearSession, sessionUser,
} from "../lib/auth.js";
import { cleanName } from "../lib/validate.js";
import { send, body, route } from "../lib/http.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// GET  -> { user, needsSetup }
// POST { action: "setup", name, username, password }   cria o primeiro administrador
// POST { action: "login", username, password }
// POST { action: "logout" }
// POST { action: "password", current, next }           troca a própria senha
export default route(async (req, res) => {
  if (req.method === "GET") {
    const user = await sessionUser(req);
    const needsSetup = user ? false : (await countUsers()) === 0;
    return send(res, 200, { user: user ? publicUser(user) : null, needsSetup });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { error: "Método não permitido." });
  }

  const b = body(req);

  if (b.action === "setup") {
    if ((await countUsers()) > 0) return send(res, 409, { error: "O administrador já foi configurado. Entre com seu usuário." });
    const username = cleanUsername(b.username);
    const name = cleanName(b.name);
    if (!name) return send(res, 400, { error: "Informe seu nome." });
    if (!username) return send(res, 400, { error: "Usuário inválido: use de 3 a 40 letras minúsculas, números, ponto, hífen ou sublinhado." });
    const prob = passwordProblem(b.password);
    if (prob) return send(res, 400, { error: prob });
    const user = { username, name, role: "admin", active: true, mustChange: false, tokenVersion: 0, passHash: hashPassword(b.password), createdAt: Date.now() };
    await saveUser(user);
    await setSession(res, user);
    return send(res, 200, { user: publicUser(user) });
  }

  if (b.action === "login") {
    const username = cleanUsername(b.username);
    const user = username ? await getUser(username) : null;
    if (!user || user.active === false || !verifyPassword(b.password || "", user.passHash)) {
      await wait(600); // desacelera tentativas
      return send(res, 401, { error: "Usuário ou senha incorretos." });
    }
    await setSession(res, user);
    return send(res, 200, { user: publicUser(user) });
  }

  if (b.action === "logout") {
    clearSession(res);
    return send(res, 200, { ok: true });
  }

  if (b.action === "password") {
    const user = await sessionUser(req);
    if (!user) return send(res, 401, { error: "Sua sessão expirou. Entre novamente." });
    if (!verifyPassword(b.current || "", user.passHash)) return send(res, 400, { error: "A senha atual está incorreta." });
    const prob = passwordProblem(b.next);
    if (prob) return send(res, 400, { error: prob });
    if (b.next === b.current) return send(res, 400, { error: "A nova senha precisa ser diferente da atual." });
    Object.assign(user, { passHash: hashPassword(b.next), mustChange: false, tokenVersion: (user.tokenVersion || 0) + 1 });
    await saveUser(user);
    await setSession(res, user); // as outras sessões deste usuário deixam de valer
    return send(res, 200, { user: publicUser(user) });
  }

  return send(res, 400, { error: "Ação inválida." });
});
