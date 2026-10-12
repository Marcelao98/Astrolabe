import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "../src/App";
import { AstraAvatar } from "../src/components/AstraAvatar";
import { createSampleScene, homeIndex, selectionBytes } from "../src/data";

describe("web", () => {
  it("renderiza a interface completa sem erro", () => {
    const html = renderToString(createElement(App));
    expect(html).toContain("Astrolabe");
    expect(html).toContain("Resumo");
    expect(html).toContain("Gargalos");
    expect(html).toContain("Astra");
  });

  it("a Astra tem todos os humores", () => {
    for (const mood of ["neutral", "happy", "search", "alert", "think"] as const) {
      expect(renderToString(createElement(AstraAvatar, { mood }))).toContain("<svg");
    }
  });

  it("escolhe um sistema inicial que não é a raiz inteira", () => {
    const scene = createSampleScene();
    const home = homeIndex(scene);
    expect(scene.tree.nodes[home]!.name).toBe("marcelo");
  });

  it("não conta duas vezes arquivos dentro de pasta selecionada", () => {
    const scene = createSampleScene();
    const folder = scene.visibleFolders.find((i) => scene.tree.children[i]!.length > 3 && scene.tree.parent[i]! >= 0)!;
    const child = scene.tree.children[folder]![0]!;
    scene.selection = new Set([folder, child]);
    expect(selectionBytes(scene)).toBe(scene.tree.total[folder]);
  });
});

import { buildPlan } from "@astrolabe/actions";
import { buildTree as bt, findDuplicates as fd, generateSample as gs, SAMPLE_NOW as NOW } from "@astrolabe/core";
import { applyResults, createDemoExecutor } from "../src/astra/fsdemo";

describe("modo demonstração: aprovar, executar e desfazer", () => {
  it("quarentena tira do mapa e desfazer devolve; organizar cria pastas novas", async () => {
    const nodes = gs({ files: 3000 });
    const exec = createDemoExecutor(nodes);
    const tree = bt(nodes);
    const ctx = { tree, now: NOW, dup: fd(tree) };

    const plan = buildPlan("dedupe", {}, ctx);
    expect(plan.actions.length).toBeGreaterThan(0);
    const log = await exec.execute(plan, { planId: plan.id, approvedAt: 1 });
    const after = applyResults(nodes, plan, log);
    expect(after.length).toBe(nodes.length - log.results.filter((r) => r.status === "done").length);

    const back = await exec.undo(plan, log);
    expect(applyResults(nodes, plan, back).length).toBe(nodes.length);

    const dl = tree.nodes.find((n) => n.name === "Downloads")!;
    const org = buildPlan("organize_by_type", { folder: dl.id }, ctx);
    const log2 = await exec.execute(org, { planId: org.id, approvedAt: 1 });
    const moved = applyResults(nodes, org, log2);
    expect(moved.length).toBeGreaterThanOrEqual(nodes.length);
    expect(() => bt(moved)).not.toThrow();
  });

  it("sem aprovação nada executa", async () => {
    const nodes = gs({ files: 1000 });
    const tree = bt(nodes);
    const plan = buildPlan("clean_junk", {}, { tree, now: NOW, dup: fd(tree) });
    await expect(createDemoExecutor(nodes).execute(plan, null)).rejects.toThrow(/aprovar/);
  });
});
