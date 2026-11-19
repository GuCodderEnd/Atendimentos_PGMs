const LIMITS = { link: 2000, desc: 5000, team: 80, note: 3000, name: 80 };

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
  if (!partial || body.team !== undefined) {
    const team = cleanText(body.team, LIMITS.team);
    if (!team) return { error: "Informe a equipe responsável." };
    out.team = team;
  }
  return { value: out };
}

export { LIMITS };
