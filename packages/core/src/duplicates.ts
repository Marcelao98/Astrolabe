import type { Tree } from "./aggregate";

export interface DuplicateInfo {
  /** Cada grupo é uma lista de índices de arquivos com o mesmo hash. */
  groups: number[][];
  /** Índice do grupo de cada nó, ou -1. */
  groupOf: Int32Array;
  /** Bytes que sobrariam se só uma cópia de cada grupo ficasse. */
  wastedBytes: number;
}

export function findDuplicates(tree: Tree, minSize = 1): DuplicateInfo {
  const byHash = new Map<string, number[]>();
  for (const i of tree.order) {
    const nd = tree.nodes[i]!;
    if (nd.kind !== "file" || !nd.hash || nd.size < minSize) continue;
    const key = `${nd.size}:${nd.hash}`;
    const list = byHash.get(key);
    if (list) list.push(i);
    else byHash.set(key, [i]);
  }
  const groups: number[][] = [];
  const groupOf = new Int32Array(tree.nodes.length).fill(-1);
  let wasted = 0;
  for (const list of byHash.values()) {
    if (list.length < 2) continue;
    const g = groups.length;
    groups.push(list);
    for (const i of list) groupOf[i] = g;
    wasted += tree.nodes[list[0]!]!.size * (list.length - 1);
  }
  groups.sort((a, b) => b.length * tree.nodes[b[0]!]!.size - a.length * tree.nodes[a[0]!]!.size);
  // reindexa após ordenar
  groupOf.fill(-1);
  groups.forEach((list, g) => {
    for (const i of list) groupOf[i] = g;
  });
  return { groups, groupOf, wastedBytes: wasted };
}
