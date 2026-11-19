import crypto from "node:crypto";
import { db, parse } from "./store.js";

const MAX_PER_USER = 200;
const key = (u) => "inbox:" + u;
const vkey = (u) => "inbox:" + u + ":v";

export async function inboxVersion(username) {
  const r = await db();
  return Number(await r.get(vkey(username))) || 0;
}

export async function listInbox(username) {
  const r = await db();
  const [all, v] = await Promise.all([r.hgetall(key(username)), r.get(vkey(username))]);
  const items = Object.values(all || {}).map(parse).filter(Boolean).sort((a, b) => b.at - a.at);
  return { items, version: Number(v) || 0 };
}

// Entrega uma notificação na caixa de cada destinatário.
export async function deliver(usernames, notif) {
  const r = await db();
  for (const u of usernames) {
    const entry = { id: crypto.randomUUID(), ...notif, read: false };
    await r.hset(key(u), { [entry.id]: JSON.stringify(entry) });
    await r.incr(vkey(u));
    await prune(r, u);
  }
}

async function prune(r, u) {
  if ((Number(await r.hlen(key(u))) || 0) <= MAX_PER_USER) return;
  const all = Object.values((await r.hgetall(key(u))) || {}).map(parse).filter(Boolean).sort((a, b) => b.at - a.at);
  const old = all.slice(MAX_PER_USER).map((n) => n.id);
  if (old.length) await r.hdel(key(u), ...old);
}

// Marca como lidas. filter: { ids?: string[], itemId?: string, all?: true }
export async function markRead(username, filter) {
  const r = await db();
  const all = Object.values((await r.hgetall(key(username))) || {}).map(parse).filter(Boolean);
  const ids = new Set(filter.ids || []);
  const changed = {};
  for (const n of all) {
    if (n.read) continue;
    if (filter.all || ids.has(n.id) || (filter.itemId && n.itemId === filter.itemId)) {
      n.read = true;
      changed[n.id] = JSON.stringify(n);
    }
  }
  if (Object.keys(changed).length) {
    await r.hset(key(username), changed);
    await r.incr(vkey(username));
  }
  return Object.keys(changed).length;
}

export async function clearInbox(username) {
  const r = await db();
  const all = Object.keys((await r.hgetall(key(username))) || {});
  if (all.length) await r.hdel(key(username), ...all);
}
