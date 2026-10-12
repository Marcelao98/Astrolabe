import { normalizePath, type FsDriver } from "@astrolabe/actions";
import type { DriveApi } from "./api";
import { DRIVE_ROOT_PATH, type DriveScan } from "./scan";

/**
 * Faz o Executor trabalhar no Drive. "Quarentena" é uma pasta do próprio Drive
 * (Meu Drive/.astrolabe-quarantine) e a lixeira é a lixeira do Drive (restaurável por 30 dias).
 */
export class DriveFsDriver implements FsDriver {
  readonly roots = [DRIVE_ROOT_PATH];
  private ids: Map<string, string>;
  /** pai de cada item conhecido (para remover o pai certo ao mover). */
  private parents = new Map<string, string>();

  constructor(
    private api: DriveApi,
    scan: DriveScan,
  ) {
    this.ids = new Map(scan.pathToId);
    for (const n of scan.nodes) if (n.parentId) this.parents.set(n.id, n.parentId);
  }

  async exists(path: string) {
    return this.ids.has(normalizePath(path));
  }

  private async ensureFolder(path: string): Promise<string> {
    const p = normalizePath(path);
    const have = this.ids.get(p);
    if (have) return have;
    const cut = p.lastIndexOf("/");
    if (cut < 0) throw new Error("Pasta fora do Drive.");
    const parentId = await this.ensureFolder(p.slice(0, cut));
    const id = await this.api.createFolder(p.slice(cut + 1), parentId);
    this.ids.set(p, id);
    this.parents.set(id, parentId);
    return id;
  }

  async move(from: string, to: string) {
    const f = normalizePath(from);
    const t = normalizePath(to);
    const id = this.ids.get(f);
    if (!id) throw new Error("Origem não existe.");
    if (this.ids.has(t)) throw new Error("Destino já existe.");
    const cut = t.lastIndexOf("/");
    const newParent = await this.ensureFolder(t.slice(0, cut));
    const name = t.slice(cut + 1);
    await this.api.move(id, { addParent: newParent, removeParent: this.parents.get(id), name });
    this.parents.set(id, newParent);
    // atualiza os caminhos do item e de tudo o que estava dentro dele
    for (const [p, v] of [...this.ids]) {
      if (p === f || p.startsWith(`${f}/`)) {
        this.ids.delete(p);
        this.ids.set(t + p.slice(f.length), v);
      }
    }
  }

  async trash(path: string) {
    const p = normalizePath(path);
    const id = this.ids.get(p);
    if (!id) throw new Error("Item não existe.");
    await this.api.trash(id);
    for (const k of [...this.ids.keys()]) if (k === p || k.startsWith(`${p}/`)) this.ids.delete(k);
    return "lixeira do Google Drive";
  }
}
