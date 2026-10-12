import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { SAMPLE_NOW, buildTree, builtinLenses, generateSample } from "@astrolabe/core";
import { GalaxyScene, Sprites, drawGalaxy, fitCamera, zoomAt, toWorldX, toWorldY, type CanvasFactory } from "../src";

const make: CanvasFactory = (w, h) => {
  const c = createCanvas(w, h);
  return { canvas: c as unknown as CanvasImageSource, ctx: c.getContext("2d") as unknown as CanvasRenderingContext2D };
};

const newScene = () => {
  const s = new GalaxyScene(buildTree(generateSample({ files: 4000 })), SAMPLE_NOW);
  s.openDepth = 99;
  s.relayout();
  return s;
};

describe("GalaxyScene", () => {
  it("acha o nó clicado pelo centro e devolve -1 no vazio", () => {
    const s = newScene();
    const file = s.visibleFiles[Math.floor(s.visibleFiles.length / 2)]!;
    expect(s.pick(s.layout.x[file]!, s.layout.y[file]!, 0.5)).toBe(file);
    expect(s.pick(s.layout.extent * 10, s.layout.extent * 10, 1)).toBe(-1);
  });

  it("colapsar esconde os filhos e reveal reabre os pais", () => {
    const s = newScene();
    const folder = s.visibleFolders.find((i) => s.tree.children[i]!.length > 5 && s.tree.parent[i]! >= 0)!;
    const kid = s.tree.children[folder]![0]!;
    expect(s.layout.visible[kid]).toBe(1);
    s.toggle(folder);
    expect(s.layout.visible[kid]).toBe(0);
    expect(s.reveal(kid)).toBe(true);
    expect(s.layout.visible[kid]).toBe(1);
  });

  it("trocar lente e foco repinta sem refazer o layout", () => {
    const s = newScene();
    const v = s.version;
    s.setLens(builtinLenses[2]!);
    s.setFocus([s.visibleFiles[0]!]);
    expect(s.version).toBe(v);
    const other = s.visibleFiles[1]!;
    expect(s.alpha[other]!).toBeLessThan(0.2);
    s.setFocus(null);
    expect(s.alpha[other]!).toBeGreaterThan(0.1);
  });

  it("mudar a escala refaz o layout", () => {
    const s = newScene();
    const v = s.version;
    s.setScale("sqrt");
    expect(s.version).toBe(v + 1);
  });
});

describe("câmera", () => {
  it("o zoom ancorado mantém o ponto sob o cursor", () => {
    const cam = { cx: 100, cy: -50, zoom: 0.5 };
    const next = zoomAt(cam, 800, 600, 200, 150, 2);
    expect(toWorldX(next, 800, 200)).toBeCloseTo(toWorldX(cam, 800, 200), 6);
    expect(toWorldY(next, 600, 150)).toBeCloseTo(toWorldY(cam, 600, 150), 6);
  });
});

describe("drawGalaxy (Skia, sem navegador)", () => {
  it("desenha pixels de verdade em todas as lentes e escalas", () => {
    const s = newScene();
    const sprites = new Sprites(make);
    const W = 800;
    const H = 500;
    for (const mode of ["log", "sqrt", "linear"] as const) {
      s.setScale(mode);
      for (const lens of builtinLenses) {
        s.setLens(lens);
        const c = createCanvas(W, H);
        const ctx = c.getContext("2d") as unknown as CanvasRenderingContext2D;
        const stats = drawGalaxy(ctx, W, H, s, fitCamera(s.layout.extent, W, H), sprites, { time: 1, labels: true, links: lens.id === "duplicates", backdrop: true });
        expect(stats.files).toBeGreaterThan(100);
        const px = c.getContext("2d").getImageData(0, 0, W, H).data;
        let lit = 0;
        for (let k = 0; k < px.length; k += 4) if (px[k]! + px[k + 1]! + px[k + 2]! > 120) lit++;
        expect(lit).toBeGreaterThan(200);
      }
    }
  });
});
