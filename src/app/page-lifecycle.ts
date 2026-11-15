/** Resume content resources when Firefox restores the same document from BFCache. */
export function bindPageLifecycle(
  start: () => () => void,
  target: Window = window,
): () => void {
  let dispose: (() => void) | null = null;
  let stopped = false;
  const resume = () => {
    if (!stopped && !dispose) dispose = start();
  };
  const suspend = () => {
    const current = dispose;
    dispose = null;
    current?.();
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) resume();
  };
  target.addEventListener("pagehide", suspend);
  target.addEventListener("pageshow", onPageShow);
  resume();
  return () => {
    stopped = true;
    target.removeEventListener("pagehide", suspend);
    target.removeEventListener("pageshow", onPageShow);
    suspend();
  };
}
