import crypto from "node:crypto";
import { db, parse } from "./store.js";

const USERS = "users";
const SECRET_KEY = "config:session_secret";
const COOKIE = "atd_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 dias

// ---------- Senhas ----------
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(pw), salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(pw, stored) {
  const [alg, salt, hash] = String(stored || "").split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const test = crypto.scryptSync(String(pw), salt, 64);
  const ref = Buffer.from(hash, "hex");
  return ref.length === test.length && crypto.timingSafeEqual(ref, test);
}

export function passwordProblem(pw) {
  if (typeof pw !== "string" || pw.length < 8) return "A senha precisa ter pelo menos 8 caracteres.";
  if (pw.length > 200) return "A senha é longa demais.";
  return null;
}

// ---------- Usuários ----------
export function cleanUsername(v) {
  const u = typeof v === "string" ? v.trim().toLowerCase() : "";
  return /^[a-z0-9._-]{3,40}$/.test(u) ? u : null;
}

export async function getUser(username) {
  if (!username) return null;
  const r = await db();
  return parse(await r.hget(USERS, username));
}

export async function listUsers() {
  const r = await db();
  const all = await r.hgetall(USERS);
  return Object.values(all || {}).map(parse).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export async function saveUser(u) {
  const r = await db();
  await r.hset(USERS, { [u.username]: JSON.stringify(u) });
  return u;
}

export async function deleteUser(username) {
  const r = await db();
  return (await r.hdel(USERS, username)) > 0;
}

export async function countUsers() {
  const r = await db();
  return Number(await r.hlen(USERS)) || 0;
}

export function publicUser(u) {
  return { username: u.username, name: u.name, role: u.role, active: u.active !== false, mustChange: !!u.mustChange };
}

// ---------- Sessão ----------
let secretCache = null;
async function secret() {
  if (secretCache) return secretCache;
  const r = await db();
  await r.setnx(SECRET_KEY, "s_" + crypto.randomBytes(32).toString("hex"));
  secretCache = await r.get(SECRET_KEY);
  return secretCache;
}

function sign(payload, key) {
  return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}

export async function setSession(res, user) {
  const payload = Buffer.from(JSON.stringify({ u: user.username, v: user.tokenVersion || 0, exp: Date.now() + MAX_AGE * 1000 })).toString("base64url");
  const token = payload + "." + sign(payload, await secret());
  const secure = process.env.VERCEL ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secure}`);
}

export function clearSession(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

// Devolve o usuário logado (ativo e com sessão válida) ou null.
export async function sessionUser(req) {
  const token = readCookie(req, COOKIE);
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expected = sign(payload, await secret());
  const a = Buffer.from(sig || ""), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, "base64url").toString()); } catch { return null; }
  if (!data || data.exp < Date.now()) return null;
  const user = await getUser(data.u);
  if (!user || user.active === false || (user.tokenVersion || 0) !== data.v) return null;
  return user;
}
