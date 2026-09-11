import { useEffect, useRef } from "react";
import type p5 from "p5";
import type { PointerState } from "@/runtime/types";
import type { SpreadSceneData, SpreadSceneKit, SpreadSketch } from "@/runtime/spreadScene";

export interface SpreadSceneCanvasProps {
  data: SpreadSceneData;
  scene: SpreadSketch;
  mode?: "live" | "poster";
  paused?: boolean;
  onSignal?: (name: string, detail?: unknown) => void;
  className?: string;
  style?: React.CSSProperties;
}

/** Browser executor for one shared spread scene. It owns p5/DOM lifecycle; scene modules remain pure. */
export function SpreadSceneCanvas({
  data,
  scene,
  mode = "live",
  paused = false,
  onSignal,
  className,
  style,
}: SpreadSceneCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<p5 | null>(null);
  const sceneRef = useRef(scene); sceneRef.current = scene;
  const dataRef = useRef(data); dataRef.current = data;
  const modeRef = useRef(mode); modeRef.current = mode;
  const pausedRef = useRef(paused); pausedRef.current = paused;
  const onSignalRef = useRef(onSignal); onSignalRef.current = onSignal;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let instance: p5 | null = null;
    let disposed = false;
    const mql = typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    let onScreen = true;
    let pressedLatch = false;
    let tAccum = 0;

    import("p5").then(({ default: P5 }) => {
      if (disposed) return;

      const sketchFn = (p: p5) => {
        const kit = buildSceneKit(p, dataRef.current, {
          reducedMotion: !!mql?.matches,
          signal: (name, detail) => onSignalRef.current?.(name, detail),
        });

        const sizeToHost = () => {
          const r = host.getBoundingClientRect();
          const w = Math.max(1, Math.round(r.width));
          const h = Math.max(1, Math.round(r.height));
          p.resizeCanvas(w, h, false);
          resizeSceneKit(kit, w, h);
        };

        const isLive = () =>
          modeRef.current === "live" && !pausedRef.current && onScreen &&
          (typeof document === "undefined" || !document.hidden) && !mql?.matches;

        const syncData = () => { kit.scene = dataRef.current; };

        const renderPoster = () => {
          if (kit.w < 2 || kit.h < 2) return;
          syncData();
          tickSceneKit(kit, 0, readPointer(p, kit.w, kit.h, false));
          try {
            (sceneRef.current.poster ?? sceneRef.current.draw)(kit);
          } catch (error) {
            console.error("[SpreadSceneCanvas]", dataRef.current.spreadId, error);
            p.noLoop();
          }
        };

        p.setup = () => {
          const r = host.getBoundingClientRect();
          const canvas = p.createCanvas(Math.max(1, r.width), Math.max(1, r.height));
          canvas.parent(host);
          p.pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
          resizeSceneKit(kit, p.width, p.height);
          syncData();
          sceneRef.current.init?.(kit);
          if (!isLive()) {
            renderPoster();
            p.noLoop();
          }
        };

        p.draw = () => {
          if (!isLive()) { p.noLoop(); renderPoster(); return; }
          if (kit.w < 2 || kit.h < 2) return;
          tAccum += p.deltaTime / 1000;
          const pointer = readPointer(p, kit.w, kit.h, pressedLatch);
          pressedLatch = false;
          syncData();
          tickSceneKit(kit, tAccum, pointer);
          try {
            if (sceneRef.current.onPointer && (pointer.inside || pointer.down)) sceneRef.current.onPointer(kit);
            sceneRef.current.draw(kit);
          } catch (error) {
            console.error("[SpreadSceneCanvas]", dataRef.current.spreadId, error);
            p.noLoop();
          }
        };

        p.mousePressed = () => { pressedLatch = true; };
        (p as unknown as { _resize: () => void })._resize = sizeToHost;
        (p as unknown as { _wake: () => void })._wake = () => {
          if (isLive()) p.loop();
          else { p.noLoop(); renderPoster(); }
        };
      };

      instance = new P5(sketchFn, host);
      instanceRef.current = instance;

      const resizeObs = new ResizeObserver(() => (instance as unknown as { _resize?: () => void })?._resize?.());
      resizeObs.observe(host);
      const io = new IntersectionObserver((entries) => {
        onScreen = entries[0]?.isIntersecting ?? true;
        (instance as unknown as { _wake?: () => void })?._wake?.();
      }, { threshold: 0.05 });
      io.observe(host);

      const onVisibility = () => (instance as unknown as { _wake?: () => void })?._wake?.();
      document.addEventListener("visibilitychange", onVisibility);
      mql?.addEventListener?.("change", onVisibility);
      (instance as unknown as { _dispose?: () => void })._dispose = () => {
        resizeObs.disconnect();
        io.disconnect();
        document.removeEventListener("visibilitychange", onVisibility);
        mql?.removeEventListener?.("change", onVisibility);
      };
    });

    return () => {
      disposed = true;
      const inst = instance as unknown as { _dispose?: () => void; remove: () => void } | null;
      inst?._dispose?.();
      inst?.remove();
      instanceRef.current = null;
    };
  }, [data.seed, scene]);

  useEffect(() => {
    (instanceRef.current as unknown as { _wake?: () => void } | null)?._wake?.();
  }, [mode, paused, data]);

  return <div ref={hostRef} className={className} style={{ width: "100%", height: "100%", ...style }} />;
}

interface SceneKitOptions {
  reducedMotion: boolean;
  signal: (name: string, detail?: unknown) => void;
}

function buildSceneKit(p: p5, scene: SpreadSceneData, opts: SceneKitOptions): SpreadSceneKit {
  const seed = hashString(`${scene.seed}:${scene.spreadId}`);
  const rng = mulberry32(seed);
  p.randomSeed(seed);
  p.noiseSeed(seed);
  const pointer: PointerState = { x: 0.5, y: 0.5, inside: false, down: false, pressed: false };
  const kit: SpreadSceneKit = {
    p,
    scene,
    w: 0,
    h: 0,
    cx: 0,
    cy: 0,
    u: (fraction) => fraction * Math.min(kit.w, kit.h),
    t: 0,
    loop: (period, offset = 0) => ((kit.t / period + offset) % 1 + 1) % 1,
    rng,
    reducedMotion: opts.reducedMotion,
    pointer,
    signal: opts.signal,
  };
  return kit;
}

function resizeSceneKit(kit: SpreadSceneKit, w: number, h: number): void {
  kit.w = w;
  kit.h = h;
  kit.cx = w / 2;
  kit.cy = h / 2;
}

function tickSceneKit(kit: SpreadSceneKit, t: number, pointer: Partial<PointerState>): void {
  kit.t = t;
  Object.assign(kit.pointer, pointer);
}

function readPointer(p: p5, w: number, h: number, pressed: boolean): PointerState {
  const x = p.mouseX / Math.max(1, w);
  const y = p.mouseY / Math.max(1, h);
  const inside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
  return { x, y, inside, down: p.mouseIsPressed && inside, pressed: pressed && inside };
}

function hashString(value: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
