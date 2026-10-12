import type { Tree } from "./aggregate";
import type { DuplicateInfo } from "./duplicates";
import { CATEGORIES, CATEGORY_COLOR, CATEGORY_LABEL_PT, type Category } from "./categories";
import { formatBytes, KB } from "./scale";

/** Resultado mutável de pintura (evita alocar por nó). */
export interface PaintOut {
  color: number;
  alpha: number;
}

export interface LegendEntry {
  color: number;
  label: string;
}

export interface CustomLabel {
  label: string;
  confidence: number;
}

export interface LensContext {
  tree: Tree;
  now: number;
  dup: DuplicateInfo;
  maxFileSize: number;
  /** Rótulos produzidos pelo Classificador (lente em linguagem natural). */
  labels?: Map<number, CustomLabel>;
}

export interface Lens {
  id: string;
  label: string;
  description: string;
  paint(i: number, ctx: LensContext, out: PaintOut): void;
  legend(ctx: LensContext): LegendEntry[];
}

export const SUN_COLOR = 0xffe9b8;
const DAY = 86_400_000;

export function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

export function gradient(stops: [number, number][], t: number): number {
  if (t <= stops[0]![0]) return stops[0]![1];
  for (let k = 1; k < stops.length; k++) {
    const [t1, c1] = stops[k]!;
    const [t0, c0] = stops[k - 1]!;
    if (t <= t1) return lerpColor(c0, c1, (t - t0) / (t1 - t0 || 1));
  }
  return stops[stops.length - 1]![1];
}

const AGE_STOPS: [number, number][] = [
  [0, 0x60a5fa],
  [90, 0x34d399],
  [365, 0xfbbf24],
  [1095, 0xef4444],
];

const SIZE_STOPS: [number, number][] = [
  [0, 0x334155],
  [0.4, 0x38bdf8],
  [0.75, 0xf0abfc],
  [1, 0xffffff],
];

export const DUP_PALETTE = [0xfbbf24, 0xf472b6, 0x38bdf8, 0x86efac, 0xa78bfa, 0xfb923c, 0x5eead4, 0xf87171];

const typeLens: Lens = {
  id: "type",
  label: "Tipo",
  description: "Cor por tipo de arquivo: vídeo, imagem, código, documento...",
  paint(i, ctx, out) {
    const nd = ctx.tree.nodes[i]!;
    out.alpha = 1;
    out.color = nd.kind === "folder" ? SUN_COLOR : CATEGORY_COLOR[nd.category];
  },
  legend() {
    return CATEGORIES.map((c) => ({ color: CATEGORY_COLOR[c], label: CATEGORY_LABEL_PT[c] }));
  },
};

const ageLens: Lens = {
  id: "age",
  label: "Idade",
  description: "Quanto tempo desde o último acesso: azul recente, vermelho parado há anos.",
  paint(i, ctx, out) {
    const nd = ctx.tree.nodes[i]!;
    out.alpha = 1;
    if (nd.kind === "folder") {
      out.color = SUN_COLOR;
      return;
    }
    const days = Math.max(0, (ctx.now - nd.accessedAt) / DAY);
    out.color = gradient(AGE_STOPS, days);
  },
  legend() {
    return [
      { color: 0x60a5fa, label: "Recente" },
      { color: 0x34d399, label: "3 meses" },
      { color: 0xfbbf24, label: "1 ano" },
      { color: 0xef4444, label: "3+ anos" },
    ];
  },
};

const sizeLens: Lens = {
  id: "size",
  label: "Tamanho",
  description: "Mapa de calor por peso: quanto mais claro, mais pesado.",
  paint(i, ctx, out) {
    const nd = ctx.tree.nodes[i]!;
    out.alpha = 1;
    const size = nd.kind === "folder" ? ctx.tree.total[i]! : nd.size;
    const max = nd.kind === "folder" ? ctx.tree.total[ctx.tree.roots[0] ?? 0]! : ctx.maxFileSize;
    const t = size <= KB ? 0 : Math.min(1, Math.log(size / KB) / Math.log(Math.max(max, 2 * KB) / KB));
    out.color = gradient(SIZE_STOPS, t);
  },
  legend(ctx) {
    return [
      { color: 0x334155, label: "1 KB" },
      { color: 0x38bdf8, label: "" },
      { color: 0xf0abfc, label: "" },
      { color: 0xffffff, label: formatBytes(ctx.maxFileSize) },
    ];
  },
};

const dupLens: Lens = {
  id: "duplicates",
  label: "Duplicados",
  description: "Cópias idênticas (mesmo hash) acendem com a mesma cor; o resto esmaece.",
  paint(i, ctx, out) {
    const nd = ctx.tree.nodes[i]!;
    if (nd.kind === "folder") {
      out.color = SUN_COLOR;
      out.alpha = 0.55;
      return;
    }
    const g = ctx.dup.groupOf[i]!;
    if (g < 0) {
      out.color = 0x64748b;
      out.alpha = 0.16;
    } else {
      out.color = DUP_PALETTE[g % DUP_PALETTE.length]!;
      out.alpha = 1;
    }
  },
  legend(ctx) {
    return [
      { color: 0xfbbf24, label: `${ctx.dup.groups.length} grupos` },
      { color: 0x64748b, label: "Únicos" },
    ];
  },
};

export const builtinLenses: Lens[] = [typeLens, ageLens, sizeLens, dupLens];

const CUSTOM_PALETTE = [0xff4d8d, 0x38bdf8, 0xa78bfa, 0x5eead4, 0xfde047, 0xf97316, 0x86efac, 0xf472b6];

/** Lente criada a partir de rótulos do Classificador ("o que parece contrato?"). */
export function customLens(id: string, label: string, description: string, labels: string[]): Lens {
  const colorOf = new Map<string, number>();
  labels.forEach((l, k) => colorOf.set(l, CUSTOM_PALETTE[k % CUSTOM_PALETTE.length]!));
  return {
    id,
    label,
    description,
    paint(i, ctx, out) {
      const nd = ctx.tree.nodes[i]!;
      if (nd.kind === "folder") {
        out.color = SUN_COLOR;
        out.alpha = 0.6;
        return;
      }
      const hit = ctx.labels?.get(i);
      if (!hit) {
        out.color = 0x64748b;
        out.alpha = 0.14;
        return;
      }
      out.color = colorOf.get(hit.label) ?? 0xcbd5e1;
      out.alpha = 0.45 + 0.55 * Math.max(0, Math.min(1, hit.confidence));
    },
    legend() {
      return [...colorOf.entries()].map(([l, c]) => ({ color: c, label: l }));
    },
  };
}

export function categoryLabel(c: Category): string {
  return CATEGORY_LABEL_PT[c];
}
