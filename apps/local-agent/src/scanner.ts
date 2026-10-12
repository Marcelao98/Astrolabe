import { createHash } from "node:crypto";
import { lstat, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { categoryOfExt, extOf, type FsNode } from "@astrolabe/core";
import { normalizePath } from "@astrolabe/actions";

export interface ScanOptions {
  /** Teto de itens, para não derrubar o navegador. */
  maxNodes?: number;
  /** Calcula hash rápido (início+fim) dos arquivos com tamanho repetido, para achar duplicados. */
  hashDuplicates?: boolean;
  minHashSize?: number;
  onProgress?(count: number): void;
  signal?: AbortSignal;
  /** Pastas a ignorar pelo nome (minúsculo). */
  skipNames?: Set<string>;
}

export interface ScanResult {
  nodes: FsNode[];
  truncated: boolean;
  errors: number;
}

const DEFAULT_SKIP = new Set(["$recycle.bin", "system volume information", ".astrolabe-quarantine", "node_modules/.cache"]);

/** Hash barato: tamanho + 64 KB do começo + 64 KB do fim. Basta para sugerir duplicados; o usuário revisa. */
export async function quickHash(path: string, size: number): Promise<string | undefined> {
  const CH = 64 * 1024;
  let fh;
  try {
    fh = await open(path, "r");
    const h = createHash("sha1");
    const head = Buffer.alloc(Math.min(CH, size));
    await fh.read(head, 0, head.length, 0);
    h.update(head);
    if (size > CH * 2) {
      const tail = Buffer.alloc(CH);
      await fh.read(tail, 0, CH, size - CH);
      h.update(tail);
    }
    return h.digest("hex").slice(0, 20);
  } catch {
    return undefined;
  } finally {
    await fh?.close();
  }
}

/** Percorre uma pasta e devolve o mesmo formato de nós que a amostra. Não segue links simbólicos. */
export async function scanDirectory(root: string, opts: ScanOptions = {}): Promise<ScanResult> {
  const max = opts.maxNodes ?? 400_000;
  const skip = opts.skipNames ?? DEFAULT_SKIP;
  const rootPath = normalizePath(root).replace(/\/$/, "") || "/";
  const nodes: FsNode[] = [];
  let errors = 0;
  let truncated = false;
  let seq = 0;
  const sourceId = "local";

  const rootStat = await lstat(root);
  nodes.push({
    id: `n${seq++}`,
    sourceId,
    path: rootPath,
    name: rootPath.split("/").pop() || rootPath,
    kind: "folder",
    size: 0,
    modifiedAt: rootStat.mtimeMs,
    accessedAt: rootStat.atimeMs,
    parentId: null,
    category: "other",
  });

  const queue: { dir: string; path: string; id: string }[] = [{ dir: root, path: rootPath, id: nodes[0]!.id }];
  while (queue.length && !truncated) {
    if (opts.signal?.aborted) throw new Error("Escaneamento cancelado.");
    const cur = queue.pop()!;
    let entries;
    try {
      entries = await readdir(cur.dir, { withFileTypes: true });
    } catch {
      errors++;
      continue;
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      if (skip.has(e.name.toLowerCase())) continue;
      if (nodes.length >= max) {
        truncated = true;
        break;
      }
      const full = join(cur.dir, e.name);
      let st;
      try {
        st = await lstat(full);
      } catch {
        errors++;
        continue;
      }
      const path = `${cur.path === "/" ? "" : cur.path}/${e.name}`;
      const id = `n${seq++}`;
      if (e.isDirectory()) {
        nodes.push({ id, sourceId, path, name: e.name, kind: "folder", size: 0, modifiedAt: st.mtimeMs, accessedAt: st.atimeMs, parentId: cur.id, category: "other" });
        queue.push({ dir: full, path, id });
      } else if (e.isFile()) {
        const ext = extOf(e.name);
        nodes.push({ id, sourceId, path, name: e.name, kind: "file", size: st.size, modifiedAt: st.mtimeMs, accessedAt: st.atimeMs, parentId: cur.id, ext, category: categoryOfExt(ext) });
      }
    }
    opts.onProgress?.(nodes.length);
  }

  if (opts.hashDuplicates ?? true) {
    const minSize = opts.minHashSize ?? 64 * 1024;
    const bySize = new Map<number, FsNode[]>();
    for (const n of nodes) {
      if (n.kind !== "file" || n.size < minSize) continue;
      const l = bySize.get(n.size);
      if (l) l.push(n);
      else bySize.set(n.size, [n]);
    }
    for (const group of bySize.values()) {
      if (group.length < 2) continue;
      for (const n of group) n.hash = await quickHash(join(root, n.path.slice(rootPath.length)), n.size);
    }
  }
  return { nodes, truncated, errors };
}
