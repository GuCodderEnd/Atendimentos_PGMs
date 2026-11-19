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
  return Object.keys(process.env)
    .filter((k) => /REDIS|KV_|UPSTASH/i.test(k))
    .sort();
}

async function connect() {
  // 1) Upstash via REST (integração "Upstash for Redis")
  const restUrl = findEnv(["KV_REST_API_URL", "UPSTASH_REDIS_REST_URL", "REDIS_REST_URL"]);
  const restToken = findEnv(["KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN", "REDIS_REST_TOKEN"]);
  if (restUrl && restToken) return restAdapter(new Redis({ url: restUrl, token: restToken }));

  // 2) Redis via conexão direta (banco "Redis" da Vercel ou Upstash com REDIS_URL)
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

function redis() {
  if (!clientPromise) {
    clientPromise = connect().catch((e) => { clientPromise = null; throw e; });
  }
  return clientPromise;
}

function restAdapter(r) {
  return {
    hgetall: (k) => r.hgetall(k),
    hget: (k, f) => r.hget(k, f),
    hset: (k, obj) => r.hset(k, obj),
    hdel: (k, f) => r.hdel(k, f),
    incr: (k) => r.incr(k),
    get: (k) => r.get(k),
  };
}

function tcpAdapter(c) {
  return {
    hgetall: (k) => c.hGetAll(k),
    hget: (k, f) => c.hGet(k, f),
    hset: (k, obj) => c.hSet(k, obj),
    hdel: (k, f) => c.hDel(k, f),
    incr: (k) => c.incr(k),
    get: (k) => c.get(k),
  };
}

// Somente para testes locais (ALLOW_MEMORY_STORE=1). Os dados somem ao reiniciar.
function memoryStore() {
  const h = new Map();
  let v = 0;
  return {
    async hgetall() { return h.size ? Object.fromEntries(h) : null; },
    async hget(_k, f) { return h.has(f) ? h.get(f) : null; },
    async hset(_k, obj) { for (const [f, val] of Object.entries(obj)) h.set(f, val); return 1; },
    async hdel(_k, f) { return h.delete(f) ? 1 : 0; },
    async incr() { return ++v; },
    async get() { return v; },
  };
}

function parse(v) {
  if (v == null) return null;
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return null; } }
  return v;
}

export async function listAll() {
  const r = await redis();
  const [all, version] = await Promise.all([r.hgetall(KEY), r.get(VERSION_KEY)]);
  const items = Object.values(all || {}).map(parse).filter(Boolean);
  items.sort((a, b) => b.createdAt - a.createdAt);
  return { items, version: Number(version) || 0 };
}

export async function getVersion() {
  const r = await redis();
  return Number(await r.get(VERSION_KEY)) || 0;
}

export async function getOne(id) {
  const r = await redis();
  return parse(await r.hget(KEY, id));
}

export async function save(item) {
  const r = await redis();
  await r.hset(KEY, { [item.id]: JSON.stringify(item) });
  await r.incr(VERSION_KEY);
  return item;
}

export async function remove(id) {
  const r = await redis();
  const n = await r.hdel(KEY, id);
  await r.incr(VERSION_KEY);
  return n > 0;
}

export function newId() {
  return crypto.randomUUID();
}
