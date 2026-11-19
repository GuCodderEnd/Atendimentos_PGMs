import {
  getUser, listUsers, saveUser, deleteUser, publicUser, cleanUsername, hashPassword, passwordProblem,
} from "../lib/auth.js";
import { clearInbox } from "../lib/inbox.js";
import { cleanName } from "../lib/validate.js";
import { send, body, protectedRoute } from "../lib/http.js";

// GET  -> lista de usuários (qualquer usuário logado; usada para escolher destinatários)
// POST (somente admin):
//   { action: "create", username, name, password, role }
//   { action: "update", username, name?, role?, active? }
//   { action: "reset",  username, password }     define senha temporária
//   { action: "delete", username }
export default protectedRoute(async (req, res) => {
  if (req.method === "GET") {
    return send(res, 200, { users: (await listUsers()).map(publicUser) });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { error: "Método não permitido." });
  }
  if (req.user.role !== "admin") return send(res, 403, { error: "Somente administradores podem gerenciar usuários." });

  const b = body(req);
  const username = cleanUsername(b.username);
  if (!username) return send(res, 400, { error: "Usuário inválido: use de 3 a 40 letras minúsculas, números, ponto, hífen ou sublinhado." });
  const role = b.role === "admin" ? "admin" : "user";

  if (b.action === "create") {
    if (await getUser(username)) return send(res, 409, { error: "Já existe um usuário com esse nome de acesso." });
    const name = cleanName(b.name);
    if (!name) return send(res, 400, { error: "Informe o nome da pessoa." });
    const prob = passwordProblem(b.password);
    if (prob) return send(res, 400, { error: prob });
    const user = { username, name, role, active: true, mustChange: true, tokenVersion: 0, passHash: hashPassword(b.password), createdAt: Date.now() };
    await saveUser(user);
    return send(res, 201, { user: publicUser(user) });
  }

  const user = await getUser(username);
  if (!user) return send(res, 404, { error: "Usuário não encontrado." });
  const isSelf = username === req.user.username;
  const admins = (await listUsers()).filter((u) => u.role === "admin" && u.active !== false);
  const lastAdmin = user.role === "admin" && admins.length <= 1;

  if (b.action === "update") {
    if (b.name !== undefined) {
      const name = cleanName(b.name);
      if (!name) return send(res, 400, { error: "Informe o nome da pessoa." });
      user.name = name;
    }
    if (b.role !== undefined && role !== user.role) {
      if (lastAdmin) return send(res, 400, { error: "É preciso ter pelo menos um administrador ativo." });
      user.role = role;
    }
    if (b.active !== undefined && !!b.active !== (user.active !== false)) {
      if (isSelf) return send(res, 400, { error: "Você não pode desativar o próprio acesso." });
      if (!b.active && lastAdmin) return send(res, 400, { error: "É preciso ter pelo menos um administrador ativo." });
      user.active = !!b.active;
      user.tokenVersion = (user.tokenVersion || 0) + 1; // derruba sessões abertas
    }
    await saveUser(user);
    return send(res, 200, { user: publicUser(user) });
  }

  if (b.action === "reset") {
    const prob = passwordProblem(b.password);
    if (prob) return send(res, 400, { error: prob });
    Object.assign(user, { passHash: hashPassword(b.password), mustChange: true, tokenVersion: (user.tokenVersion || 0) + 1 });
    await saveUser(user);
    return send(res, 200, { user: publicUser(user) });
  }

  if (b.action === "delete") {
    if (isSelf) return send(res, 400, { error: "Você não pode excluir o próprio usuário." });
    if (lastAdmin) return send(res, 400, { error: "É preciso ter pelo menos um administrador ativo." });
    await deleteUser(username);
    await clearInbox(username);
    return send(res, 200, { ok: true });
  }

  return send(res, 400, { error: "Ação inválida." });
});
