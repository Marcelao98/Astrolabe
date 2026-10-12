import { normalizePath } from "./safety";
import type { FsDriver } from "./executor";

/** Sistema de arquivos em memória: usado nos testes e no modo demonstração da interface. */
export class MemoryFsDriver implements FsDriver {
  readonly roots: string[];
  private entries = new Set<string>();
  readonly trashed: string[] = [];

  constructor(paths: Iterable<string>, roots: string[]) {
    this.roots = roots.map(normalizePath);
    for (const p of paths) this.entries.add(normalizePath(p));
  }

  async exists(path: string): Promise<boolean> {
    return this.entries.has(normalizePath(path));
  }

  async move(from: string, to: string): Promise<void> {
    const f = normalizePath(from);
    const t = normalizePath(to);
    if (!this.entries.has(f)) throw new Error("Origem não existe.");
    if (this.entries.has(t)) throw new Error("Destino já existe.");
    const moved: [string, string][] = [];
    for (const e of this.entries) {
      if (e === f || e.startsWith(`${f}/`)) moved.push([e, t + e.slice(f.length)]);
    }
    for (const [old] of moved) this.entries.delete(old);
    for (const [, next] of moved) this.entries.add(next);
  }

  async trash(path: string): Promise<string | undefined> {
    const f = normalizePath(path);
    for (const e of [...this.entries]) if (e === f || e.startsWith(`${f}/`)) this.entries.delete(e);
    this.trashed.push(f);
    return `lixeira://${f}`;
  }

  has(path: string): boolean {
    return this.entries.has(normalizePath(path));
  }

  get size(): number {
    return this.entries.size;
  }
}
