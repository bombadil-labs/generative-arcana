import type { PresentationPause } from "./pause";
/** Silent pages use reading time, never pretend to have speech alignment. */
export function silentPageMs(text: string): number {
  return Math.max(4000, Math.max(text.trim().split(/\s+/u).length * 400, Array.from(text).length * 45) + 800);
}

/** Keep every code point, preferring a word boundary when the window fills. */
export function silentPage(text: string, start: number, fits: (text: string) => boolean) {
  const chars = Array.from(text); let low = 0, high = chars.length - start;
  while (low < high) {
    const count = Math.ceil((low + high) / 2);
    if (fits(chars.slice(start, start + count).join(""))) low = count; else high = count - 1;
  }
  if (!low) throw new Error("The caption area is too small for silent reading.");
  let page = chars.slice(start, start + low).join("");
  if (start + low < chars.length && !/\s$/u.test(page)) {
    const boundary = [...page.matchAll(/\s+/gu)].pop();
    if (boundary && boundary.index! > 0) { page = page.slice(0, boundary.index! + boundary[0].length); low = Array.from(page).length; }
  }
  return { text: page, end: start + low, done: start + low === chars.length };
}

export interface SilentLayout {
  /** A browser resize can briefly collapse the viewport. Wait for observation
   * rather than treating that intermediate geometry as a failed reading. */
  available?(): boolean;
  fits(text: string): boolean;
  observe(resize: () => void): () => void;
}

/** A resize restarts the current page at the same offset, so no text is skipped.
 * Completion includes the final page's reading time. Abort fences every callback. */
export function presentSilentPages(text: string, signal: AbortSignal, show: (page: string) => void, layout: SilentLayout, pause?: PresentationPause): Promise<void> {
  return new Promise((resolve, reject) => {
    let stopped = false, start = 0, timer: ReturnType<typeof setTimeout> | undefined;
    let unobserve = () => {}, unsubscribe = () => {}, advance = () => {};
    let remaining = 0, started = 0, needsLayout = true;
    const finish = (error?: unknown) => {
      if (stopped) return;
      stopped = true; clearTimeout(timer); unobserve(); unsubscribe(); signal.removeEventListener("abort", abort);
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(new DOMException("Cancelled", "AbortError"));
    const arm = () => { started = performance.now(); timer = setTimeout(advance, remaining); };
    const render = () => {
      if (stopped) return;
      clearTimeout(timer);
      needsLayout = true;
      if (pause?.paused) return;
      try {
        if (layout.available && !layout.available()) return;
        const page = silentPage(text, start, layout.fits); show(page.text);
        if (stopped) return;
        needsLayout = false; remaining = silentPageMs(page.text);
        advance = function advanceSilentPage() {
          if (stopped) return;
          if (page.done) finish(); else { start = page.end; render(); }
        };
        arm();
      } catch (error) { finish(error); }
    };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    unsubscribe = pause?.subscribe(paused => {
      if (stopped) return;
      if (paused) { remaining = Math.max(0, remaining - (performance.now() - started)); clearTimeout(timer); }
      else if (needsLayout) render(); else arm();
    }) ?? (() => {});
    try { unobserve = layout.observe(render); if (stopped) unobserve(); else render(); } catch (error) { finish(error); }
  });
}

/** Measure with the actual caption font/width rather than guessed line lengths. */
export async function readSilently(text: string, signal: AbortSignal, show: (page: string) => void, window: HTMLElement | null, pause?: PresentationPause) {
  if (!window || signal.aborted) throw new DOMException("Cancelled", "AbortError");
  const document = window.ownerDocument, view = document.defaultView!;
  const probe = document.createElement("div"); probe.dataset.silentMeasure = ""; probe.setAttribute("aria-hidden", "true");
  Object.assign(probe.style, { position: "fixed", left: "0", top: "0", visibility: "hidden", pointerEvents: "none", whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: "0", padding: "0", border: "0" });
  document.body.append(probe);
  try {
    await presentSilentPages(text, signal, show, {
      available() {
        const box = window.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      },
      fits(candidate) {
        const box = window.getBoundingClientRect(), style = view.getComputedStyle(window);
        if (box.width <= 0 || box.height <= 0) return false;
        Object.assign(probe.style, { width: `${box.width}px`, fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, fontStyle: style.fontStyle, fontStretch: style.fontStretch, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, wordSpacing: style.wordSpacing });
        probe.textContent = candidate;
        return probe.getBoundingClientRect().height <= box.height + .1;
      },
      observe(resize) {
        let active = true;
        const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(resize);
        observer?.observe(window); view.addEventListener("resize", resize);
        void document.fonts?.ready.then(() => { if (active) resize(); });
        return () => { active = false; observer?.disconnect(); view.removeEventListener("resize", resize); };
      },
    }, pause);
  } finally { probe.remove(); }
}
