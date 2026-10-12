export interface Camera {
  /** Centro da tela, em coordenadas do mundo. */
  cx: number;
  cy: number;
  /** Pixels de tela por unidade do mundo. */
  zoom: number;
}

export const MIN_ZOOM = 0.004;
export const MAX_ZOOM = 40;

export function fitCamera(extent: number, w: number, h: number, margin = 0.9): Camera {
  const zoom = (Math.min(w, h) / 2 / Math.max(extent, 1)) * margin;
  return { cx: 0, cy: 0, zoom: clampZoom(zoom) };
}

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

export const toScreenX = (cam: Camera, w: number, wx: number) => (wx - cam.cx) * cam.zoom + w / 2;
export const toScreenY = (cam: Camera, h: number, wy: number) => (wy - cam.cy) * cam.zoom + h / 2;
export const toWorldX = (cam: Camera, w: number, sx: number) => (sx - w / 2) / cam.zoom + cam.cx;
export const toWorldY = (cam: Camera, h: number, sy: number) => (sy - h / 2) / cam.zoom + cam.cy;

/** Zoom ancorado no cursor: o ponto do mundo sob o mouse não se move. */
export function zoomAt(cam: Camera, w: number, h: number, sx: number, sy: number, factor: number): Camera {
  const wx = toWorldX(cam, w, sx);
  const wy = toWorldY(cam, h, sy);
  const zoom = clampZoom(cam.zoom * factor);
  return {
    zoom,
    cx: wx - (sx - w / 2) / zoom,
    cy: wy - (sy - h / 2) / zoom,
  };
}

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Interpolação "de voo": o zoom varia em escala logarítmica para o movimento parecer natural. */
export function lerpCamera(a: Camera, b: Camera, t: number): Camera {
  const e = easeInOutCubic(t);
  const lz = Math.log(a.zoom) + (Math.log(b.zoom) - Math.log(a.zoom)) * e;
  return { cx: a.cx + (b.cx - a.cx) * e, cy: a.cy + (b.cy - a.cy) * e, zoom: Math.exp(lz) };
}
