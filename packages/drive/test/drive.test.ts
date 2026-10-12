import { describe, expect, it } from "vitest";
import { Executor, buildPlan } from "@astrolabe/actions";
import { buildTree, findDuplicates } from "@astrolabe/core";
import { FOLDER_MIME, FetchDriveApi, scanDrive, DriveFsDriver, type DriveApi, type DriveFile } from "../src";

class FakeDrive implements DriveApi {
  files = new Map<string, DriveFile>();
  trashed: string[] = [];
  seq = 100;
  constructor(files: DriveFile[], private pageSize = 2) {
    for (const f of files) this.files.set(f.id, structuredClone(f));
  }
  async rootId() { return "root"; }
  async list(token?: string) {
    const all = [...this.files.values()];
    const start = Number(token ?? 0);
    const files = all.slice(start, start + this.pageSize);
    return { files, nextPageToken: start + this.pageSize < all.length ? String(start + this.pageSize) : undefined };
  }
  async createFolder(name: string, parentId: string) {
    const id = `new${this.seq++}`;
    this.files.set(id, { id, name, mimeType: FOLDER_MIME, parents: [parentId], ownedByMe: true });
    return id;
  }
  async move(id: string, o: { addParent?: string; removeParent?: string; name?: string }) {
    const f = this.files.get(id)!;
    f.parents = [...(f.parents ?? []).filter((p) => p !== o.removeParent), ...(o.addParent ? [o.addParent] : [])];
    if (o.name) f.name = o.name;
  }
  async trash(id: string) { this.trashed.push(id); this.files.delete(id); }
}

const T = "2024-01-02T03:04:05Z";
const fx: DriveFile[] = [
  { id: "d1", name: "Fotos", mimeType: FOLDER_MIME, parents: ["root"], ownedByMe: true },
  { id: "d2", name: "Trabalho", mimeType: FOLDER_MIME, parents: ["root"], ownedByMe: true },
  { id: "f1", name: "viagem.mp4", mimeType: "video/mp4", size: "5000000", md5Checksum: "aa", modifiedTime: T, parents: ["d1"], ownedByMe: true },
  { id: "f2", name: "viagem (1).mp4", mimeType: "video/mp4", size: "5000000", md5Checksum: "aa", modifiedTime: T, parents: ["d2"], ownedByMe: true },
  { id: "f3", name: "plano", mimeType: "application/vnd.google-apps.document", parents: ["d2"], ownedByMe: true },
  { id: "f4", name: "plano", mimeType: "application/vnd.google-apps.document", parents: ["d2"], ownedByMe: true },
  { id: "f5", name: "compartilhado.pdf", mimeType: "application/pdf", size: "10", parents: ["alheio"], ownedByMe: true },
  { id: "f6", name: "atalho", mimeType: "application/vnd.google-apps.shortcut", parents: ["root"], ownedByMe: true },
  { id: "f7", name: "dos outros.pdf", mimeType: "application/pdf", size: "99", parents: ["root"], ownedByMe: false },
  { id: "f8", name: "em duas pastas.pdf", mimeType: "application/pdf", size: "7", parents: ["d1", "d2"], ownedByMe: true },
];

describe("Google Drive", () => {
  it("escaneia com paginação, caminhos únicos e duplicados por MD5", async () => {
    const scan = await scanDrive(new FakeDrive(fx));
    const ids = scan.nodes.map((n) => n.id);
    expect(ids).not.toContain("f6"); // atalho
    expect(ids).not.toContain("f7"); // não é meu
    expect(new Set(scan.nodes.map((n) => n.path)).size).toBe(scan.nodes.length);
    expect(scan.nodes.find((n) => n.id === "f5")!.parentId).toBe("root"); // pai desconhecido → raiz
    expect(scan.nodes.find((n) => n.id === "f8")!.extraParentIds).toEqual(["d2"]);
    const tree = buildTree(scan.nodes);
    expect(findDuplicates(tree).wastedBytes).toBe(5_000_000);
    expect(tree.total[tree.roots[0]!]).toBe(5_000_000 * 2 + 10 + 7);
  });

  it("quarentena e desfazer no Drive passam pelo Executor", async () => {
    const api = new FakeDrive(fx);
    const scan = await scanDrive(api);
    const tree = buildTree(scan.nodes);
    const plan = buildPlan("dedupe", {}, { tree, now: Date.now(), dup: findDuplicates(tree) });
    expect(plan.actions).toHaveLength(1);
    const exec = new Executor({ driver: new DriveFsDriver(api, scan), quarantineRoot: "Meu Drive/.astrolabe-quarantine" });
    const log = await exec.execute(plan, { planId: plan.id, approvedAt: 1 });
    expect(log.results[0]!.status).toBe("done");
    const moved = api.files.get(plan.actions[0]!.nodeId)!;
    const qFolder = [...api.files.values()].find((f) => f.name === ".astrolabe-quarantine")!;
    expect(qFolder).toBeTruthy();
    expect(moved.parents).not.toContain("d1");
    const back = await exec.undo(plan, log);
    expect(back.undone).toHaveLength(1);
    const restored = api.files.get(plan.actions[0]!.nodeId)!;
    expect(restored.name).toBe(plan.actions[0]!.from.split("/").pop());
  });

  it("lixeira usa a lixeira do Drive", async () => {
    const api = new FakeDrive(fx);
    const scan = await scanDrive(api);
    const tree = buildTree(scan.nodes);
    const plan = buildPlan("selection", { ids: ["f5"], kind: "trash" }, { tree, now: Date.now(), dup: findDuplicates(tree) });
    const exec = new Executor({ driver: new DriveFsDriver(api, scan), quarantineRoot: "Meu Drive/.astrolabe-quarantine" });
    const log = await exec.execute(plan, { planId: plan.id, approvedAt: 1 });
    expect(log.results[0]).toMatchObject({ status: "done", location: "lixeira do Google Drive" });
    expect(api.trashed).toEqual(["f5"]);
  });

  it("FetchDriveApi manda o token e traduz erros", async () => {
    const seen: string[] = [];
    const ok = new FetchDriveApi("tok", (async (url: string, init?: RequestInit) => {
      seen.push(`${url}|${(init?.headers as Record<string, string>).Authorization}`);
      return new Response(JSON.stringify({ id: "root" }), { status: 200 });
    }) as typeof fetch);
    expect(await ok.rootId()).toBe("root");
    expect(seen[0]).toContain("Bearer tok");
    const bad = new FetchDriveApi("tok", (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch);
    await expect(bad.rootId()).rejects.toThrow(/expirou/);
  });
});
