import { describe, it, expect } from 'vitest';
import { computeScrollCycleSeconds, shouldScroll } from './ScrollingText';

describe('shouldScroll', () => {
  it('ignores sub-pixel layout rounding', () => {
    expect(shouldScroll(0)).toBe(false);
    expect(shouldScroll(1)).toBe(false);
  });

  it('scrolls once the text genuinely overflows', () => {
    expect(shouldScroll(2)).toBe(true);
    expect(shouldScroll(240)).toBe(true);
  });

  it('never scrolls when the text is narrower than its box', () => {
    expect(shouldScroll(-80)).toBe(false);
  });
});

describe('computeScrollCycleSeconds', () => {
  it('floors a barely-overflowing title at the minimum cycle', () => {
    // Without the floor a 5px overflow would flick back and forth in a fraction of a second.
    expect(computeScrollCycleSeconds(5)).toBe(4);
  });

  it('scales with distance so travel speed stays constant', () => {
    const short = computeScrollCycleSeconds(200);
    const double = computeScrollCycleSeconds(400);
    expect(double / short).toBeCloseTo(2, 5);
  });

  it('travels at the approved ~23 px/s during the moving portion of the cycle', () => {
    const overflowPixels = 300;
    const travelSeconds = computeScrollCycleSeconds(overflowPixels) * 0.64;
    expect(overflowPixels / travelSeconds).toBeCloseTo(22.8, 1);
  });

  it('is not tripped up by negative input', () => {
    expect(computeScrollCycleSeconds(-100)).toBe(4);
  });
});
