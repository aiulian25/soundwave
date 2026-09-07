import { useEffect, useRef, type ReactNode } from 'react';
import Typography, { type TypographyProps } from '@mui/material/Typography';
import { observeResize } from '../utils/sharedResizeObserver';

// The animation holds still for the first 18% and last 18% of each cycle so the start and
// end of the title are both readable before it moves on. Only the middle stretch travels.
const TRAVEL_FRACTION_OF_CYCLE = 0.64;
const TRAVEL_PIXELS_PER_SECOND = 22.8;
// A barely-overflowing title would otherwise flick back and forth almost instantly.
const MINIMUM_CYCLE_SECONDS = 4;
// Sub-pixel layout rounding routinely reports a pixel of phantom overflow.
const OVERFLOW_TOLERANCE_PIXELS = 1;

/** Seconds for one there-and-back cycle covering `overflowPixels` of hidden text. */
export function computeScrollCycleSeconds(overflowPixels: number): number {
  const travelSeconds = Math.max(0, overflowPixels) / TRAVEL_PIXELS_PER_SECOND;
  return Math.max(MINIMUM_CYCLE_SECONDS, travelSeconds / TRAVEL_FRACTION_OF_CYCLE);
}

/** Whether `overflowPixels` is real overflow rather than sub-pixel layout rounding. */
export function shouldScroll(overflowPixels: number): boolean {
  return overflowPixels > OVERFLOW_TOLERANCE_PIXELS;
}

interface ScrollingTextProps extends Omit<TypographyProps, 'children' | 'noWrap'> {
  children: ReactNode;
}

/**
 * Drop-in replacement for `<Typography noWrap>` for text the user needs to read in full.
 *
 * Text that fits renders exactly as before. Text that does not scrolls itself into view and
 * back, so a truncated song title can still be identified before tapping it. The overflow is
 * measured rather than assumed, so titles that fit carry no animation at all — which matters
 * because track lists are not virtualized.
 */
export default function ScrollingText({ children, sx, ...typographyProps }: ScrollingTextProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) {
      return;
    }

    // Written straight to the DOM instead of through state: re-rendering every visible row
    // on every resize is what makes marquee lists janky.
    const applyOverflowState = () => {
      const overflowPixels = content.scrollWidth - container.clientWidth;
      if (!shouldScroll(overflowPixels)) {
        delete content.dataset.scrolling;
        return;
      }
      content.style.setProperty('--scroll-distance', `${-overflowPixels}px`);
      content.style.setProperty('--scroll-duration', `${computeScrollCycleSeconds(overflowPixels).toFixed(1)}s`);
      content.dataset.scrolling = 'true';
    };

    applyOverflowState();
    const stopWatchingContainer = observeResize(container, applyOverflowState);
    const stopWatchingContent = observeResize(content, applyOverflowState);
    return () => {
      stopWatchingContainer();
      stopWatchingContent();
    };
  }, [children]);

  return (
    <Typography
      {...typographyProps}
      component="span"
      ref={containerRef}
      sx={{ display: 'block', overflow: 'hidden', whiteSpace: 'nowrap', ...sx }}
    >
      <span ref={contentRef} className="scrolling-text-content" style={{ display: 'inline-block' }}>
        {children}
      </span>
    </Typography>
  );
}
