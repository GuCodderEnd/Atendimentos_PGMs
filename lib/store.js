import { Redis } from "@upstash/redis";
import crypto from "node:crypto";

const KEY = "atendimentos";
const VERSION_KEY = "atendimentos:version";

let client = null;

function redis() {
  if (client) return client;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    client = new Redis({ url, token });
    return client;
  }
  if (process.env.ALLOW_MEMORY_STORE === "1") {
    client = memoryStore();
    return client;
  }
  throw new Error("Banco não configurado: conecte o Upstash Redis ao projeto na Vercel.");
}

// Somente para testes locais (ALLOW_MEMORY_STORE=1). Os dados somem ao reiniciar.
function memoryStore() {
  const h = new Map();
  let v = 0;
  return {
    async hgetall() { return h.size ? Object.fromEntries(h) : null; },
    async hget(_k, f) { return h.has(f) ? h.get(f) : null; },
    async hset(_k, obj) { for (const [f, val] of Object.entries(obj)) h.set(f, JSON.parse(val)); return 1; },
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
  const r = redis();
  const [all, version] = await Promise.all([r.hgetall(KEY), r.get(VERSION_KEY)]);
  const items = Object.values(all || {}).map(parse).filter(Boolean);
  items.sort((a, b) => b.createdAt - a.createdAt);
  return { items, version: Number(version) || 0 };
}

export async function getVersion() {
  return Number(await redis().get(VERSION_KEY)) || 0;
}

export async function getOne(id) {
  return parse(await redis().hget(KEY, id));
}

export async function save(item) {
  const r = redis();
  await r.hset(KEY, { [item.id]: JSON.stringify(item) });
  await r.incr(VERSION_KEY);
  return item;
}

export async function remove(id) {
  const r = redis();
  const n = await r.hdel(KEY, id);
  await r.incr(VERSION_KEY);
  return n > 0;
}

export function newId() {
  return crypto.randomUUID();
}
