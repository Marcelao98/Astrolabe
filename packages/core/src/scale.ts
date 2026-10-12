import type { ScaleMode } from "./types";

export interface ScaleSpec {
  mode: ScaleMode;
  /** Tamanho (bytes) que mapeia para rMin na escala log (abaixo disso fica em rMin). */
  domainMin: number;
  /** Tamanho (bytes) que mapeia para rMax. */
  domainMax: number;
  rMin: number;
  rMax: number;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * Raio de um nó a partir do tamanho.
 * - log: cada "10x" de peso vira o mesmo degrau de raio (enxerga toda a estrutura).
 * - sqrt: a área do círculo é proporcional ao tamanho (honesta, mas some o pequeno).
 * - linear: raio proporcional ao tamanho (o gargalo "grita").
 */
export function radiusFor(size: number, spec: ScaleSpec): number {
  const { mode, rMin, rMax } = spec;
  if (!(size > 0)) return rMin;
  const dMin = Math.max(1, spec.domainMin);
  const dMax = Math.max(spec.domainMax, dMin * 1.0001);
  if (mode === "log") {
    const t = clamp(Math.log(size / dMin) / Math.log(dMax / dMin), 0, 1);
    return rMin + (rMax - rMin) * t;
  }
  const s = Math.min(size, dMax);
  if (mode === "sqrt") return Math.max(rMin, rMax * Math.sqrt(s / dMax));
  return Math.max(rMin, (rMax * s) / dMax);
}

export interface ReferenceCircle {
  size: number;
  radius: number;
  label: string;
}

/** Círculos de referência para a legenda (1 MB, 100 MB, 10 GB...). */
export function referenceCircles(spec: ScaleSpec, sizes: number[]): ReferenceCircle[] {
  return sizes
    .filter((s) => s <= spec.domainMax * 1.001)
    .map((s) => ({ size: s, radius: radiusFor(s, spec), label: formatBytes(s) }));
}

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

/** Formata bytes como o Windows (base 1024) com vírgula decimal. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < UNITS.length - 1) {
    v /= 1024;
    u++;
  }
  const digits = v >= 100 || u === 0 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(digits).replace(".", ",")} ${UNITS[u]}`;
}

export const KB = 1024;
export const MB = 1024 * KB;
export const GB = 1024 * MB;
export const TB = 1024 * GB;
