/** One ResizeObserver for the whole app.
 *
 * Track lists are not virtualized, so a long library mounts hundreds of title elements at
 * once. Giving each its own observer means hundreds of observers; a single one dispatching
 * to registered callbacks costs the same as one.
 */
type ResizeCallback = () => void;

const callbacks = new WeakMap<Element, ResizeCallback>();
let observer: ResizeObserver | null = null;

function getObserver(): ResizeObserver | null {
  if (typeof ResizeObserver === 'undefined') {
    return null;
  }
  if (!observer) {
    observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        callbacks.get(entry.target)?.();
      }
    });
  }
  return observer;
}

/** Watch `element` for size changes. Returns an unsubscribe function. */
export function observeResize(element: Element, onResize: ResizeCallback): () => void {
  const sharedObserver = getObserver();
  if (!sharedObserver) {
    return () => {};
  }
  callbacks.set(element, onResize);
  sharedObserver.observe(element);
  return () => {
    sharedObserver.unobserve(element);
    callbacks.delete(element);
  };
}
