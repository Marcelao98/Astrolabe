import { quadtree, type Quadtree } from "d3-quadtree";
import {
  builtinLenses,
  computeLayout,
  findDuplicates,
  type CustomLabel,
  type DuplicateInfo,
  type Layout,
  type Lens,
  type LensContext,
  type ScaleMode,
  type Tree,
} from "@astrolabe/core";
import { quantize } from "./sprites";

/** Estado do mapa: layout, pintura por lente, seleção e índice espacial. */
export class GalaxyScene {
  readonly tree: Tree;
  readonly now: number;
  readonly dup: DuplicateInfo;
  layout!: Layout;

  scale: ScaleMode = "log";
  openDepth = 2;
  expanded = new Set<string>();
  collapsed = new Set<string>();

  lens: Lens = builtinLenses[0]!;
  labels?: Map<number, CustomLabel>;
  /** Quando definido, tudo fora do conjunto esmaece (foco da Astra ou de uma categoria). */
  focus: Set<number> | null = null;
  selection = new Set<number>();
  hover = -1;

  readonly color: Uint32Array;
  readonly alpha: Float32Array;
  /** Chave de lote por nó: cor quantizada (12 bits) + nível de alpha (2 bits). */
  readonly bucket: Uint16Array;
  /** Pixel ABGR (little-endian) de cada nó, para o buffer de pontos minúsculos. */
  readonly packed: Uint32Array;
  /** Cor da "região" (nebulosa) de cada nó: os sistemas grandes ganham tons distintos. */
  readonly region: Uint32Array;

  visibleFolders: number[] = [];
  visibleFiles: number[] = [];
  private qt!: Quadtree<number>;
  private maxBody = 36;
  /** Incrementa a cada relayout; quem guarda cache externo usa para invalidar. */
  version = 0;

  constructor(tree: Tree, now: number) {
    this.tree = tree;
    this.now = now;
    this.dup = findDuplicates(tree);
    const n = tree.nodes.length;
    this.color = new Uint32Array(n);
    this.alpha = new Float32Array(n);
    this.bucket = new Uint16Array(n);
    this.packed = new Uint32Array(n);
    this.region = new Uint32Array(n);
    const palette = [0x7c6cff, 0x22d3ee, 0xf472b6, 0x34d399, 0xfb923c, 0xa78bfa, 0x60a5fa, 0xfbbf24];
    for (const i of tree.order) {
      const p = tree.parent[i]!;
      if (p < 0) {
        this.region[i] = 0x8892c8;
      } else if (tree.depth[i]! <= 3) {
        const k = tree.children[p]!.indexOf(i);
        this.region[i] = palette[(k + tree.depth[i]! * 3) % palette.length]!;
      } else {
        this.region[i] = this.region[p]!;
      }
    }
    this.relayout();
  }

  get lensContext(): LensContext {
    return {
      tree: this.tree,
      now: this.now,
      dup: this.dup,
      maxFileSize: this.layout?.maxFileSize ?? 1,
      labels: this.labels,
    };
  }

  relayout(): void {
    this.layout = computeLayout(this.tree, {
      scale: this.scale,
      openDepth: this.openDepth,
      expanded: this.expanded,
      collapsed: this.collapsed,
    });
    const folders: number[] = [];
    const files: number[] = [];
    const vis: number[] = [];
    let maxBody = 1;
    for (const i of this.tree.order) {
      if (!this.layout.visible[i]) continue;
      vis.push(i);
      if (this.tree.nodes[i]!.kind === "folder") folders.push(i);
      else files.push(i);
      if (this.layout.r[i]! > maxBody) maxBody = this.layout.r[i]!;
    }
    this.visibleFolders = folders;
    this.visibleFiles = files;
    this.maxBody = maxBody;
    const { x, y } = this.layout;
    this.qt = quadtree<number>()
      .x((i) => x[i]!)
      .y((i) => y[i]!)
      .addAll(vis);
    this.version++;
    this.repaint();
  }

