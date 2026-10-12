import type { Tree } from "./aggregate";
import { subtreeOf } from "./aggregate";
import type { Category } from "./categories";
import type { DuplicateInfo } from "./duplicates";

/** Filtro estruturado que a Astra monta a partir do que o usuário pede. */
export interface NodeQuery {
  kind?: "file" | "folder";
  categories?: Category[];
  /** bytes */
  minSize?: number;
  maxSize?: number;
  /** não acessado há pelo menos N dias */
  notAccessedDays?: number;
  /** acessado nos últimos N dias */
  accessedWithinDays?: number;
  /** texto que o caminho deve conter (sem diferenciar maiúsculas) */
  pathContains?: string;
  /** extensões sem ponto */
  exts?: string[];
  duplicatesOnly?: boolean;
  /** restringe a uma subárvore */
  underNodeId?: string;
  limit?: number;
  sortBy?: "size" | "age" | "name";
}

const DAY = 86_400_000;

export function queryNodes(tree: Tree, q: NodeQuery, ctx: { now: number; dup?: DuplicateInfo }): number[] {
  let pool: number[];
  if (q.underNodeId) {
    const root = tree.index.get(q.underNodeId);
    pool = root === undefined ? [] : subtreeOf(tree, root);
  } else {
    pool = tree.order;
  }
  const cats = q.categories ? new Set<string>(q.categories) : null;
  const exts = q.exts ? new Set(q.exts.map((e) => e.toLowerCase().replace(/^\./, ""))) : null;
  const needle = q.pathContains?.toLowerCase();
  const out: number[] = [];
  for (const i of pool) {
    const nd = tree.nodes[i]!;
    if (q.kind && nd.kind !== q.kind) continue;
    if (cats && !cats.has(nd.category)) continue;
    const size = nd.kind === "folder" ? tree.total[i]! : nd.size;
    if (q.minSize !== undefined && size < q.minSize) continue;
    if (q.maxSize !== undefined && size > q.maxSize) continue;
    if (q.notAccessedDays !== undefined && ctx.now - nd.accessedAt < q.notAccessedDays * DAY) continue;
    if (q.accessedWithinDays !== undefined && ctx.now - nd.accessedAt > q.accessedWithinDays * DAY) continue;
    if (needle && !nd.path.toLowerCase().includes(needle)) continue;
    if (exts && (!nd.ext || !exts.has(nd.ext))) continue;
    if (q.duplicatesOnly && (!ctx.dup || ctx.dup.groupOf[i]! < 0)) continue;
    out.push(i);
  }
  if (q.sortBy === "size") out.sort((a, b) => sizeOf(tree, b) - sizeOf(tree, a));
  else if (q.sortBy === "age") out.sort((a, b) => tree.nodes[a]!.accessedAt - tree.nodes[b]!.accessedAt);
  else if (q.sortBy === "name") out.sort((a, b) => tree.nodes[a]!.name.localeCompare(tree.nodes[b]!.name));
  return q.limit ? out.slice(0, q.limit) : out;
}

function sizeOf(tree: Tree, i: number): number {
  return tree.nodes[i]!.kind === "folder" ? tree.total[i]! : tree.nodes[i]!.size;
}

export function sumBytes(tree: Tree, indices: number[]): number {
  let s = 0;
  for (const i of indices) s += tree.nodes[i]!.kind === "file" ? tree.nodes[i]!.size : 0;
  return s;
}
