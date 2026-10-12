import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
  Sprites,
  browserCanvasFactory,
  drawGalaxy,
  fitCamera,
  lerpCamera,
  toWorldX,
  toWorldY,
  zoomAt,
  type Camera,
  type GalaxyScene,
} from "@astrolabe/render";

export interface GalaxyHandle {
  flyTo(index: number, opts?: { select?: boolean }): void;
  flyToCamera(cam: Camera): void;
  flyHome(): void;
  fitAll(): void;
  redraw(): void;
  size(): { w: number; h: number };
}

export interface HoverInfo {
  index: number;
  x: number;
  y: number;
}

interface Props {
  scene: GalaxyScene;
  links: boolean;
  homeCamera: (w: number, h: number) => Camera;
  onHover(h: HoverInfo | null): void;
  onSelect(): void;
  onLayout(): void;
  onZoom(zoom: number): void;
}

export const GalaxyCanvas = forwardRef<GalaxyHandle, Props>(function GalaxyCanvas(props, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const sizeRef = useRef({ w: 800, h: 600, dpr: 1 });
  const camRef = useRef<Camera>({ cx: 0, cy: 0, zoom: 0.05 });
  const animRef = useRef<{ from: Camera; to: Camera; start: number; dur: number } | null>(null);
  const dirtyRef = useRef(true);
  const spritesRef = useRef<Sprites | null>(null);
  const startedRef = useRef(false);

  const flyToCamera = (to: Camera, dur = 950) => {
    animRef.current = { from: { ...camRef.current }, to, start: performance.now(), dur };
    dirtyRef.current = true;
  };

  useImperativeHandle(ref, () => ({
    flyTo(index, opts) {
      const { scene } = propsRef.current;
      scene.reveal(index);
      if (opts?.select) {
        scene.selection = new Set([index]);
        propsRef.current.onSelect();
      }
      const nd = scene.tree.nodes[index]!;
      const { w, h } = sizeRef.current;
      const rad = nd.kind === "folder" ? scene.focusRadius(index) : Math.max(36, scene.layout.r[index]! * 10);
      flyToCamera({
        cx: scene.layout.x[index]!,
        cy: scene.layout.y[index]!,
        zoom: Math.min(40, Math.min(w, h) / 2 / rad),
      });
      propsRef.current.onLayout();
    },
    flyToCamera: (cam) => flyToCamera(cam),
    flyHome() {
      const { w, h } = sizeRef.current;
      flyToCamera(propsRef.current.homeCamera(w, h));
    },
    fitAll() {
      const { w, h } = sizeRef.current;
      flyToCamera(fitCamera(propsRef.current.scene.layout.extent, w, h));
    },
    redraw() {
      dirtyRef.current = true;
    },
    size: () => ({ w: sizeRef.current.w, h: sizeRef.current.h }),
  }));

  // tamanho + câmera inicial
  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const apply = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      sizeRef.current = { w: Math.max(1, rect.width), h: Math.max(1, rect.height), dpr };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      if (!startedRef.current) {
        startedRef.current = true;
        camRef.current = propsRef.current.homeCamera(rect.width, rect.height);
        propsRef.current.onZoom(camRef.current.zoom);
      }
      dirtyRef.current = true;
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // laço de desenho
  useEffect(() => {
    spritesRef.current = new Sprites(browserCanvasFactory());
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d", { alpha: false })!;
    const t0 = performance.now();
    let raf = 0;
    let last = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      const anim = animRef.current;
      if (anim) {
        const k = Math.min(1, (t - anim.start) / anim.dur);
        camRef.current = lerpCamera(anim.from, anim.to, k);
        dirtyRef.current = true;
        if (k >= 1) animRef.current = null;
      }
      if (document.hidden) return;
      const idle = t - last > 90; // estrelas e tracejados ainda se mexem em repouso
      if (!dirtyRef.current && !idle) return;
      dirtyRef.current = false;
      last = t;
      const { w, h, dpr } = sizeRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const p = propsRef.current;
      drawGalaxy(ctx, w, h, p.scene, camRef.current, spritesRef.current!, {
        time: (t - t0) / 1000,
        labels: true,
        links: p.links,
        backdrop: true,
        dpr,
      });
      p.onZoom(camRef.current.zoom);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // interação
  useEffect(() => {
    const canvas = canvasRef.current!;
    let dragging = false;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;
    let downX = 0;
    let downY = 0;
    let pinch: { d: number } | null = null;
    const pointers = new Map<number, { x: number; y: number }>();

    const local = (e: { clientX: number; clientY: number }) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const pickAt = (sx: number, sy: number) => {
      const { w, h } = sizeRef.current;
      const cam = camRef.current;
      const scene = propsRef.current.scene;
      return scene.pick(toWorldX(cam, w, sx), toWorldY(cam, h, sy), 11 / cam.zoom);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      animRef.current = null;
      const { x, y } = local(e);
      const { w, h } = sizeRef.current;
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016));
      camRef.current = zoomAt(camRef.current, w, h, x, y, factor);
      dirtyRef.current = true;
    };

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y) };
      }
      dragging = true;
      moved = 0;
      lastX = downX = p.x;
      lastY = downY = p.y;
      animRef.current = null;
    };

    const onMove = (e: PointerEvent) => {
      const p = local(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
      const { w, h } = sizeRef.current;
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        camRef.current = zoomAt(camRef.current, w, h, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2, d / pinch.d);
        pinch.d = d;
        dirtyRef.current = true;
        return;
      }
      if (dragging) {
        const dx = p.x - lastX;
        const dy = p.y - lastY;
        moved += Math.abs(dx) + Math.abs(dy);
        lastX = p.x;
        lastY = p.y;
        const cam = camRef.current;
        camRef.current = { ...cam, cx: cam.cx - dx / cam.zoom, cy: cam.cy - dy / cam.zoom };
        dirtyRef.current = true;
        canvas.style.cursor = "grabbing";
        if (moved > 4) propsRef.current.onHover(null);
        return;
      }
      const scene = propsRef.current.scene;
      const i = pickAt(p.x, p.y);
      if (i !== scene.hover) {
        scene.hover = i;
        dirtyRef.current = true;
      }
      canvas.style.cursor = i >= 0 ? "pointer" : "grab";
      propsRef.current.onHover(i >= 0 ? { index: i, x: p.x, y: p.y } : null);
    };

    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!dragging) return;
      dragging = false;
      canvas.style.cursor = "grab";
      if (moved <= 5 && pointers.size === 0) {
        const scene = propsRef.current.scene;
        const i = pickAt(downX, downY);
        if (i >= 0) {
          if (e.shiftKey || e.ctrlKey || e.metaKey) {
            if (scene.selection.has(i)) scene.selection.delete(i);
            else scene.selection.add(i);
          } else if (scene.selection.size === 1 && scene.selection.has(i)) scene.selection.clear();
          else scene.selection = new Set([i]);
        } else if (!(e.shiftKey || e.ctrlKey || e.metaKey)) scene.selection.clear();
        dirtyRef.current = true;
        propsRef.current.onSelect();
      }
    };

    const onLeave = () => {
      const scene = propsRef.current.scene;
      if (scene.hover !== -1) {
        scene.hover = -1;
        dirtyRef.current = true;
      }
      propsRef.current.onHover(null);
    };

    const onDbl = (e: MouseEvent) => {
      const p = local(e);
      const i = pickAt(p.x, p.y);
      if (i < 0) return;
      const scene = propsRef.current.scene;
      if (scene.tree.nodes[i]!.kind === "folder") {
        scene.toggle(i);
        dirtyRef.current = true;
        propsRef.current.onLayout();
      }
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("dblclick", onDbl);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("dblclick", onDbl);
    };
  }, []);

  return (
    <div ref={wrapRef} className="galaxy">
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", cursor: "grab", touchAction: "none" }} />
    </div>
  );
});
