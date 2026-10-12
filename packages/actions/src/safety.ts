/** Regras de segurança: caminhos que o Astrolabe nunca mexe, mesmo se a IA ou o usuário pedirem. */

const PROTECTED = [
  /^[a-z]:\/windows(\/|$)/i,
  /^[a-z]:\/program files( \(x86\))?(\/|$)/i,
  /^[a-z]:\/programdata(\/|$)/i,
  /^[a-z]:\/\$recycle\.bin(\/|$)/i,
  /^[a-z]:\/system volume information(\/|$)/i,
  /^\/(bin|boot|dev|etc|lib|lib64|proc|run|sbin|sys|usr|var|system|library)(\/|$)/i,
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)\.ssh(\/|$)/i,
  /(^|\/)appdata\/roaming\/microsoft(\/|$)/i,
];

/** Normaliza separadores e remove "./" e "../" de forma estrita. */
export function normalizePath(p: string): string {
  const unified = p.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  const out: string[] = [];
  for (const part of unified.split("/")) {
    if (part === "" || part === ".") {
      if (out.length === 0 && part === "") out.push("");
      continue;
    }
    if (part === "..") {
      if (out.length > 1) out.pop();
      continue;
    }
    out.push(part);
  }
  const joined = out.join("/");
  return joined.length > 1 ? joined.replace(/\/$/, "") : joined;
}

export function isProtectedPath(path: string): boolean {
  const p = normalizePath(path);
  return PROTECTED.some((re) => re.test(p));
}

/** Um caminho de destino precisa estar dentro de uma das raízes permitidas. */
export function isInside(path: string, root: string): boolean {
  const p = normalizePath(path).toLowerCase();
  const r = normalizePath(root).toLowerCase();
  return p === r || p.startsWith(r.endsWith("/") ? r : `${r}/`);
}

const BAD_NAME = /[<>:"|?*\u0000-\u001f]/;

/** Nome de arquivo/pasta seguro para criar (sem separadores, sem caracteres inválidos). */
export function isSafeName(name: string): boolean {
  return name.length > 0 && name.length <= 200 && !name.includes("/") && !name.includes("\\") && name !== "." && name !== ".." && !BAD_NAME.test(name);
}
