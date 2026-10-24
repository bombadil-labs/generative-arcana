/** A local presentation pause. It neither creates context nor retries a provider. */
export class PresentationPause {
  paused = false;
  private listeners = new Set<(paused: boolean) => void>();
  set(paused: boolean) {
    if (this.paused === paused) return;
    this.paused = paused; this.listeners.forEach(listener => listener(paused));
  }
  subscribe(listener: (paused: boolean) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  wait(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new DOMException("Cancelled", "AbortError"));
    if (!this.paused) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const cleanup = () => { unsubscribe(); signal.removeEventListener("abort", abort); };
      const abort = () => { cleanup(); reject(new DOMException("Cancelled", "AbortError")); };
      const unsubscribe = this.subscribe(paused => { if (!paused) { cleanup(); resolve(); } });
      signal.addEventListener("abort", abort, { once: true });
    });
  }
}
