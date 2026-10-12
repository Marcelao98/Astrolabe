/**
 * Renderiza a galáxia em PNG usando Skia em Node (sem navegador).
 * Uso: pnpm exec tsx scripts/preview.ts [saida]  -> escreve em .shots/
 */
import { createCanvas } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync } from "node:fs";
import { buildTree, builtinLenses, generateSample, SAMPLE_NOW, topFolders } from "../packages/core/src";
import { GalaxyScene, Sprites, drawGalaxy, fitCamera, type CanvasFactory, type Camera } from "../packages/render/src";

const W = 1600;
const H = 1000;
const make: CanvasFactory = (w, h) => {
  const c = createCanvas(w, h);
  return { canvas: c as unknown as CanvasImageSource, ctx: c.getContext("2d") as unknown as CanvasRenderingContext2D };
};
const sprites = new Sprites(make);
const tree = buildTree(generateSample());
const scene = new GalaxyScene(tree, SAMPLE_NOW);
scene.openDepth = Number(process.env.DEPTH ?? 99);
scene.relayout();
mkdirSync(".shots", { recursive: true });

function shot(name: string, cam: Camera, links = false, time = 3.1) {
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d") as unknown as CanvasRenderingContext2D;
  const t0 = performance.now();
  const stats = drawGalaxy(ctx, W, H, scene, cam, sprites, { time, labels: true, links, backdrop: true });
  const ms = Math.round(performance.now() - t0);
  writeFileSync(`.shots/${name}.png`, c.toBuffer("image/png"));
  console.log(name, `${ms}ms`, JSON.stringify(stats), "zoom", cam.zoom.toFixed(4));
}

const fit = fitCamera(scene.layout.extent, W, H);
shot("1-tipo-galaxia", fit);
const home = tree.nodes.findIndex((n) => n.name === "marcelo");
shot("0-home", { cx: scene.layout.x[home]!, cy: scene.layout.y[home]!, zoom: Math.min(W, H) / 2 / scene.focusRadius(home) });

// zoom numa pasta pesada
const top = topFolders(tree, 6);
const pick = top.find((i) => tree.nodes[i]!.name === "Videos") ?? top[0]!;
const f = (i: number): Camera => ({ cx: scene.layout.x[i]!, cy: scene.layout.y[i]!, zoom: Math.min(W, H) / 2 / scene.focusRadius(i) });
console.log("pasta:", tree.nodes[pick]!.path);
shot("2-zoom-pasta", f(pick));

scene.setLens(builtinLenses[1]!);
shot("3-idade", fit);
scene.setLens(builtinLenses[3]!);
shot("4-duplicados", fit, true);
scene.setLens(builtinLenses[0]!);
scene.setScale("sqrt");
shot("5-raiz-quadrada", fit);
scene.setScale("log");
const dl = tree.nodes.findIndex((n) => n.name === "Downloads");
shot("6-downloads", f(dl));
