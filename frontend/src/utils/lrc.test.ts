import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSyncedLyrics } from './lrc';

const timeOf = (lrc: string) => parseSyncedLyrics(lrc)[0].time;

describe('parseSyncedLyrics', () => {
  describe('timestamp forms', () => {
    it('parses the canonical [mm:ss.xx]', () => {
      expect(timeOf('[01:02.50]alpha')).toBeCloseTo(62.5);
    });

    it('parses [mm:ss] with no fractional part (previously dropped)', () => {
      expect(timeOf('[01:02]alpha')).toBeCloseTo(62);
    });

    it('parses a single-digit minute [m:ss.x] (previously dropped)', () => {
      expect(timeOf('[1:02.5]alpha')).toBeCloseTo(62.5);
    });

    it('treats a 3-digit fraction as milliseconds', () => {
      expect(timeOf('[01:02.500]alpha')).toBeCloseTo(62.5);
    });

    it('parses minutes beyond 99 for long mixes', () => {
      expect(timeOf('[100:00.00]alpha')).toBeCloseTo(6000);
    });
  });

  describe('filtering', () => {
    it('ignores metadata tags and untimed lines', () => {
      expect(parseSyncedLyrics('[ar:Some Artist]\nplain text\n[00:01.00]alpha')).toHaveLength(1);
    });

    it('ignores timestamps with no text', () => {
      expect(parseSyncedLyrics('[00:01.00]   \n[00:02.00]alpha')).toHaveLength(1);
    });

    it('returns an empty list for input with no timestamps', () => {
      expect(parseSyncedLyrics('nothing here\nor here')).toEqual([]);
    });
  });

  describe('ordering', () => {
    it('sorts out-of-order lines by time', () => {
      const parsed = parseSyncedLyrics('[00:09.00]second\n[00:03.00]first');
      expect(parsed.map((line) => line.text)).toEqual(['first', 'second']);
    });


    it('trims surrounding whitespace from the text', () => {
      expect(parseSyncedLyrics('[00:01.00]   alpha   ')[0].text).toBe('alpha');
    });
  });
});

describe('the shared LRC contract', () => {
  const cases: Array<{ name: string; lrc: string; events: Array<[number, string]> }> = JSON.parse(
    readFileSync(resolve(__dirname, '../../../backend/audio/tests/fixtures/lrc_contract.json'), 'utf8'),
  );

  it.each(cases.map((contractCase) => [contractCase.name, contractCase] as const))('%s', (_name, contractCase) => {
    const parsed = parseSyncedLyrics(contractCase.lrc).map((line) => [Math.round(line.time * 1000), line.text]);

    expect(parsed).toEqual(contractCase.events);
  });
});
