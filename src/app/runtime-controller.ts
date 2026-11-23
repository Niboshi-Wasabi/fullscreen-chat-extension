/** Serialize restarts and dispose stale asynchronous starts, including after stop. */
export function createRuntimeController(
  start: (signal: AbortSignal) => Promise<() => void>,
) {
  let generation = 0;
  let stopped = false;
  let dispose: (() => void) | null = null;
  let queue = Promise.resolve();
  let activation: AbortController | null = null;
  return {
    restart(): Promise<void> {
      if (stopped) return queue;
      const requested = ++generation;
      activation?.abort();
      queue = queue
        .then(async () => {
          if (stopped || requested !== generation) return;
          const prev = dispose;
          dispose = null;
          prev?.();
          const current = new AbortController();
          activation = current;
          const next = await start(current.signal);
          if (stopped || requested !== generation) next();
          else dispose = next;
        })
        .catch((error) => console.warn("[fce] runtime start failed", error));
      return queue;
    },
    stop() {
      stopped = true;
      generation++;
      activation?.abort();
      const prev = dispose;
      dispose = null;
      prev?.();
    },
  };
}
