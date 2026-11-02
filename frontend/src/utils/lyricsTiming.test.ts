import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  activeLineIndex,
  formatPosition,
  lrcFromTimedLines,
  retimeLine,
  sameWords,
  shiftLines,
  timedLinesFromLrc,
  timingIssues,
} from './lyricsTiming';

const CONTRACT = JSON.parse(
  readFileSync(resolve(__dirname, '../../../backend/audio/tests/fixtures/lrc_contract.json'), 'utf8'),
) as { name: string; lrc: string; events: [number, string][] }[];

const LINES = [
  { timeMs: 1000, text: 'one' },
  { timeMs: 2000, text: 'two' },
  { timeMs: 3000, text: 'three' },
];

describe('canonical LRC', () => {
  it('writes the form the backend stores', () => {
    expect(lrcFromTimedLines([{ timeMs: 62_505, text: 'alpha' }, { timeMs: 6_000_000, text: 'beta' }]))
      .toBe('[01:02.505]alpha\n[100:00.000]beta');
  });

  it.each(CONTRACT.map((entry) => [entry.name, entry] as const))('%s keeps every time through a round trip', (_name, entry) => {
    const lines = timedLinesFromLrc(entry.lrc);

    expect(lines.map((line) => [line.timeMs, line.text])).toEqual(entry.events);
    expect(timedLinesFromLrc(lrcFromTimedLines(lines))).toEqual(lines);
  });
});

describe('editing', () => {
  it('shifts every line and never below zero', () => {
    expect(shiftLines(LINES, -1500).map((line) => line.timeMs)).toEqual([0, 500, 1500]);
  });

  it('retimes one line and leaves the others and the original alone', () => {
    const edited = retimeLine(LINES, 1, 2500.4);

    expect(edited.map((line) => line.timeMs)).toEqual([1000, 2500, 3000]);
    expect(LINES[1].timeMs).toBe(2000);
  });
});

describe('validation', () => {
  it('accepts ordered lines, including equal times', () => {
    expect(timingIssues([...LINES, { timeMs: 3000, text: 'four' }], 10).size).toBe(0);
  });

  it('names the line that starts before the previous one', () => {
    expect([...timingIssues(retimeLine(LINES, 1, 500), 10)]).toEqual([[1, 'outOfOrder']]);
  });

  it('names a line past the end, allowing for a rounded duration, unless the duration is unknown', () => {
    const lastLineAt = (timeMs: number) => retimeLine(LINES, 2, timeMs);

    expect(timingIssues(lastLineAt(10_999), 10).size).toBe(0);
    expect([...timingIssues(lastLineAt(11_001), 10)]).toEqual([[2, 'pastEnd']]);
    expect(timingIssues(lastLineAt(99_000), 0).size).toBe(0);
  });
});

describe('preview', () => {
  it('finds the last line to have started', () => {
    expect(activeLineIndex(LINES, 999)).toBe(-1);
    expect(activeLineIndex(LINES, 1000)).toBe(0);
    expect(activeLineIndex(LINES, 2500)).toBe(1);
    expect(activeLineIndex(LINES, 99_000)).toBe(2);
  });

  it('shows minutes, seconds and milliseconds', () => {
    expect(formatPosition(62_505)).toBe('1:02.505');
  });
});

describe('sameWords', () => {
  it('ignores timing and order but not words or repeats', () => {
    expect(sameWords(LINES, [...LINES].reverse())).toBe(true);
    expect(sameWords(LINES, LINES.slice(1))).toBe(false);
    expect(sameWords(LINES, [...LINES.slice(1), { timeMs: 1000, text: 'changed' }])).toBe(false);
  });
});
