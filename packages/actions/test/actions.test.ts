import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SAMPLE_NOW, buildTree, findDuplicates, generateSample } from "@astrolabe/core";
import {
  ExecutionError,
  Executor,
  MemoryFsDriver,
  buildPlan,
  isProtectedPath,
  normalizePath,
  type Approval,
  type Plan,
} from "../src";
import { LocalFsDriver } from "../src/node";

const sample = () => {
  const nodes = generateSample({ files: 4000 });
  const tree = buildTree(nodes);
  const dup = findDuplicates(tree);
  return { nodes, tree, ctx: { tree, now: SAMPLE_NOW, dup } };
};
const approve = (plan: Plan): Approval => ({ planId: plan.id, approvedAt: Date.now() });

describe("segurança de caminhos", () => {
  it("normaliza e bloqueia travessias", () => {
    expect(normalizePath("C:\\Users\\a\\..\\b//c/./d")).toBe("C:/Users/b/c/d");
    expect(normalizePath("/a/b/../../../x")).toBe("/x");
  });
  it("protege o sistema", () => {
    expect(isProtectedPath("C:/Windows/System32/x.dll")).toBe(true);
    expect(isProtectedPath("c:/program files (x86)/Steam/a")).toBe(true);
    expect(isProtectedPath("C:/Users/marcelo/Videos/a.mp4")).toBe(false);
    expect(isProtectedPath("C:/Users/marcelo/Projects/app/.git/config")).toBe(true);
  });
});

describe("estratégias de plano", () => {
  const { ctx, tree } = sample();

  it("dedupe mantém uma cópia por grupo e manda o resto para a quarentena", () => {
    const plan = buildPlan("dedupe", {}, ctx);
    expect(plan.actions.length).toBeGreaterThan(0);
    expect(plan.actions.every((a) => a.kind === "quarantine")).toBe(true);
    const keepers = new Set(plan.actions.map((a) => a.nodeId));
    for (const group of ctx.dup.groups) {
      expect(group.some((i) => !keepers.has(tree.nodes[i]!.id))).toBe(true); // alguém sobrou
    }
    expect(plan.totalBytes).toBeGreaterThan(0);
  });

  it("organize_by_type só move arquivos soltos, para subpastas do tipo", () => {
    const dl = tree.nodes.find((n) => n.name === "Downloads")!;
    const plan = buildPlan("organize_by_type", { folderId: dl.id }, ctx);
    expect(plan.actions.length).toBeGreaterThan(50);
    for (const a of plan.actions) {
      expect(a.kind).toBe("move");
      expect(a.to!.startsWith(`${dl.path}/_Organizado/`)).toBe(true);
    }
  });

  it("clean_junk ignora pastas do sistema e respeita a idade", () => {
    const plan = buildPlan("clean_junk", { minAgeDays: 60 }, ctx);
    for (const a of plan.actions) {
      expect(isProtectedPath(a.from)).toBe(false);
      const nd = tree.nodes[tree.index.get(a.nodeId)!]!;
      expect(SAMPLE_NOW - nd.accessedAt).toBeGreaterThanOrEqual(60 * 86_400_000);
    }
  });

  it("selection não duplica filhos de pasta já escolhida e recusa o sistema", () => {
    const folder = tree.nodes.find((n) => n.name === "Videos")!;
    const child = tree.nodes[tree.children[tree.index.get(folder.id)!]![0]!]!;
    const sys = tree.nodes.find((n) => n.name === "WinSxS")!;
    const plan = buildPlan("selection", { ids: [folder.id, child.id, sys.id], kind: "trash" }, ctx);
    expect(plan.actions.map((a) => a.nodeId)).toEqual([folder.id]);
    expect(plan.warnings.join(" ")).toContain("sistema");
  });
});

