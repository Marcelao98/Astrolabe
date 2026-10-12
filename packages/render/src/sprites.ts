/** Fábrica de canvas: no navegador usa <canvas>; em Node usa @napi-rs/canvas. */
export type CanvasFactory = (w: number, h: number) => { canvas: CanvasImageSource; ctx: CanvasRenderingContext2D };

export function browserCanvasFactory(): CanvasFactory {
  return (w, h) => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    return { canvas, ctx: canvas.getContext("2d")! };
  };
}

/** Quantiza para 4 bits por canal (4096 cores): chave de cache e de lote. */
export function quantize(color: number): number {
  return (((color >> 20) & 15) << 8) | (((color >> 12) & 15) << 4) | ((color >> 4) & 15);
}

export function dequantize(q: number): number {
  return (((q >> 8) & 15) * 17) << 16 | (((q >> 4) & 15) * 17) << 8 | ((q & 15) * 17);
}

const rgbCache = new Map<number, string>();
export function rgb(color: number): string {
  let s = rgbCache.get(color);
  if (!s) {
    s = `${(color >> 16) & 255},${(color >> 8) & 255},${color & 255}`;
    rgbCache.set(color, s);
  }
  return s;
}

const mix = (c: number, to: number, t: number) => {
  const r = Math.round(((c >> 16) & 255) * (1 - t) + ((to >> 16) & 255) * t);
  const g = Math.round(((c >> 8) & 255) * (1 - t) + ((to >> 8) & 255) * t);
  const b = Math.round((c & 255) * (1 - t) + (to & 255) * t);
  return `${r},${g},${b}`;
};

const SIZE = 128;

/** Sprites com cor, geradas uma vez e reaproveitadas (halo, núcleo de sol, esfera de planeta). */
export class Sprites {
  private glowCache = new Map<number, CanvasImageSource>();
  private sunCache = new Map<number, CanvasImageSource>();
  private sphereCache = new Map<number, CanvasImageSource>();

  constructor(private make: CanvasFactory) {}

  /** Cria um canvas auxiliar (usado pelo buffer de pontos). */
  create(w: number, h: number) {
    return this.make(w, h);
  }

  /** Halo suave: cor no centro, transparente na borda. */
  glow(color: number): CanvasImageSource {
    const q = quantize(color);
    let s = this.glowCache.get(q);
    if (!s) {
      const { canvas, ctx } = this.make(SIZE, SIZE);
      const c = dequantize(q);
      const g = ctx.createRadialGradient(SIZE / 2, SIZE / 2, 0, SIZE / 2, SIZE / 2, SIZE / 2);
      g.addColorStop(0, `rgba(${rgb(c)},0.95)`);
      g.addColorStop(0.18, `rgba(${rgb(c)},0.55)`);
      g.addColorStop(0.5, `rgba(${rgb(c)},0.16)`);
      g.addColorStop(1, `rgba(${rgb(c)},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, SIZE, SIZE);
      this.glowCache.set(q, (s = canvas));
    }
    return s;
  }

  /** Núcleo de sol: centro quase branco, borda na cor. */
  sun(color: number): CanvasImageSource {
    const q = quantize(color);
    let s = this.sunCache.get(q);
    if (!s) {
      const { canvas, ctx } = this.make(SIZE, SIZE);
      const c = dequantize(q);
      const g = ctx.createRadialGradient(SIZE / 2, SIZE / 2, 0, SIZE / 2, SIZE / 2, SIZE / 2);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.35, `rgba(${mix(c, 0xffffff, 0.55)},1)`);
      g.addColorStop(0.8, `rgba(${rgb(c)},1)`);
      g.addColorStop(1, `rgba(${rgb(c)},0.0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
      ctx.fill();
      this.sunCache.set(q, (s = canvas));
    }
    return s;
  }

  /** Planeta: esfera com luz vinda do canto superior esquerdo. */
  sphere(color: number): CanvasImageSource {
    const q = quantize(color);
    let s = this.sphereCache.get(q);
    if (!s) {
      const { canvas, ctx } = this.make(SIZE, SIZE);
      const c = dequantize(q);
      const g = ctx.createRadialGradient(SIZE * 0.36, SIZE * 0.34, SIZE * 0.04, SIZE / 2, SIZE / 2, SIZE / 2);
      g.addColorStop(0, `rgba(${mix(c, 0xffffff, 0.7)},1)`);
      g.addColorStop(0.45, `rgba(${rgb(c)},1)`);
      g.addColorStop(1, `rgba(${mix(c, 0x050816, 0.72)},1)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 1, 0, Math.PI * 2);
      ctx.fill();
      this.sphereCache.set(q, (s = canvas));
    }
    return s;
  }
}
