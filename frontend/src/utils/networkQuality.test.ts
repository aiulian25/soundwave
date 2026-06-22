import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExponentialBackoff } from './networkQuality';

describe('ExponentialBackoff', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('allows the first attempt and starts with no failures', () => {
    const b = new ExponentialBackoff(1000, 60000);
    expect(b.shouldAttempt()).toBe(true);
    expect(b.getFailureCount()).toBe(0);
  });

  it('blocks until the base delay elapses, then allows again', () => {
    vi.setSystemTime(0);
    const b = new ExponentialBackoff(1000, 60000);
    b.recordFailure(); // delay = 1000ms
    expect(b.getFailureCount()).toBe(1);
    expect(b.shouldAttempt()).toBe(false);
    vi.setSystemTime(999);
    expect(b.shouldAttempt()).toBe(false);
    vi.setSystemTime(1000);
    expect(b.shouldAttempt()).toBe(true);
  });

  it('doubles the delay with each consecutive failure', () => {
    vi.setSystemTime(0);
    const b = new ExponentialBackoff(1000, 60000);
    b.recordFailure();
    b.recordFailure(); // 2 failures → delay = 2000ms
    vi.setSystemTime(1999);
    expect(b.shouldAttempt()).toBe(false);
    vi.setSystemTime(2000);
    expect(b.shouldAttempt()).toBe(true);
  });

  it('resets after a success', () => {
    vi.setSystemTime(0);
    const b = new ExponentialBackoff(1000, 60000);
    b.recordFailure();
    b.recordSuccess();
    expect(b.getFailureCount()).toBe(0);
    expect(b.shouldAttempt()).toBe(true);
  });

  it('caps the computed delay at maxDelay', () => {
    const b = new ExponentialBackoff(1000, 5000);
    let delay = 0;
    for (let i = 0; i < 20; i++) delay = b.recordFailure();
    expect(delay).toBeLessThanOrEqual(5000);
  });
});
