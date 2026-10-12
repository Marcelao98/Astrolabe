import { access, lstat, mkdir, realpath, rename } from "node:fs/promises";
import { dirname, sep } from "node:path";
import type { FsDriver } from "./executor";
import { isInside, normalizePath } from "./safety";

export interface LocalFsOptions {
  roots: string[];
  /** Injetável para testes; por padrão usa o pacote "trash" (Lixeira do sistema). */
  trashFn?: (path: string) => Promise<void>;
}

/** Driver de disco real. Só opera dentro das raízes e não segue links para fora delas. */
export class LocalFsDriver implements FsDriver {
  readonly roots: string[];
  private realRoots: string[] | null = null;
  private trashFn: (path: string) => Promise<void>;

  constructor(opts: LocalFsOptions) {
    this.roots = opts.roots.map(normalizePath);
    this.trashFn =
      opts.trashFn ??
      (async (p) => {
        const mod = await import("trash");
        await mod.default([p]);
      });
  }

  private async getRealRoots(): Promise<string[]> {
    if (!this.realRoots) {
      this.realRoots = await Promise.all(this.roots.map(async (r) => normalizePath(await realpath(r))));
    }
    return this.realRoots;
  }

  /** A pasta que contém o caminho (resolvendo links) precisa continuar dentro das raízes. */
  private async assertInside(path: string): Promise<void> {
    const real = normalizePath(await realpath(dirname(path)));
    const roots = await this.getRealRoots();
    if (!roots.some((r) => isInside(real, r))) throw new Error("O caminho aponta para fora das pastas permitidas (link simbólico?).");
  }

  async exists(path: string): Promise<boolean> {
    try {
      await lstat(path);
      return true;
    } catch {
      return false;
    }
  }

  async move(from: string, to: string): Promise<void> {
    await this.assertInside(from);
    await mkdir(dirname(to), { recursive: true });
    await this.assertInside(to);
    if (await this.exists(to)) throw new Error("Destino já existe.");
    try {
      await rename(from, to);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EXDEV") {
        throw new Error("Mover entre unidades diferentes não é suportado; use a quarentena na mesma unidade.");
      }
      throw e;
    }
  }

  async trash(path: string): Promise<string | undefined> {
    await this.assertInside(path);
    await access(path);
    await this.trashFn(path);
    return "Lixeira do sistema";
  }
}

export { sep };
