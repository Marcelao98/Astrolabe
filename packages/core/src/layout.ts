import type { Tree } from "./aggregate";
import { MB, KB, radiusFor, type ScaleSpec } from "./scale";
import type { ScaleMode } from "./types";

export interface LayoutOptions {
  scale: ScaleMode;
  /** Pastas com profundidade menor que isso começam abertas. */
  openDepth: number;
  /** Ids forçados a ficar abertos. */
  expanded?: ReadonlySet<string>;
  /** Ids forçados a ficar fechados (colapsados). */
  collapsed?: ReadonlySet<string>;
}

export interface Layout {
  /** Posição do centro de cada nó no mundo (a raiz fica em 0,0). */
  x: Float32Array;
  y: Float32Array;
  /** Raio do corpo (o "sol" ou "planeta"). */
  r: Float32Array;
  /** Raio do sistema inteiro (corpo + órbitas dos filhos). */
  sys: Float32Array;
  visible: Uint8Array;
  open: Uint8Array;
  folderSpec: ScaleSpec;
  fileSpec: ScaleSpec;
  maxFileSize: number;
  /** Raio que contém a galáxia toda. */
  extent: number;
}

const TWO_PI = Math.PI * 2;
const GAP = 2;
const PAD = 0.6;

function spin(i: number): number {
  return ((Math.imul(i + 1, 2654435761) >>> 0) / 4294967296) * TWO_PI;
}

export function makeSpecs(tree: Tree, mode: ScaleMode): { folderSpec: ScaleSpec; fileSpec: ScaleSpec; maxFileSize: number } {
  let maxFolder = MB * 2;
  let maxFile = KB * 2;
  for (const i of tree.order) {
    const nd = tree.nodes[i]!;
    if (nd.kind === "file") maxFile = Math.max(maxFile, nd.size);
    else if (tree.parent[i]! >= 0) maxFolder = Math.max(maxFolder, tree.total[i]!);
  }
  return {
    folderSpec: { mode, domainMin: MB, domainMax: maxFolder, rMin: 4, rMax: 36 },
    fileSpec: { mode, domainMin: KB, domainMax: maxFile, rMin: 0.9, rMax: 9 },
    maxFileSize: maxFile,
  };
}

/**
 * Layout "sistema solar": cada pasta é um sol; filhos orbitam em anéis concêntricos.
 * Subpastas carregam seus próprios sistemas; arquivos formam cinturões de asteroides.
 * Determinístico e O(n log n).
 */
export function computeLayout(tree: Tree, opts: LayoutOptions): Layout {
  const n = tree.nodes.length;
  const { folderSpec, fileSpec, maxFileSize } = makeSpecs(tree, opts.scale);

  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const r = new Float32Array(n);
  const sys = new Float32Array(n);
  const visible = new Uint8Array(n);
  const open = new Uint8Array(n);
  const lx = new Float32Array(n);
  const ly = new Float32Array(n);

  const isOpen = (i: number): boolean => {
    const nd = tree.nodes[i]!;
    if (nd.kind !== "folder" || tree.children[i]!.length === 0) return false;
    if (opts.collapsed?.has(nd.id)) return false;
    if (opts.expanded?.has(nd.id)) return true;
    return tree.depth[i]! < opts.openDepth;
  };

  // 1) visibilidade (top-down) e raio do corpo
  for (const i of tree.order) {
    const p = tree.parent[i]!;
    visible[i] = p < 0 || (visible[p] && open[p]) ? 1 : 0;
    if (!visible[i]) continue;
    const nd = tree.nodes[i]!;
    r[i] = nd.kind === "folder" ? radiusFor(tree.total[i]!, folderSpec) : radiusFor(nd.size, fileSpec);
    open[i] = isOpen(i) ? 1 : 0;
  }

  // 2) raio dos sistemas (bottom-up) e posições locais dos filhos
  const arrange = (kids: number[], bodyR: number): number => {
    kids.sort((a, b) => sys[b]! - sys[a]!);
    let j = 0;
    let prevRho = 0;
    let prevMax = 0;
    let first = true;
    let outer = bodyR;
    while (j < kids.length) {
      const maxS = sys[kids[j]!]!;
      const rho = first ? bodyR + maxS + GAP : prevRho + prevMax + maxS + GAP;
      const start = j;
      let W = 0;
      while (j < kids.length) {
        const w = 2 * Math.asin(Math.min(1, (sys[kids[j]!]! + PAD) / rho));
        if (j > start && W + w > TWO_PI) break;
        W += w;
        j++;
      }
      const count = j - start;
      const extra = count > 1 ? Math.max(0, TWO_PI - W) / count : 0;
      let ang = spin(kids[start]!);
      for (let k = start; k < j; k++) {
        const kid = kids[k]!;
        const w = 2 * Math.asin(Math.min(1, (sys[kid]! + PAD) / rho));
        ang += w / 2;
        lx[kid] = Math.cos(ang) * rho;
        ly[kid] = Math.sin(ang) * rho;
        ang += w / 2 + extra;
      }
      prevRho = rho;
      prevMax = maxS;
      first = false;
      outer = rho + maxS;
    }
    return outer;
  };

  for (let k = tree.order.length - 1; k >= 0; k--) {
    const i = tree.order[k]!;
    if (!visible[i]) continue;
    if (!open[i]) {
      sys[i] = r[i]!;
      continue;
    }
    const outer = arrange(tree.children[i]!.slice(), r[i]!);
    sys[i] = Math.max(r[i]!, outer);
  }

  // 3) raízes (várias raízes orbitam um centro virtual)
  let extent: number;
  if (tree.roots.length === 1) {
    extent = sys[tree.roots[0]!]!;
  } else if (tree.roots.length > 1) {
    extent = arrange(tree.roots.slice(), 0);
    for (const i of tree.roots) {
      x[i] = lx[i]!;
      y[i] = ly[i]!;
    }
  } else {
    extent = 0;
  }

  // 4) posições absolutas (top-down)
  for (const i of tree.order) {
    if (!visible[i] || !open[i]) continue;
    for (const c of tree.children[i]!) {
      x[c] = x[i]! + lx[c]!;
      y[c] = y[i]! + ly[c]!;
    }
  }

  return { x, y, r, sys, visible, open, folderSpec, fileSpec, maxFileSize, extent };
}
