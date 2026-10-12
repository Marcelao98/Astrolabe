import { mkdir, mkdtemp, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTree, findDuplicates } from "@astrolabe/core";
import { buildPlan, normalizePath } from "@astrolabe/actions";
import { buildAgent } from "../src/server";
import { scanDirectory } from "../src/scanner";

let dir = "";
let outside = "";
const trashed: string[] = [];
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

beforeAll(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "astro-")));
  outside = await realpath(await mkdtemp(join(tmpdir(), "astro-out-")));
  await mkdir(join(dir, "Docs"), { recursive: true });
  await mkdir(join(dir, "Fotos"), { recursive: true });
  const big = Buffer.alloc(200 * 1024, 7);
  await writeFile(join(dir, "Docs", "a.bin"), big);
  await writeFile(join(dir, "Fotos", "a_copia.bin"), big); // duplicado
  await writeFile(join(dir, "Fotos", "unico.jpg"), Buffer.alloc(100 * 1024, 3));
  await writeFile(join(outside, "segredo.txt"), "x");
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe("escaneamento", () => {
  it("lê a pasta, categoriza e acha duplicados", async () => {
    const r = await scanDirectory(dir);
    expect(r.truncated).toBe(false);
    const tree = buildTree(r.nodes);
    expect(tree.total[tree.roots[0]!]).toBe(500 * 1024);
    expect(findDuplicates(tree).groups).toHaveLength(1);
    expect(r.nodes.find((n) => n.name === "unico.jpg")!.category).toBe("image");
  });

  it("respeita o teto de itens", async () => {
    const r = await scanDirectory(dir, { maxNodes: 3 });
    expect(r.truncated).toBe(true);
    expect(r.nodes.length).toBeLessThanOrEqual(3);
  });
});

describe("agente local", () => {
  it("exige token e só escaneia pastas liberadas", async () => {
    const { app, token } = buildAgent({ roots: [dir] });
    expect((await app.inject({ method: "GET", url: "/agent/info" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/agent/info", headers: auth("errado") })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/agent/info", headers: auth(token) })).statusCode).toBe(200);
    const bad = await app.inject({ method: "POST", url: "/agent/scan", headers: auth(token), payload: { root: outside } });
    expect(bad.statusCode).toBe(403);
    const evil = await app.inject({ method: "GET", url: "/agent/info", headers: { ...auth(token), origin: "https://evil.example" } });
    expect(evil.statusCode).toBe(403);
  });

  it("escaneia, executa um plano aprovado, e desfaz", async () => {
    const { app, token } = buildAgent({ roots: [dir], trashFn: async (p) => void trashed.push(p) });
    const scan = await app.inject({ method: "POST", url: "/agent/scan", headers: auth(token), payload: { root: dir } });
    const { nodes } = scan.json() as { nodes: Parameters<typeof buildTree>[0] };
    const tree = buildTree(nodes);
    const plan = buildPlan("dedupe", {}, { tree, now: Date.now(), dup: findDuplicates(tree) });
    expect(plan.actions).toHaveLength(1);

    // sem aprovação do plano certo: recusa
    const noOk = await app.inject({ method: "POST", url: "/agent/execute", headers: auth(token), payload: { plan, approval: { planId: "outro", approvedAt: 1 } } });
    expect(noOk.statusCode).toBe(409);

    const ex = await app.inject({ method: "POST", url: "/agent/execute", headers: auth(token), payload: { plan, approval: { planId: plan.id, approvedAt: 1 } } });
    const log = ex.json();
    expect(log.results[0].status).toBe("done");
    const gone = plan.actions[0]!.from;
    await expect(stat(join(dir, gone.slice(normalizePath(dir).length)))).rejects.toThrow();

    const un = await app.inject({ method: "POST", url: "/agent/undo", headers: auth(token), payload: { plan, log } });
    expect(un.json().undone).toHaveLength(1);
    await expect(stat(join(dir, gone.slice(normalizePath(dir).length)))).resolves.toBeTruthy();
    expect((await readdir(join(dir, "Fotos"))).length).toBe(2);
  });

  it("recusa plano que mira fora das pastas liberadas", async () => {
    const { app, token } = buildAgent({ roots: [dir] });
    const plan = {
      id: "p1", strategy: "selection", title: "x", summary: "", totalBytes: 1, createdAt: 1, warnings: [],
      actions: [{ id: "a1", kind: "quarantine", nodeId: "n1", from: normalizePath(join(outside, "segredo.txt")), bytes: 1, reason: "" }],
    };
    const r = await app.inject({ method: "POST", url: "/agent/execute", headers: auth(token), payload: { plan, approval: { planId: "p1", approvedAt: 1 } } });
    expect(r.json().results[0].status).toBe("failed");
    await expect(stat(join(outside, "segredo.txt"))).resolves.toBeTruthy();
  });
});
