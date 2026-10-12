import { DUP_PALETTE, formatBytes } from "@astrolabe/core";
import { toScreenX, toScreenY, type Camera } from "./camera";
import type { GalaxyScene } from "./scene";
import { dequantize, rgb, type Sprites } from "./sprites";

export interface DrawOptions {
  /** Segundos desde o início (anima brilho, tracejados e estrelas). */
  time: number;
  labels: boolean;
  /** Linhas de "constelação" entre duplicados. */
  links: boolean;
  /** Estrelas e nebulosas de fundo. */
  backdrop: boolean;
  /** Pixels de dispositivo por pixel lógico (padrão 1). */
  dpr?: number;
}

export interface DrawStats {
  files: number;
  folders: number;
  planets: number;
  labels: number;
}

const TAU = Math.PI * 2;
const LEVEL_ALPHA = [0.38, 0.58, 0.8, 1];

// ---------- fundo: nebulosas e estrelas ----------
interface Star {
  x: number;
  y: number;
  size: number;
  phase: number;
  speed: number;
  tint: number;
  par: number;
}

function makeStars(): Star[] {
  let a = 1234567;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const tints = [0xffffff, 0xcfe0ff, 0xffe3f1, 0xd9fff6];
  const stars: Star[] = [];
  const layers = [
    { n: 520, par: 0.015, size: 0.7 },
    { n: 260, par: 0.04, size: 1.05 },
    { n: 90, par: 0.09, size: 1.6 },
  ];
  for (const L of layers) {
    for (let k = 0; k < L.n; k++) {
      stars.push({
        x: rnd(),
        y: rnd(),
        size: L.size * (0.6 + rnd() * 0.9),
        phase: rnd() * TAU,
        speed: 0.5 + rnd() * 1.8,
        tint: tints[Math.floor(rnd() * tints.length)]!,
        par: L.par,
      });
    }
  }
  return stars;
}

const STARS = makeStars();

const NEBULAE = [
  { x: 0.18, y: 0.25, r: 0.55, color: 0x5b3cc4, a: 0.2, par: 0.01 },
  { x: 0.82, y: 0.2, r: 0.5, color: 0x0e7490, a: 0.17, par: 0.014 },
  { x: 0.7, y: 0.82, r: 0.6, color: 0xbe185d, a: 0.13, par: 0.012 },
  { x: 0.1, y: 0.85, r: 0.45, color: 0x1d4ed8, a: 0.16, par: 0.016 },
  { x: 0.5, y: 0.5, r: 0.75, color: 0x312e81, a: 0.14, par: 0.008 },
];

const wrap = (v: number, m: number) => ((v % m) + m) % m;

function drawBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number, cam: Camera, sprites: Sprites, time: number) {
  const bg = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.78);
  bg.addColorStop(0, "#0a0f2c");
  bg.addColorStop(0.55, "#050716");
  bg.addColorStop(1, "#02030a");
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.globalCompositeOperation = "lighter";
  const span = Math.max(w, h) * 2;
  for (const n of NEBULAE) {
    const px = wrap(n.x * span - cam.cx * cam.zoom * n.par, span) - (span - w) / 2;
    const py = wrap(n.y * span - cam.cy * cam.zoom * n.par, span) - (span - h) / 2;
    const size = n.r * Math.max(w, h) * 2;
    ctx.globalAlpha = n.a;
    ctx.drawImage(sprites.glow(n.color), px - size / 2, py - size / 2, size, size);
  }

  for (const s of STARS) {
    const sx = wrap(s.x * w - cam.cx * cam.zoom * s.par, w);
    const sy = wrap(s.y * h - cam.cy * cam.zoom * s.par, h);
    const tw = 0.62 + 0.38 * Math.sin(time * s.speed + s.phase);
    ctx.globalAlpha = tw * (s.size > 1.4 ? 0.95 : 0.7);
    ctx.fillStyle = `rgb(${rgb(s.tint)})`;
    const r = s.size;
    if (r > 1.45) {
      ctx.drawImage(sprites.glow(s.tint), sx - r * 3.2, sy - r * 3.2, r * 6.4, r * 6.4);
    }
    ctx.fillRect(sx - r / 2, sy - r / 2, r, r);
  }
  ctx.globalAlpha = 1;
}