  /** Recalcula só as cores (trocar de lente ou de foco não precisa refazer o layout). */
  repaint(): void {
    const ctx = this.lensContext;
    const out = { color: 0, alpha: 1 };
    const focus = this.focus;
    for (const i of this.tree.order) {
      if (!this.layout.visible[i]) continue;
      this.lens.paint(i, ctx, out);
      let a = out.alpha;
      if (focus && !focus.has(i) && this.tree.nodes[i]!.kind === "file") a *= 0.12;
      this.color[i] = out.color;
      this.alpha[i] = a;
      const level = a > 0.8 ? 3 : a > 0.5 ? 2 : a > 0.25 ? 1 : 0;
      this.bucket[i] = (quantize(out.color) << 2) | level;
      const c = out.color;
      const byte = Math.round(255 * Math.min(1, Math.max(0.08, a >= 0.5 ? 0.45 + 0.55 * a : a * 0.9)));
      this.packed[i] = ((byte << 24) | ((c & 255) << 16) | (((c >> 8) & 255) << 8) | ((c >> 16) & 255)) >>> 0;
    }
  }

  setLens(lens: Lens, labels?: Map<number, CustomLabel>): void {
    this.lens = lens;
    this.labels = labels;
    this.repaint();
  }

  setScale(mode: ScaleMode): void {
    if (this.scale === mode) return;
    this.scale = mode;
    this.relayout();
  }

  setFocus(indices: Iterable<number> | null): void {
    this.focus = indices ? new Set(indices) : null;
    this.repaint();
  }

  isOpen(i: number): boolean {
    return this.layout.open[i] === 1;
  }

  toggle(i: number): void {
    const nd = this.tree.nodes[i]!;
    if (nd.kind !== "folder" || this.tree.children[i]!.length === 0) return;
    if (this.isOpen(i)) {
      this.expanded.delete(nd.id);
      this.collapsed.add(nd.id);
    } else {
      this.collapsed.delete(nd.id);
      this.expanded.add(nd.id);
    }
    this.relayout();
  }

  /** Abre todos os pais para o nó ficar visível; retorna true se o layout mudou. */
  reveal(i: number): boolean {
    if (this.layout.visible[i]) return false;
    let p = this.tree.parent[i]!;
    while (p >= 0) {
      const nd = this.tree.nodes[p]!;
      this.collapsed.delete(nd.id);
      this.expanded.add(nd.id);
      p = this.tree.parent[p]!;
    }
    this.relayout();
    return true;
  }

  collapseAll(depth = 1): void {
    this.expanded.clear();
    this.collapsed.clear();
    this.openDepth = depth;
    this.relayout();
  }

  /** Nó sob um ponto do mundo (o mais "dentro" de um corpo). -1 se nada. */
  pick(wx: number, wy: number, tol: number): number {
    let best = -1;
    let bestScore = Infinity;
    const reach = this.maxBody + tol;
    const { x, y, r } = this.layout;
    this.qt.visit((node, x0, y0, x1, y1) => {
      if (x1 < wx - reach || x0 > wx + reach || y1 < wy - reach || y0 > wy + reach) return true;
      if (!node.length) {
        let leaf: { data: number; next?: unknown } | undefined = node as unknown as { data: number; next?: unknown };
        while (leaf) {
          const i = leaf.data;
          const d = Math.hypot(x[i]! - wx, y[i]! - wy);
          const rad = Math.max(r[i]!, tol * 0.6);
          if (d <= rad + tol * 0.35) {
            const score = d - r[i]!;
            if (score < bestScore) {
              bestScore = score;
              best = i;
            }
          }
          leaf = leaf.next as typeof leaf;
        }
      }
      return false;
    });
    return best;
  }

  /** Raio (mundo) que enquadra um nó e seu sistema. */
  focusRadius(i: number): number {
    return Math.max(this.layout.sys[i]!, this.layout.r[i]!) * 1.25 + 4;
  }
}
