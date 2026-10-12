import type { FsNode } from "./types";

/** Índice da árvore com totais agregados (a "ponderação" por tamanho). */
export interface Tree {
  nodes: FsNode[];
  index: Map<string, number>;
  parent: Int32Array;
  children: number[][];
  roots: number[];
  /** Ordem BFS a partir das raízes: pais antes dos filhos. */
  order: number[];
  depth: Int32Array;
  /** Bytes totais (próprio + descendentes). */
  total: Float64Array;
  /** Quantidade de arquivos descendentes (1 para um arquivo). */
  count: Int32Array;
}

export function buildTree(nodes: FsNode[]): Tree {
  const n = nodes.length;
  const index = new Map<string, number>();
  for (let i = 0; i < n; i++) index.set(nodes[i]!.id, i);

  const parent = new Int32Array(n).fill(-1);
  const children: number[][] = Array.from({ length: n }, () => []);
  const roots: number[] = [];
  for (let i = 0; i < n; i++) {
    const pid = nodes[i]!.parentId;
    const pi = pid == null ? undefined : index.get(pid);
    if (pi === undefined || pi === i) {
      roots.push(i);
    } else {
      parent[i] = pi;
      children[pi]!.push(i);
    }
  }

  const order: number[] = [...roots];
  const depth = new Int32Array(n);
  for (let k = 0; k < order.length; k++) {
    const i = order[k]!;
    for (const c of children[i]!) {
      depth[c] = depth[i]! + 1;
      order.push(c);
    }
  }

  const total = new Float64Array(n);
  const count = new Int32Array(n);
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k]!;
    const nd = nodes[i]!;
    total[i]! += nd.size;
    if (nd.kind === "file") count[i]! += 1;
    const p = parent[i]!;
    if (p >= 0) {
      total[p]! += total[i]!;
      count[p]! += count[i]!;
    }
  }

  return { nodes, index, parent, children, roots, order, depth, total, count };
}

export interface CategoryTotal {
  category: string;
  bytes: number;
  files: number;
}

/** Soma de bytes e arquivos por categoria, dentro de uma subárvore (ou de tudo). */
export function totalsByCategory(tree: Tree, rootIndex?: number): CategoryTotal[] {
  const acc = new Map<string, CategoryTotal>();
  const visit = (i: number) => {
    const nd = tree.nodes[i]!;
    if (nd.kind === "file") {
      const cur = acc.get(nd.category) ?? { category: nd.category, bytes: 0, files: 0 };
      cur.bytes += nd.size;
      cur.files += 1;
      acc.set(nd.category, cur);
    }
  };
  if (rootIndex === undefined) {
    for (const i of tree.order) visit(i);
  } else {
    const stack = [rootIndex];
    while (stack.length) {
      const i = stack.pop()!;
      visit(i);
      for (const c of tree.children[i]!) stack.push(c);
    }
  }
  return [...acc.values()].sort((a, b) => b.bytes - a.bytes);
}

/** Os N arquivos mais pesados (índices). */
export function topFiles(tree: Tree, n: number): number[] {
  const files: number[] = [];
  for (const i of tree.order) if (tree.nodes[i]!.kind === "file") files.push(i);
  files.sort((a, b) => tree.nodes[b]!.size - tree.nodes[a]!.size);
  return files.slice(0, n);
}

/** As N pastas com maior total (excluindo a raiz). */
export function topFolders(tree: Tree, n: number): number[] {
  const folders: number[] = [];
  for (const i of tree.order) {
    if (tree.nodes[i]!.kind === "folder" && tree.parent[i]! >= 0) folders.push(i);
  }
  folders.sort((a, b) => tree.total[b]! - tree.total[a]!);
  return folders.slice(0, n);
}

/** Descendentes (índices) de um nó, incluindo ele mesmo. */
export function subtreeOf(tree: Tree, rootIndex: number): number[] {
  const out: number[] = [];
  const stack = [rootIndex];
  while (stack.length) {
    const i = stack.pop()!;
    out.push(i);
    for (const c of tree.children[i]!) stack.push(c);
  }
  return out;
}

export function ancestorsOf(tree: Tree, i: number): number[] {
  const out: number[] = [];
  let p = tree.parent[i]!;
  while (p >= 0) {
    out.push(p);
    p = tree.parent[p]!;
  }
  return out;
}
