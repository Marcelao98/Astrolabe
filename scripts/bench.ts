import { createCanvas } from "@napi-rs/canvas";
import { buildTree, generateSample, SAMPLE_NOW } from "../packages/core/src";
import { GalaxyScene, Sprites, drawGalaxy, fitCamera, type CanvasFactory } from "../packages/render/src";
const make: CanvasFactory = (w, h) => { const c = createCanvas(w, h); return { canvas: c as unknown as CanvasImageSource, ctx: c.getContext("2d") as unknown as CanvasRenderingContext2D }; };
const sprites = new Sprites(make);
const scene = new GalaxyScene(buildTree(generateSample()), SAMPLE_NOW);
scene.openDepth = 99; scene.relayout();
const W = 1600, H = 1000;
const c = createCanvas(W, H);
const ctx = c.getContext("2d") as unknown as CanvasRenderingContext2D;
const cam = fitCamera(scene.layout.extent, W, H);
function bench(label: string, o: { backdrop: boolean; links: boolean; labels: boolean }, cam2 = cam) {
  for (let k = 0; k < 3; k++) drawGalaxy(ctx, W, H, scene, cam2, sprites, { time: k, ...o });
  const t = performance.now(); const N = 15;
  for (let k = 0; k < N; k++) drawGalaxy(ctx, W, H, scene, cam2, sprites, { time: k, ...o });
  console.log(label.padEnd(26), ((performance.now() - t) / N).toFixed(1), "ms/frame");
}
bench("tudo", { backdrop: true, links: false, labels: true });
bench("sem fundo", { backdrop: false, links: false, labels: true });
bench("sem rótulos", { backdrop: true, links: false, labels: false });
bench("com constelações", { backdrop: true, links: true, labels: true });
const near = { ...cam, zoom: cam.zoom * 12 };
bench("zoom 12x", { backdrop: true, links: false, labels: true }, near);
