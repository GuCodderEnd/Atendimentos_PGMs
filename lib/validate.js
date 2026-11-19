export const PRIORITIES = ["baixa", "media", "alta", "urgente"];

const LIMITS = { link: 2000, desc: 5000, team: 80, note: 3000, name: 80, notify: 500 };

export function cleanText(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function cleanUrl(v) {
  const s = cleanText(v, LIMITS.link);
  try {
    const u = new URL(s);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

export function cleanName(v) {
  return cleanText(v, LIMITS.name);
}

// Campos editáveis de um atendimento. Retorna { value } ou { error }.
export function parseFields(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.link !== undefined) {
    const link = cleanUrl(body.link);
    if (!link) return { error: "Informe um link válido começando com http:// ou https://" };
    out.link = link;
  }
  if (!partial || body.desc !== undefined) {
    const desc = cleanText(body.desc, LIMITS.desc);
    if (!desc) return { error: "Descreva o que está ocorrendo." };
    out.desc = desc;
  }
  if (!partial || body.youtrack !== undefined) {
    const raw = cleanText(body.youtrack, LIMITS.link);
    if (raw) {
      const yt = cleanUrl(raw);
      if (!yt) return { error: "O link do YouTrack precisa começar com http:// ou https://" };
      out.youtrack = yt;
    } else {
      out.youtrack = "";
    }
  }
  if (body.createdAt !== undefined) {
    const t = Number(body.createdAt);
    const min = Date.UTC(2000, 0, 1);
    const max = Date.now() + 36 * 3600 * 1000; // tolera diferença de fuso
    if (!Number.isFinite(t) || t < min || t > max) return { error: "Data de abertura inválida." };
    out.createdAt = Math.round(t);
  }
  if (!partial || body.priority !== undefined) {
    const pr = typeof body.priority === "string" ? body.priority : "";
    if (!PRIORITIES.includes(pr)) return { error: "Escolha a prioridade: baixa, média, alta ou urgente." };
    out.priority = pr;
  }
  if (!partial || body.team !== undefined) {
    const team = cleanText(body.team, LIMITS.team);
    if (!team) return { error: "Informe a equipe responsável." };
    out.team = team;
  }
  return { value: out };
}

export { LIMITS };
