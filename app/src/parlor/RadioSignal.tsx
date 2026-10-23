import { useEffect, useRef } from "react";
import { summonProgress, type RadioState } from "./radio";

const dial = "M 60 90 Q 320 -65 580 90";
const ticks = Array.from({ length: 29 }, (_, i) => {
  const t = i / 28, x = 60 + 520 * t, y = 90 - 310 * t * (1 - t);
  return <line key={i} x1={x} y1={y + 9} x2={x} y2={y + (i % 7 === 0 ? 26 : 17)} />;
});

/** Decorative apparatus; no audio analyser, recording or provider request. */
export function RadioSignal({ signal, startedAt }: { signal: RadioState; startedAt?: number }) {
  const receiver = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = receiver.current;
    if (!node) return;
    node.style.setProperty("--contact", "0");
    if (signal.mode !== "tuning" || startedAt === undefined) return;
    let frame = 0, cancelled = false;
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const update = () => {
      if (cancelled) return;
      if (motion?.matches) { node.style.setProperty("--contact", "0"); return; }
      const progress = summonProgress(startedAt, performance.now());
      node.style.setProperty("--contact", String(progress));
      if (progress < 1) frame = requestAnimationFrame(update);
    };
    const refresh = () => {
      if (frame) cancelAnimationFrame(frame);
      node.style.setProperty("--contact", "0");
      // A static tuning symbol and meaningful label replace the sweep for reduced motion.
      if (!motion?.matches && typeof requestAnimationFrame === "function") update();
    };
    refresh(); motion?.addEventListener("change", refresh);
    return () => { cancelled = true; if (frame) cancelAnimationFrame(frame); motion?.removeEventListener("change", refresh); node.style.setProperty("--contact", "0"); };
  }, [signal.mode, startedAt]);
  if (signal.mode === "quiet") return null;
  return <div ref={receiver} className="parlor-radio" data-mode={signal.mode}>
    <div className="parlor-radio-halo" aria-hidden="true" />
    <svg className="parlor-radio-dial" viewBox="0 0 640 116" aria-hidden="true" focusable="false">
      <path className="radio-rail" d={dial} />
      <g className="radio-ticks">{ticks}</g>
      <path className="radio-contact" d={dial} pathLength="100" />
      <g className="radio-needle"><path d="M 317 12 L 320 56 L 323 12 Z" /></g>
      <path className="radio-carrier" d="M 30 101 H 610" />
      <g className="radio-wave"><path d="M 30 101 H 140 Q 155 101 164 91 Q 180 71 196 101 Q 210 131 224 101 Q 240 51 256 101 Q 272 145 288 101 Q 304 37 320 101 Q 336 145 352 101 Q 368 51 384 101 Q 400 131 416 101 Q 432 71 448 101 H 610" /></g>
      <circle className="radio-lamp" cx="320" cy="76" r="4" />
    </svg>
    <p className="parlor-radio-label" role="status">{signal.label}</p>
  </div>;
}
