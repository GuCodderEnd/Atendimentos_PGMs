import { Redis } from "@upstash/redis";
import { createClient } from "redis";
import crypto from "node:crypto";

const KEY = "atendimentos";
const VERSION_KEY = "atendimentos:version";

let clientPromise = null;

// Procura uma variável de ambiente pelo final do nome, aceitando qualquer
// prefixo que a integração da Vercel tenha criado (KV_, STORAGE_, etc.).
function findEnv(suffixes) {
  for (const s of suffixes) if (process.env[s]) return process.env[s];
  const keys = Object.keys(process.env);
  for (const s of suffixes) {
    const k = keys.find((name) => name.endsWith("_" + s) && process.env[name]);
    if (k) return process.env[k];
  }
  return null;
}

function relevantEnvNames() {
  return Object.keys(process.env).filter((k) => /REDIS|KV_|UPSTASH/i.test(k)).sort();
}

async function connect() {
  // 1) Upstash via REST (integração "Upstash for Redis")
  const restUrl = findEnv(["KV_REST_API_URL", "UPSTASH_REDIS_REST_URL", "REDIS_REST_URL"]);
  const restToken = findEnv(["KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN", "REDIS_REST_TOKEN"]);
  if (restUrl && restToken) return restAdapter(new Redis({ url: restUrl, token: restToken, automaticDeserialization: false }));

  // 2) Redis via conexão direta (banco "Redis" da Vercel ou REDIS_URL)
  const redisUrl = findEnv(["REDIS_URL", "KV_URL"]);
  if (redisUrl) {
    const c = createClient({ url: redisUrl, socket: { connectTimeout: 8000 } });
    c.on("error", (e) => console.error("Redis:", e.message));
    await c.connect();
    return tcpAdapter(c);
  }

  // 3) Somente para testes locais
  if (process.env.ALLOW_MEMORY_STORE === "1") return memoryStore();

  const found = relevantEnvNames();
  throw new Error(
    "Banco não configurado: conecte um banco Redis (Upstash ou Redis) ao projeto na Vercel e faça Redeploy. " +
      (found.length ? "Variáveis encontradas: " + found.join(", ") + "." : "Nenhuma variável de banco encontrada neste deploy.")
  );
}

export function db() {
  if (!clientPromise) clientPromise = connect().catch((e) => { clientPromise = null; throw e; });
  return clientPromise;
}

// Todas as leituras devolvem strings (ou null); quem chama faz o JSON.parse.
function restAdapter(r) {
  return {
    hgetall: async (k) => pairsToObject(await r.hgetall(k)),
    hget: (k, f) => r.hget(k, f),
    hset: (k, obj) => r.hset(k, obj),
    hdel: (k, ...f) => r.hdel(k, ...f),
    hlen: (k) => r.hlen(k),
    incr: (k) => r.incr(k),
    get: (k) => r.get(k),
    setnx: (k, v) => r.set(k, v, { nx: true }),
  };
}

// Sem desserialização automática, o Upstash devolve o HGETALL como [campo, valor, ...].
function pairsToObject(x) {
  if (!x) return {};
  if (!Array.isArray(x)) return x;
  const o = {};
  for (let i = 0; i + 1 < x.length; i += 2) o[x[i]] = x[i + 1];
  return o;
}

function tcpAdapter(c) {
  return {
    hgetall: (k) => c.hGetAll(k),
    hget: (k, f) => c.hGet(k, f),
    hset: (k, obj) => c.hSet(k, obj),
    hdel: (k, ...f) => c.hDel(k, f),
    hlen: (k) => c.hLen(k),
    incr: (k) => c.incr(k),
    get: (k) => c.get(k),
    setnx: (k, v) => c.set(k, v, { NX: true }),
  };
}

// Somente para testes locais (ALLOW_MEMORY_STORE=1). Os dados somem ao reiniciar.
function memoryStore() {
  const hashes = new Map(), strings = new Map();
  const h = (k) => { if (!hashes.has(k)) hashes.set(k, new Map()); return hashes.get(k); };
  return {
    async hgetall(k) { const m = h(k); return m.size ? Object.fromEntries(m) : {}; },
    async hget(k, f) { return h(k).get(f) ?? null; },
    async hset(k, obj) { for (const [f, v] of Object.entries(obj)) h(k).set(f, String(v)); return 1; },
    async hdel(k, ...f) { let n = 0; for (const x of f.flat()) n += h(k).delete(x) ? 1 : 0; return n; },
    async hlen(k) { return h(k).size; },
    async incr(k) { const v = (Number(strings.get(k)) || 0) + 1; strings.set(k, String(v)); return v; },
    async get(k) { return strings.get(k) ?? null; },
    async setnx(k, v) { if (strings.has(k)) return null; strings.set(k, v); return "OK"; },
  };
}

export function parse(v) {
  if (v == null) return null;
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return null; } }
  return v;
}

// ---------- Atendimentos ----------
export async function listAll() {
  const r = await db();
  const [all, version] = await Promise.all([r.hgetall(KEY), r.get(VERSION_KEY)]);
  const items = Object.values(all || {}).map(parse).filter(Boolean);
  items.sort((a, b) => b.createdAt - a.createdAt);
  return { items, version: Number(version) || 0 };
}

export async function getVersion() {
  const r = await db();
  return Number(await r.get(VERSION_KEY)) || 0;
}

export async function getOne(id) {
  const r = await db();
  return parse(await r.hget(KEY, id));
}

export async function save(item) {
  const r = await db();
  await r.hset(KEY, { [item.id]: JSON.stringify(item) });
  await r.incr(VERSION_KEY);
  return item;
}

export async function remove(id) {
  const r = await db();
  const n = await r.hdel(KEY, id);
  await r.incr(VERSION_KEY);
  return n > 0;
}

export function newId() {
  return crypto.randomUUID();
}
