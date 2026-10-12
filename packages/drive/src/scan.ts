import { categoryOfExt, extOf, type FsNode } from "@astrolabe/core";
import { FOLDER_MIME, SHORTCUT_MIME, type DriveApi, type DriveFile } from "./api";

export const DRIVE_ROOT_PATH = "Meu Drive";

export interface DriveScan {
  nodes: FsNode[];
  /** caminho → id do Drive (único por caminho). */
  pathToId: Map<string, string>;
  rootId: string;
  truncated: boolean;
}

const safeName = (n: string) => n.replace(/[\\/]/g, "∕");

/**
 * Lê o Drive (só metadados) e monta o mesmo formato de nós dos outros discos.
 * - arquivos nativos do Google (Docs/Sheets) não ocupam cota: tamanho 0;
 * - um arquivo com mais de uma pasta vira nó com pai principal + extraParentIds;
 * - itens soltos (compartilhados, sem pai conhecido) ficam na raiz;
 * - nomes repetidos na mesma pasta ganham um sufixo [id] para o caminho ser único.
 */
export async function scanDrive(api: DriveApi, opts: { maxNodes?: number; onProgress?(n: number): void } = {}): Promise<DriveScan> {
  const max = opts.maxNodes ?? 300_000;
  const rootId = await api.rootId();
  const files: DriveFile[] = [];
  let token: string | undefined;
  let truncated = false;
  do {
    const page = await api.list(token);
    for (const f of page.files) if (f.mimeType !== SHORTCUT_MIME && f.ownedByMe !== false) files.push(f);
    token = page.nextPageToken;
    opts.onProgress?.(files.length);
    if (files.length >= max) {
      truncated = Boolean(token);
      token = undefined;
    }
  } while (token);

  const byId = new Map(files.map((f) => [f.id, f]));
  const parentOf = (f: DriveFile): string => {
    const p = f.parents?.find((x) => x === rootId || byId.has(x));
    return p ?? rootId;
  };

  // caminhos únicos, pais antes dos filhos
  const pathOf = new Map<string, string>([[rootId, DRIVE_ROOT_PATH]]);
  const taken = new Set<string>([DRIVE_ROOT_PATH]);
  const resolve = (f: DriveFile, guard = 0): string => {
    const known = pathOf.get(f.id);
    if (known) return known;
    const pid = parentOf(f);
    const parentPath = pid === rootId || guard > 64 ? DRIVE_ROOT_PATH : resolve(byId.get(pid)!, guard + 1);
    let path = `${parentPath}/${safeName(f.name)}`;
    if (taken.has(path)) path = `${parentPath}/${safeName(f.name)} [${f.id.slice(0, 6)}]`;
    taken.add(path);
    pathOf.set(f.id, path);
    return path;
  };

  const t0 = Date.now();
  const nodes: FsNode[] = [
    { id: rootId, sourceId: "drive", path: DRIVE_ROOT_PATH, name: DRIVE_ROOT_PATH, kind: "folder", size: 0, modifiedAt: t0, accessedAt: t0, parentId: null, category: "other" },
  ];
  const pathToId = new Map<string, string>([[DRIVE_ROOT_PATH, rootId]]);
  for (const f of files) {
    const path = resolve(f);
    const isFolder = f.mimeType === FOLDER_MIME;
    const ext = isFolder ? undefined : extOf(f.name);
    const modified = f.modifiedTime ? Date.parse(f.modifiedTime) : t0;
    const extra = (f.parents ?? []).filter((p) => p !== parentOf(f) && (p === rootId || byId.has(p)));
    nodes.push({
      id: f.id,
      sourceId: "drive",
      path,
      name: path.slice(path.lastIndexOf("/") + 1),
      kind: isFolder ? "folder" : "file",
      size: isFolder ? 0 : Number(f.size ?? 0) || 0,
      modifiedAt: modified,
      accessedAt: f.viewedByMeTime ? Date.parse(f.viewedByMeTime) : modified,
      parentId: parentOf(f),
      extraParentIds: extra.length ? extra : undefined,
      hash: f.md5Checksum,
      ext,
      category: isFolder ? "other" : categoryOfExt(ext),
    });
    pathToId.set(path, f.id);
  }
  return { nodes, pathToId, rootId, truncated };
}
