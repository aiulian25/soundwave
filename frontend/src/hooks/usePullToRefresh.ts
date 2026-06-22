import { useEffect, useRef, useState } from 'react';

interface Options {
  /** Distance (px) the user must pull before a release triggers a refresh. */
  threshold?: number;
  /** Max visual pull distance (px). */
  maxPull?: number;
  /** Drag resistance (0–1); lower feels heavier. */
  resistance?: number;
  /** Disable the gesture (e.g. while already refreshing). */
  disabled?: boolean;
}

/**
 * Touch pull-to-refresh, scoped to whatever mounts it (we only use it on Home so a
 * stray pull can never fire while the user is on a playback page).
 *
 * Returns a ref to attach to the page root, plus the live `pullDistance` and
 * `refreshing` state for rendering an indicator. The gesture only engages when the
 * page's scroll container is already at the top and the user drags downward.
 */
export function usePullToRefresh(
  onRefresh: () => void | Promise<void>,
  { threshold = 70, maxPull = 110, resistance = 0.5, disabled = false }: Options = {},
) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || disabled) return;

    // The actual scrollable element is the app content area (overflow:auto ancestor).
    const findScrollParent = (el: HTMLElement | null): HTMLElement | Window => {
      let node = el?.parentElement;
      while (node) {
        const oy = window.getComputedStyle(node).overflowY;
        if (oy === 'auto' || oy === 'scroll') return node;
        node = node.parentElement;
      }
      return window;
    };
    const scroller = findScrollParent(root);
    const scrollTopOf = () =>
      scroller === window ? window.scrollY : (scroller as HTMLElement).scrollTop;

    let startY = 0;
    let pulling = false;
    let active = true; // refreshing guard captured per-effect

    const onTouchStart = (e: TouchEvent) => {
      if (refreshing || !active) return;
      // Only begin a pull when we're already at the very top.
      if (scrollTopOf() <= 0 && e.touches.length === 1) {
        startY = e.touches[0].clientY;
        pulling = true;
      } else {
        pulling = false;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!pulling || refreshing) return;
      const delta = e.touches[0].clientY - startY;
      if (delta > 0 && scrollTopOf() <= 0) {
        // We're pulling the page down from the top — take over from native scroll/overscroll.
        e.preventDefault();
        setPullDistance(Math.min(delta * resistance, maxPull));
      } else if (delta <= 0) {
        pulling = false;
        setPullDistance(0);
      }
    };

    const onTouchEnd = async () => {
      if (!pulling) return;
      pulling = false;
      if (pullDistanceRef.current >= threshold && !refreshing) {
        setRefreshing(true);
        setPullDistance(threshold);
        try {
          await onRefresh();
        } finally {
          // onRefresh typically reloads the page; reset defensively if it doesn't.
          setRefreshing(false);
          setPullDistance(0);
        }
      } else {
        setPullDistance(0);
      }
    };

    // touchmove must be non-passive so we can preventDefault the native pull-to-refresh.
    scroller.addEventListener('touchstart', onTouchStart as EventListener, { passive: true });
    scroller.addEventListener('touchmove', onTouchMove as EventListener, { passive: false });
    scroller.addEventListener('touchend', onTouchEnd as EventListener, { passive: true });
    scroller.addEventListener('touchcancel', onTouchEnd as EventListener, { passive: true });

    return () => {
      active = false;
      scroller.removeEventListener('touchstart', onTouchStart as EventListener);
      scroller.removeEventListener('touchmove', onTouchMove as EventListener);
      scroller.removeEventListener('touchend', onTouchEnd as EventListener);
      scroller.removeEventListener('touchcancel', onTouchEnd as EventListener);
    };
    // pullDistance is read via a ref inside handlers to avoid re-subscribing each frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onRefresh, threshold, maxPull, resistance, disabled, refreshing]);

  // Keep a ref of the latest pullDistance for the touchend closure.
  const pullDistanceRef = useRef(pullDistance);
  pullDistanceRef.current = pullDistance;

  return { rootRef, pullDistance, refreshing, threshold };
}
