import { categoryOfExt, extOf } from "./categories";
import type { FsNode } from "./types";
import { GB, KB, MB } from "./scale";

export interface SampleOptions {
  seed?: number;
  /** Quantidade aproximada de arquivos (padrão ~50 mil). */
  files?: number;
  now?: number;
}

export const SAMPLE_NOW = Date.UTC(2026, 9, 12);
const DAY = 86_400_000;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gera um "disco" falso mas realista, de forma determinística. */
export function generateSample(opts: SampleOptions = {}): FsNode[] {
  const rnd = mulberry32(opts.seed ?? 42);
  const now = opts.now ?? SAMPLE_NOW;
  const factor = Math.max(0.01, (opts.files ?? 50_000) / 50_000);
  const nodes: FsNode[] = [];
  let counter = 0;

  const normal = () => {
    const u = Math.max(rnd(), 1e-9);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
  };
  const logn = (median: number, sigma: number) => Math.max(1, Math.round(median * Math.exp(sigma * normal())));
  const between = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const scaled = (a: number, b: number) => Math.max(1, Math.round(between(a, b) * factor));
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)]!;
  const weighted = <T>(list: readonly (readonly [T, number])[]): T => {
    const total = list.reduce((s, [, w]) => s + w, 0);
    let r = rnd() * total;
    for (const [v, w] of list) {
      r -= w;
      if (r <= 0) return v;
    }
    return list[list.length - 1]![0];
  };

  const folder = (parent: FsNode | null, name: string): FsNode => {
    const id = `n${counter++}`;
    const nd: FsNode = {
      id,
      sourceId: "sample",
      path: parent ? `${parent.path}/${name}` : name,
      name,
      kind: "folder",
      size: 0,
      modifiedAt: now - Math.floor(rnd() * 400) * DAY,
      accessedAt: now - Math.floor(rnd() * 200) * DAY,
      parentId: parent?.id ?? null,
      category: "other",
    };
    nodes.push(nd);
    return nd;
  };

  const file = (parent: FsNode, name: string, size: number, maxAgeDays = 2200): FsNode => {
    const id = `n${counter++}`;
    const ext = extOf(name);
    const age = Math.floor(rnd() * maxAgeDays);
    const modifiedAt = now - age * DAY;
    const accessedAt = modifiedAt + Math.floor(rnd() * rnd() * age * 0.9) * DAY;
    const nd: FsNode = {
      id,
      sourceId: "sample",
      path: `${parent.path}/${name}`,
      name,
      kind: "file",
      size,
      modifiedAt,
      accessedAt,
      parentId: parent.id,
      hash: `h${id}`,
      ext,
      category: categoryOfExt(ext),
    };
    nodes.push(nd);
    return nd;
  };

  const clone = (src: FsNode, dst: FsNode, name = src.name): FsNode => {
    const copy = file(dst, name, src.size, 900);
    copy.hash = src.hash;
    return copy;
  };

  const WORDS = ["projeto", "relatorio", "final", "backup", "aula", "foto", "video", "contrato", "nota", "planilha", "ideia", "rascunho", "viagem", "familia", "trabalho", "teste", "novo", "v2", "copia", "scan"];
  const fname = (ext: string) => `${pick(WORDS)}_${pick(WORDS)}_${between(1, 9999)}.${ext}`;

  const root = folder(null, "C:");
  const users = folder(root, "Users");
  const home = folder(users, "marcelo");
  const pictureFiles: FsNode[] = [];
  const downloadFiles: FsNode[] = [];

  // Vídeos
  const videos = folder(home, "Videos");
  for (let y = 2019; y <= 2026; y++) {
    const fy = folder(videos, String(y));
    for (let k = 0, n = scaled(8, 25); k < n; k++) file(fy, fname(pick(["mp4", "mkv", "mov"])), logn(900 * MB, 1.1));
  }
  const filmes = folder(videos, "Filmes");
  for (let k = 0, n = scaled(20, 40); k < n; k++) file(filmes, fname("mkv"), logn(2 * GB, 0.45));
  const rec = folder(videos, "Gravações de tela");
  for (let k = 0, n = scaled(40, 80); k < n; k++) file(rec, fname("mp4"), logn(150 * MB, 0.9));

  // Downloads
  const dl = folder(home, "Downloads");
  const dlTypes = [
    ["exe", 14], ["msi", 6], ["zip", 14], ["rar", 6], ["7z", 3], ["pdf", 20], ["jpg", 9], ["png", 7],
    ["mp4", 5], ["iso", 1], ["docx", 6], ["xlsx", 4], ["txt", 3], ["mp3", 2],
  ] as const;
  const sizeByExt: Record<string, [number, number]> = {
    exe: [120 * MB, 1.2], msi: [60 * MB, 1.1], zip: [60 * MB, 1.4], rar: [90 * MB, 1.3], "7z": [150 * MB, 1.3],
    pdf: [2 * MB, 1], jpg: [1.6 * MB, 0.9], png: [1 * MB, 1], mp4: [300 * MB, 1.2], iso: [3.5 * GB, 0.4],
    docx: [300 * KB, 1], xlsx: [400 * KB, 1.1], txt: [20 * KB, 1.5], mp3: [6 * MB, 0.5],
  };
  for (let k = 0, n = scaled(700, 900); k < n; k++) {
    const ext = weighted(dlTypes);
    const [med, sig] = sizeByExt[ext]!;
    downloadFiles.push(file(dl, fname(ext), logn(med, sig)));
  }

  // Documentos
  const docs = folder(home, "Documents");
  for (const area of ["Trabalho", "Pessoal", "Faculdade", "Contratos", "Financeiro"]) {
    const fa = folder(docs, area);
    for (let s = 0, subs = between(3, 6); s < subs; s++) {
      const fs = folder(fa, `${pick(WORDS)}-${between(2019, 2026)}`);
      for (let k = 0, n = scaled(30, 90); k < n; k++) {
        const ext = pick(["pdf", "docx", "xlsx", "pptx", "txt"]);
        file(fs, fname(ext), logn(ext === "pptx" ? 5 * MB : 400 * KB, 1));
      }
    }
  }

  // Imagens
  const pics = folder(home, "Pictures");
  for (let y = 2018; y <= 2026; y++) {
    const fy = folder(pics, String(y));
    for (let m = 1; m <= 12; m++) {
      if (y === 2026 && m > 10) break;
      const fm = folder(fy, String(m).padStart(2, "0"));
      for (let k = 0, n = scaled(25, 110); k < n; k++) {
        pictureFiles.push(file(fm, fname(pick(["jpg", "jpg", "jpg", "heic", "png"])), logn(3.5 * MB, 0.7)));
      }
    }
  }

  // Música
  const music = folder(home, "Music");
  for (let a = 0, artists = scaled(15, 25); a < artists; a++) {
    const fa = folder(music, `${pick(WORDS)}-${pick(WORDS)}`);
    for (let b = 0, albums = between(2, 5); b < albums; b++) {
      const fb = folder(fa, `${pick(WORDS)}-${between(1998, 2025)}`);
      const flac = rnd() < 0.3;
      for (let t = 0, tracks = between(8, 14); t < tracks; t++) {
        file(fb, `${String(t + 1).padStart(2, "0")}-${pick(WORDS)}.${flac ? "flac" : "mp3"}`, logn(flac ? 28 * MB : 5.5 * MB, 0.4));
      }
    }
  }

  // Projetos de código
  const projects = folder(home, "Projects");
  for (let p = 0, repos = scaled(5, 8); p < repos; p++) {
    const repo = folder(projects, `${pick(WORDS)}-app-${p}`);
    const src = folder(repo, "src");
    for (let k = 0, n = scaled(40, 300); k < n; k++) file(src, fname(pick(["ts", "tsx", "css", "py"])), logn(6 * KB, 1));
    const git = folder(repo, ".git");
    for (let k = 0, n = scaled(150, 400); k < n; k++) file(git, `obj_${between(1e5, 9e5)}`, logn(8 * KB, 1.6));
    const dist = folder(repo, "dist");
    for (let k = 0, n = scaled(20, 80); k < n; k++) file(dist, fname("js"), logn(120 * KB, 1));
    const nm = folder(repo, "node_modules");
    for (let k = 0, pk = scaled(150, 380); k < pk; k++) {
      const pkg = folder(nm, `${pick(WORDS)}-${between(1, 999)}-${k}`);
      for (let f = 0, fc = between(4, 22); f < fc; f++) {
        file(pkg, fname(pick(["js", "js", "json", "ts", "md"])), logn(9 * KB, 1.3));
      }
    }
  }

  // Jogos
  const games = folder(folder(folder(folder(root, "Program Files (x86)"), "Steam"), "steamapps"), "common");
  for (let g = 0, n = scaled(4, 7); g < n; g++) {
    const game = folder(games, `${pick(WORDS)}-quest-${g}`);
    for (let k = 0, bigs = between(2, 5); k < bigs; k++) file(game, `data_${k}.pak`, logn(3 * GB, 0.6));
    const assets = folder(game, "assets");
    for (let k = 0, f = scaled(40, 140); k < f; k++) file(assets, fname(pick(["dat", "bin", "dll", "png"])), logn(700 * KB, 1.5));
  }

  // Backups (com duplicados de propósito)
  const backups = folder(home, "Backups");
  const phone = folder(backups, "Celular");
  for (const src of pictureFiles) if (rnd() < 0.06) clone(src, phone);
  const old = folder(backups, "PC-antigo");
  for (const src of downloadFiles) {
    if (src.size > 20 * MB && rnd() < 0.18) clone(src, old);
  }
  for (let y = 2021; y <= 2025; y++) file(backups, `backup-${y}.zip`, logn(4 * GB, 0.5));

  // Lixo de sistema e caches
  const appData = folder(folder(folder(home, "AppData"), "Local"), "Temp");
  for (let k = 0, n = scaled(2000, 3200); k < n; k++) file(appData, `${pick(["tmp", "log", "etl"])}${between(1, 99999)}.${pick(["tmp", "log", "tmp"])}`, logn(40 * KB, 1.6), 900);
  for (let k = 0, n = scaled(2, 5); k < n; k++) file(appData, `crash_${k}.dmp`, logn(700 * MB, 0.5), 900);
  const cache = folder(folder(folder(folder(home, "AppData"), "Local"), "Google"), "ChromeCache");
  for (let k = 0, n = scaled(2500, 4200); k < n; k++) file(cache, `f_${between(1e5, 9e6).toString(16)}`, logn(60 * KB, 1.2), 400);

  // Sistema
  const win = folder(folder(root, "Windows"), "WinSxS");
  for (let k = 0, n = scaled(900, 1600); k < n; k++) file(win, fname(pick(["dll", "dll", "sys", "mui", "cab"])), logn(220 * KB, 1.7), 2000);
  const pf = folder(root, "Program Files");
  for (const app of ["Adobe", "Microsoft Office", "JetBrains", "Docker"]) {
    const fa = folder(pf, app);
    for (let k = 0, n = scaled(60, 160); k < n; k++) file(fa, fname(pick(["dll", "exe", "dat"])), logn(2 * MB, 1.4), 1500);
  }

  return nodes;
}