// ---------- lotes de pontos ----------
const scratch = new Map<number, number[]>();

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/** Buffer de pixels para os pontos sub-pixel: escrever direto é muito mais barato que 40 mil caminhos. */
interface Splat {
  w: number;
  h: number;
  ctx: CanvasRenderingContext2D;
  canvas: CanvasImageSource;
  img: ImageData;
  px: Uint32Array;
}
let splat: Splat | null = null;
function getSplat(sprites: Sprites, w: number, h: number): Splat {
  if (!splat || splat.w !== w || splat.h !== h) {
    const { canvas, ctx } = sprites.create(w, h);
    const img = ctx.createImageData(w, h);
    splat = { w, h, ctx, canvas, img, px: new Uint32Array(img.data.buffer) };
  }
  return splat;
}

interface LabelCand {
  text: string;
  sub?: string;
  x: number;
  y: number;
  prio: number;
  size: number;
}

export function drawGalaxy(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  scene: GalaxyScene,
  cam: Camera,
  sprites: Sprites,
  opts: DrawOptions,
): DrawStats {
  const { layout, tree } = scene;
  const { x, y, r, sys } = layout;
  const z = cam.zoom;
  const stats: DrawStats = { files: 0, folders: 0, planets: 0, labels: 0 };

  if (opts.backdrop) drawBackdrop(ctx, w, h, cam, sprites, opts.time);
  else {
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#04060f";
    ctx.fillRect(0, 0, w, h);
  }

  const SX = (wx: number) => toScreenX(cam, w, wx);
  const SY = (wy: number) => toScreenY(cam, h, wy);
  const inView = (sx: number, sy: number, m: number) => sx > -m && sx < w + m && sy > -m && sy < h + m;

  // ----- poços de gravidade (limites dos sistemas) -----
  ctx.globalCompositeOperation = "lighter";
  let wells = 0;
  for (const i of scene.visibleFolders) {
    if (!layout.open[i]) continue;
    const s = sys[i]! * z;
    if (s < 9) continue;
    const sx = SX(x[i]!);
    const sy = SY(y[i]!);
    if (!inView(sx, sy, s)) continue;
    const reg = scene.region[i]!;
    // sistemas pequenos na tela viram "aglomerados" luminosos; os grandes ficam discretos
    const a = s < 300 ? 0.14 + 0.3 * (1 - s / 300) : Math.min(0.12, 0.04 + s / 9000);
    ctx.globalAlpha = a;
    ctx.drawImage(sprites.glow(reg), sx - s * 1.08, sy - s * 1.08, s * 2.16, s * 2.16);
    if (s > 70) {
      ctx.globalAlpha = s > 400 ? 0.07 : Math.min(0.22, 0.07 + s / 1200);
      ctx.strokeStyle = `rgb(${rgb(reg)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sx, sy, s, 0, TAU);
      ctx.stroke();
    }
    if (++wells > 400) break;
  }

  // ----- constelações de duplicados -----
  if (opts.links && scene.dup.groups.length) {
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 7]);
    ctx.lineDashOffset = -opts.time * 14;
    let drawn = 0;
    for (let g = 0; g < scene.dup.groups.length && drawn < 1400; g++) {
      const members = scene.dup.groups[g]!;
      const hub = members[0]!;
      if (!layout.visible[hub]) continue;
      const hx = SX(x[hub]!);
      const hy = SY(y[hub]!);
      ctx.strokeStyle = `rgb(${rgb(DUP_PALETTE[g % DUP_PALETTE.length]!)})`;
      ctx.globalAlpha = 0.34;
      for (let m = 1; m < members.length && m < 7; m++) {
        const o = members[m]!;
        if (!layout.visible[o]) continue;
        const ox = SX(x[o]!);
        const oy = SY(y[o]!);
        const minX = Math.min(hx, ox), maxX = Math.max(hx, ox), minY = Math.min(hy, oy), maxY = Math.max(hy, oy);
        if (maxX < 0 || minX > w || maxY < 0 || minY > h) continue;
        const mx = (hx + ox) / 2, my = (hy + oy) / 2;
        const dx = ox - hx, dy = oy - hy;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.quadraticCurveTo(mx - dy * 0.16, my + dx * 0.16, ox, oy);
        ctx.stroke();
        drawn++;
      }
    }
    ctx.setLineDash([]);
  }

  // ----- arquivos: pontos em lote + planetas -----
  for (const arr of scratch.values()) arr.length = 0;
  const planets: number[] = [];
  const dpr = opts.dpr ?? 1;
  const useSplat = LITTLE_ENDIAN;
  const sp = useSplat ? getSplat(sprites, Math.ceil(w * dpr), Math.ceil(h * dpr)) : null;
  if (sp) sp.px.fill(0);
  let splatted = 0;
  for (const i of scene.visibleFiles) {
    const sx = SX(x[i]!);
    const sy = SY(y[i]!);
    const rpx = r[i]! * z;
    if (!inView(sx, sy, rpx + 2)) continue;
    if (rpx > 3.4) {
      planets.push(i);
      continue;
    }
    if (sp && rpx * dpr < 1.3) {
      const px = Math.floor(sx * dpr);
      const py = Math.floor(sy * dpr);
      if (px >= 0 && py >= 0 && px < sp.w - 1 && py < sp.h - 1) {
        const v = scene.packed[i]!;
        const o = py * sp.w + px;
        sp.px[o] = v;
        if (rpx * dpr >= 0.95) {
          sp.px[o + 1] = v;
          sp.px[o + sp.w] = v;
          sp.px[o + sp.w + 1] = v;
        }
        splatted++;
      }
      continue;
    }
    const key = scene.bucket[i]!;
    let arr = scratch.get(key);
    if (!arr) scratch.set(key, (arr = []));
    arr.push(i);
  }
  ctx.globalCompositeOperation = "source-over";
  if (sp && splatted) {
    sp.ctx.putImageData(sp.img, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(sp.canvas, 0, 0, w, h);
    stats.files += splatted;
  }
  for (const [key, list] of scratch) {
    if (!list.length) continue;
    const color = dequantize(key >> 2);
    ctx.globalAlpha = 1;
    ctx.fillStyle = `rgba(${rgb(color)},${LEVEL_ALPHA[key & 3]})`;
    ctx.beginPath();
    for (const i of list) {
      const rpx = Math.max(0.85, r[i]! * z);
      const sx = SX(x[i]!);
      const sy = SY(y[i]!);
      if (rpx < 1.3) ctx.rect(sx - rpx, sy - rpx, rpx * 2, rpx * 2);
      else {
        ctx.moveTo(sx + rpx, sy);
        ctx.arc(sx, sy, rpx, 0, TAU);
      }
    }
    ctx.fill();
    stats.files += list.length;
  }

  ctx.globalCompositeOperation = "source-over";
  planets.sort((a, b) => r[a]! - r[b]!);
  for (const i of planets) {
    const sx = SX(x[i]!);
    const sy = SY(y[i]!);
    const rpx = r[i]! * z;
    ctx.globalAlpha = Math.min(1, scene.alpha[i]! + 0.1);
    ctx.drawImage(sprites.sphere(scene.color[i]!), sx - rpx, sy - rpx, rpx * 2, rpx * 2);
    if (rpx > 5 && scene.alpha[i]! > 0.3) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.35;
      ctx.drawImage(sprites.glow(scene.color[i]!), sx - rpx * 2.2, sy - rpx * 2.2, rpx * 4.4, rpx * 4.4);
      ctx.globalCompositeOperation = "source-over";
    }
  }
  stats.planets = planets.length;

  // ----- pastas: sóis com halo e anel -----
  const labelCands: LabelCand[] = [];
  for (const i of scene.visibleFolders) {
    const sx = SX(x[i]!);
    const sy = SY(y[i]!);
    const open = layout.open[i] === 1;
    const rpx = r[i]! * z;
    const sysPx = sys[i]! * z;
    if (!inView(sx, sy, Math.max(rpx * 3, open ? 0 : 0))) {
      // sistema grande pode ter o sol fora da tela mas rótulo relevante: ignorado de propósito
      continue;
    }
    stats.folders++;
    const color = scene.color[i]!;
    const alpha = scene.alpha[i]!;
    const nd = tree.nodes[i]!;

    if (rpx < 1.6) {
      // pastas minúsculas: só um ponto (halos somados saturariam em branco nos aglomerados)
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 0.75 * alpha;
      ctx.fillStyle = `rgb(${rgb(color)})`;
      const s = Math.max(1, rpx * 1.1);
      ctx.fillRect(sx - s, sy - s, s * 2, s * 2);
    } else {
      ctx.globalCompositeOperation = "lighter";
      const gs = rpx * (open ? 2.5 : 3.2);
      ctx.globalAlpha = (open ? 0.55 : 0.9) * alpha;
      ctx.drawImage(sprites.glow(color), sx - gs, sy - gs, gs * 2, gs * 2);

      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprites.sun(color), sx - rpx, sy - rpx, rpx * 2, rpx * 2);

      // anel: forte quando colapsada, discreto quando aberta
      ctx.globalCompositeOperation = "lighter";
      ctx.lineWidth = Math.max(1, rpx * 0.07);
      ctx.strokeStyle = `rgba(${rgb(color)},${open ? 0.3 : 0.85})`;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(sx, sy, rpx * 1.4 + 1.2, 0, TAU);
      ctx.stroke();
      if (!open && rpx > 6) {
        ctx.setLineDash([2, 4]);
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.5 * alpha;
        ctx.beginPath();
        ctx.arc(sx, sy, rpx * 1.9 + 2, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (!open && rpx > 13 && tree.children[i]!.length) {
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = "#0b1030";
        ctx.font = `700 ${Math.min(15, rpx * 0.55)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const c = tree.count[i]!;
        ctx.fillText(c >= 1000 ? `${(c / 1000).toFixed(c >= 10000 ? 0 : 1)}k` : String(c), sx, sy + 0.5);
      }
    }

    // candidatos a rótulo
    if (opts.labels) {
      const big = open ? sysPx : rpx * 2.2;
      if ((open && sysPx >= 42) || (!open && rpx >= 7)) {
        labelCands.push({
          text: nd.name,
          sub: sysPx >= 150 || (!open && rpx >= 12) ? formatBytes(tree.total[i]!) : undefined,
          x: sx,
          y: sy - rpx * 1.5 - 9,
          prio: big,
          size: Math.min(19, 10 + Math.log10(Math.max(1, big / 42)) * 7),
        });
      }
    }
  }

  // ----- foco, seleção e hover -----
  ctx.globalCompositeOperation = "lighter";
  if (scene.focus && scene.focus.size <= 500) {
    const pulse = 0.5 + 0.5 * Math.sin(opts.time * 3.2);
    ctx.strokeStyle = "rgba(255,196,87,0.9)";
    ctx.lineWidth = 1.2;
    for (const i of scene.focus) {
      if (!layout.visible[i]) continue;
      const sx = SX(x[i]!);
      const sy = SY(y[i]!);
      if (!inView(sx, sy, 20)) continue;
      const rr = Math.max(2.5, r[i]! * z) + 3 + pulse * 3;
      ctx.globalAlpha = 0.45 + pulse * 0.4;
      ctx.beginPath();
      ctx.arc(sx, sy, rr, 0, TAU);
      ctx.stroke();
    }
  }
  const ringFor = (i: number, color: string, extra: number, dash: boolean) => {
    if (!layout.visible[i]) return;
    const sx = SX(x[i]!);
    const sy = SY(y[i]!);
    const isFolder = tree.nodes[i]!.kind === "folder";
    const rr = Math.max(3, r[i]! * z * (isFolder ? 1.4 : 1)) + extra;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 0.95;
    if (dash) {
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = -opts.time * 22;
    }
    ctx.beginPath();
    ctx.arc(sx, sy, rr, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  let n = 0;
  for (const i of scene.selection) {
    ringFor(i, "rgba(255,255,255,1)", 5, true);
    if (++n > 1500) break;
  }
  if (scene.hover >= 0) ringFor(scene.hover, "rgba(120,230,255,1)", 3, false);

  // ----- rótulos com anti-colisão -----
  if (labelCands.length) {
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    labelCands.sort((a, b) => b.prio - a.prio);
    const taken: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const c of labelCands) {
      if (stats.labels >= 70) break;
      ctx.font = `600 ${c.size.toFixed(1)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      const wText = Math.max(ctx.measureText(c.text).width, c.sub ? c.size * 3.4 : 0);
      const hText = c.size * (c.sub ? 2.35 : 1.3);
      const box = { x0: c.x - wText / 2 - 3, x1: c.x + wText / 2 + 3, y0: c.y - c.size - (c.sub ? c.size * 1.05 : 0) - 2, y1: c.y + 4 };
      if (box.x1 < 0 || box.x0 > w || box.y1 < 0 || box.y0 > h) continue;
      if (taken.some((t) => box.x0 < t.x1 && box.x1 > t.x0 && box.y0 < t.y1 && box.y1 > t.y0)) continue;
      taken.push(box);
      ctx.lineJoin = "round";
      ctx.lineWidth = 3.4;
      ctx.strokeStyle = "rgba(2,3,12,0.9)";
      ctx.fillStyle = "rgba(232,238,255,0.97)";
      ctx.strokeText(c.text, c.x, c.y);
      ctx.fillText(c.text, c.x, c.y);
      if (c.sub) {
        ctx.font = `500 ${(c.size * 0.82).toFixed(1)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
        ctx.strokeText(c.sub, c.x, c.y - c.size * 1.05);
        ctx.fillStyle = "rgba(255,214,150,0.95)";
        ctx.fillText(c.sub, c.x, c.y - c.size * 1.05);
      }
      void hText;
      stats.labels++;
    }
  }

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  return stats;
}