describe("executor (memória)", () => {
  const setup = () => {
    const { nodes, ctx } = sample();
    const driver = new MemoryFsDriver(nodes.map((n) => n.path), ["C:"]);
    const executor = new Executor({ driver, quarantineRoot: "C:/.astrolabe-quarantine" });
    return { nodes, ctx, driver, executor };
  };

  it("exige aprovação do plano certo", async () => {
    const { ctx, executor } = setup();
    const plan = buildPlan("dedupe", {}, ctx);
    await expect(executor.execute(plan, null)).rejects.toBeInstanceOf(ExecutionError);
    await expect(executor.execute(plan, { planId: "outro", approvedAt: 1 })).rejects.toMatchObject({ code: "plan_mismatch" });
  });

  it("dry-run não toca em nada", async () => {
    const { ctx, executor, driver } = setup();
    const plan = buildPlan("dedupe", {}, ctx);
    const before = driver.size;
    const log = await executor.execute(plan, null, { dryRun: true });
    expect(driver.size).toBe(before);
    expect(log.results.every((r) => r.status === "skipped")).toBe(true);
    expect(log.results[0]!.location).toContain(".astrolabe-quarantine");
  });

  it("quarentena e desfazer restauram tudo", async () => {
    const { ctx, executor, driver } = setup();
    const plan = buildPlan("dedupe", {}, ctx);
    const target = plan.actions[0]!;
    const log = await executor.execute(plan, approve(plan));
    expect(log.results.filter((r) => r.status === "done").length).toBe(plan.actions.length);
    expect(driver.has(target.from)).toBe(false);
    expect(driver.has(log.results[0]!.location!)).toBe(true);

    const undone = await executor.undo(plan, log);
    expect(undone.undone.length).toBe(plan.actions.length);
    expect(driver.has(target.from)).toBe(true);
  });

  it("recusa caminhos protegidos, fora da raiz e travessia no destino", async () => {
    const { executor } = setup();
    const bad: Plan = {
      id: "p",
      strategy: "x",
      title: "x",
      summary: "",
      createdAt: 0,
      warnings: [],
      totalBytes: 0,
      actions: [
        { id: "a1", kind: "quarantine", nodeId: "1", from: "C:/Windows/WinSxS/x.dll", bytes: 1, reason: "" },
        { id: "a2", kind: "quarantine", nodeId: "2", from: "D:/outro/disco.txt", bytes: 1, reason: "" },
        { id: "a3", kind: "move", nodeId: "3", from: "C:/Users/marcelo/Downloads/a.pdf", to: "C:/Users/marcelo/../../Windows/a.pdf", bytes: 1, reason: "" },
        { id: "a4", kind: "move", nodeId: "4", from: "C:/Users", to: "C:/Users/marcelo/x", bytes: 1, reason: "" },
        { id: "a5", kind: "quarantine", nodeId: "5", from: "C:", bytes: 1, reason: "" },
      ],
    };
    const log = await executor.execute(bad, approve(bad));
    expect(log.results.map((r) => r.status)).toEqual(["failed", "failed", "failed", "failed", "failed"]);
  });

  it("aprovação parcial executa só o que foi marcado", async () => {
    const { ctx, executor } = setup();
    const plan = buildPlan("dedupe", {}, ctx);
    const only = plan.actions.slice(0, 3).map((a) => a.id);
    const log = await executor.execute(plan, { ...approve(plan), onlyActionIds: only });
    expect(log.results.filter((r) => r.status === "done")).toHaveLength(3);
    expect(log.results.filter((r) => r.status === "skipped").length).toBe(plan.actions.length - 3);
  });

  it("a quarentena precisa ficar dentro da raiz", () => {
    const driver = new MemoryFsDriver([], ["C:"]);
    expect(() => new Executor({ driver, quarantineRoot: "D:/q" })).toThrow();
  });
});

describe("LocalFsDriver (disco temporário real)", () => {
  it("move para a quarentena, desfaz e não segue link para fora", async () => {
    const base = await mkdtemp(join(tmpdir(), "astrolabe-"));
    const root = join(base, "root");
    const outside = join(base, "fora");
    await mkdir(join(root, "docs"), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(root, "docs", "a.txt"), "conteudo");
    await writeFile(join(outside, "segredo.txt"), "nao mexa");
    await symlink(outside, join(root, "atalho"));

    const driver = new LocalFsDriver({ roots: [root], trashFn: async () => {} });
    const executor = new Executor({ driver, quarantineRoot: normalizePath(join(root, ".q")) });
    const plan: Plan = {
      id: "p1",
      strategy: "selection",
      title: "t",
      summary: "",
      createdAt: 0,
      warnings: [],
      totalBytes: 8,
      actions: [
        { id: "ok", kind: "quarantine", nodeId: "1", from: normalizePath(join(root, "docs", "a.txt")), bytes: 8, reason: "" },
        { id: "link", kind: "quarantine", nodeId: "2", from: normalizePath(join(root, "atalho", "segredo.txt")), bytes: 8, reason: "" },
      ],
    };
    const log = await executor.execute(plan, approve(plan));
    expect(log.results.find((r) => r.actionId === "ok")!.status).toBe("done");
    expect(log.results.find((r) => r.actionId === "link")!.status).toBe("failed");
    expect(await readdir(join(root, "docs"))).toEqual([]);
    expect(await readFile(join(outside, "segredo.txt"), "utf8")).toBe("nao mexa");

    const undone = await executor.undo(plan, log);
    expect(undone.undone).toEqual(["ok"]);
    expect(await readFile(join(root, "docs", "a.txt"), "utf8")).toBe("conteudo");
  });
});
