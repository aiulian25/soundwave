import { beforeEach, describe, expect, it, vi } from 'vitest';
import { audioCache } from './audioCache';

const ORIGIN = 'https://soundwave.test';

describe('pinned audio is read from the cache every time', () => {
  let audioEntries: Set<string>;
  let apiEntries: Set<string>;

  const fakeCache = (entries: Set<string>) => ({
    match: async (key: string) => (entries.has(key) ? {} : undefined),
    keys: async () => [...entries].map((key) => ({ url: `${ORIGIN}${key}` })),
    delete: async (key: string) => entries.delete(key),
  });

  beforeEach(() => {
    audioEntries = new Set(['/api/audio/X/download/']);
    apiEntries = new Set(['/api/audio/X/lyrics/', '/api/audio/Y/lyrics/']);
    vi.stubGlobal('caches', {
      open: async (name: string) => fakeCache(name === 'soundwave-api-v3' ? apiEntries : audioEntries),
    });
  });

  it('notices eviction after a positive answer', async () => {
    expect(await audioCache.isAvailableOffline('X')).toBe(true);

    audioEntries.clear();

    expect(await audioCache.isAvailableOffline('X')).toBe(false);
  });

  it('lists exactly the tracks present', async () => {
    audioEntries.add('/api/audio/Y/download/');
    audioEntries.add('/api/audio/Z/player/');

    expect(await audioCache.pinnedTrackIds()).toEqual(new Set(['X', 'Y']));
  });

  it('forgets one track\'s lyrics response only', async () => {
    await audioCache.forgetLyricsResponse('X');

    expect([...apiEntries]).toEqual(['/api/audio/Y/lyrics/']);
  });
});
