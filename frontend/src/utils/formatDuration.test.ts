import { describe, expect, it } from 'vitest';
import { formatDuration } from './formatDuration';

describe('formatDuration', () => {
  it('shows minutes and seconds under an hour', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(200)).toBe('3:20');
    expect(formatDuration(3599)).toBe('59:59');
  });

  it('shows hours for long mixes instead of hundreds of minutes', () => {
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(9939)).toBe('2:45:39');
  });

  it('drops fractions and treats missing or negative lengths as zero', () => {
    expect(formatDuration(192.7)).toBe('3:12');
    expect(formatDuration(Number.NaN)).toBe('0:00');
    expect(formatDuration(-5)).toBe('0:00');
  });
});
