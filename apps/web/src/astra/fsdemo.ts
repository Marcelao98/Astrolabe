import { Executor, MemoryFsDriver, normalizePath, type ActionResult, type ExecutionLog, type Plan } from "@astrolabe/actions";
import type { FsNode } from "@astrolabe/core";

/** Modo demonstração: o "disco" é a própria amostra, em memória. Nada toca o computador de verdade. */
export function createDemoExecutor(nodes: FsNode[]) {
  const root = nodes.find((n) => n.parentId === null)!.path;
  const driver = new MemoryFsDriver(nodes.map((n) => n.path), [root]);
  return new Executor({ driver, quarantineRoot: `${root}/.astrolabe-quarantine` });
}

const dirname = (p: string) => p.slice(0, p.lastIndexOf("/"));
const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** Estado do mapa depois de aplicar (o que deu certo e não foi desfeito) de uma execução. */
export function applyResults(base: FsNode[], plan: Plan, log: ExecutionLog): FsNode[] {
  const done = new Map<string, ActionResult>();
  for (const r of log.results) if (r.status === "done" && !log.undone.includes(r.actionId)) done.set(r.actionId, r);
  let nodes = base;
  for (const a of plan.actions) {
    if (!done.has(a.id)) continue;
    const from = normalizePath(a.from);
    if (a.kind === "move" && a.to) nodes = moveSubtree(nodes, from, normalizePath(a.to));
    else nodes = nodes.filter((n) => n.path !== from && !n.path.startsWith(`${from}/`));
  }
  return nodes;
}

function moveSubtree(nodes: FsNode[], from: string, to: string): FsNode[] {
  const byPath = new Map(nodes.map((n) => [n.path, n]));
  const out = nodes.map((n) => ({ ...n }));
  const extra: FsNode[] = [];
  const have = new Set(out.map((n) => n.path));
  const ensureFolder = (path: string): string => {
    const hit = byPath.get(path) ?? out.find((n) => n.path === path) ?? extra.find((n) => n.path === path);
    if (hit) return hit.id;
    const parent = path.includes("/") ? ensureFolder(dirname(path)) : null;
    const t = out[0]?.modifiedAt ?? 0;
    const node: FsNode = { id: `new:${path}`, sourceId: out[0]?.sourceId ?? "sample", path, name: basename(path), kind: "folder", size: 0, modifiedAt: t, accessedAt: t, parentId: parent, category: "other" };
    extra.push(node);
    have.add(path);
    return node.id;
  };
  const newParent = ensureFolder(dirname(to));
  for (const n of out) {
    if (n.path === from) {
      n.path = to;
      n.name = basename(to);
      n.parentId = newParent;
    } else if (n.path.startsWith(`${from}/`)) {
      n.path = to + n.path.slice(from.length);
    }
  }
  return [...out, ...extra];
}
