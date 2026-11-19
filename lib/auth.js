import crypto from "node:crypto";

const COOKIE = "atd_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 dias

function password() {
  const p = process.env.APP_PASSWORD;
  if (!p) throw new Error("APP_PASSWORD não configurada nas variáveis de ambiente.");
  return p;
}

// O token é derivado da senha: trocar APP_PASSWORD desconecta todo mundo.
function tokenFor(pw) {
  return crypto.createHmac("sha256", pw).update("atendimentos-session-v1").digest("hex");
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function checkPassword(input) {
  return safeEqual(input || "", password());
}

export function setSession(res) {
  const secure = process.env.VERCEL ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${tokenFor(password())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secure}`);
}

export function clearSession(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function isAuthed(req) {
  const t = readCookie(req, COOKIE);
  return !!t && safeEqual(t, tokenFor(password()));
}
