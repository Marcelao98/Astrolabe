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
