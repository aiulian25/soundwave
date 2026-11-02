import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  playlists: [] as any[],
  pinned: new Set<string>(),
  lyrics: new Map<string, any>(),
  steps: [] as string[],
  lyricsSaveFails: false,
}));

vi.mock('./offlineStorage', () => ({
  offlineStorage: {
    getOfflinePlaylists: async () => fakes.playlists,
    getPlaylistByPlaylistId: async (playlistId: string) =>
      fakes.playlists.find((playlist) => playlist.playlist_id === playlistId) ?? null,
    savePlaylist: async (playlist: any) => void fakes.playlists.push(playlist),
    removePlaylist: async (id: number) => {
      fakes.playlists = fakes.playlists.filter((playlist) => playlist.id !== id);
    },
    saveLyrics: async (youtubeId: string, data: any) => {
      if (fakes.lyricsSaveFails) throw new Error('Over quota');
      fakes.steps.push('save');
      fakes.lyrics.set(youtubeId, data);
    },
    removeLyrics: async (youtubeId: string) => {
      fakes.steps.push('remove');
      fakes.lyrics.delete(youtubeId);
    },
  },
}));
vi.mock('./audioCache', () => ({
  audioCache: {
    pinnedTrackIds: async () => new Set(fakes.pinned),
    forgetLyricsResponse: async () => void fakes.steps.push('forget'),
  },
}));

import {
  removeOfflineLyrics,
  removeOfflinePlaylist,
  replaceOfflineLyrics,
  saveOfflinePlaylist,
  verifiedOfflinePlaylist,
  verifiedOfflinePlaylists,
} from './offlineLibrary';

const item = (youtubeId: string) => ({ audio: { youtube_id: youtubeId } });
const playlist = (id: number, name: string, trackIds: string[]) => ({
  id,
  playlist_id: name,
  offline: true,
  items: trackIds.map(item),
});
const url = (youtubeId: string) => `/api/audio/${youtubeId}/download/`;

beforeEach(() => {
  fakes.playlists = [];
  fakes.pinned = new Set();
  fakes.lyrics = new Map();
  fakes.steps = [];
  fakes.lyricsSaveFails = false;
});

describe('removing a saved playlist', () => {
  beforeEach(() => {
    fakes.playlists = [playlist(1, 'A', ['X', 'Y']), playlist(2, 'B', ['Y', 'Z'])];
  });

  it('keeps audio another saved playlist needs', async () => {
    const removeCached = vi.fn(async () => true);

    await removeOfflinePlaylist({ id: 1, playlist_id: 'A' }, removeCached);

    expect(removeCached).toHaveBeenCalledWith('A', [url('X')]);
    expect(fakes.playlists.map((saved) => saved.id)).toEqual([2]);
  });

  it('the last playlist to need a track removes it', async () => {
    const removeCached = vi.fn(async () => true);

    await removeOfflinePlaylist({ id: 1, playlist_id: 'A' }, removeCached);
    await removeOfflinePlaylist({ id: 2, playlist_id: 'B' }, removeCached);

    expect(removeCached).toHaveBeenLastCalledWith('B', [url('Y'), url('Z')]);
  });

  it('uses what was saved, not only what is still playable', async () => {
    fakes.pinned = new Set(['Y']);
    const removeCached = vi.fn(async () => true);

    await removeOfflinePlaylist({ id: 1, playlist_id: 'A' }, removeCached);

    expect(removeCached).toHaveBeenCalledWith('A', [url('X')]);
  });

  it('keeps the record when the audio could not be removed', async () => {
    await expect(removeOfflinePlaylist({ id: 1, playlist_id: 'A' }, async () => false)).rejects.toThrow();

    expect(fakes.playlists).toHaveLength(2);
  });
});

describe('offline availability', () => {
  it('follows the bytes, so an evicted track stops counting', async () => {
    fakes.playlists = [playlist(1, 'A', ['X', 'Y'])];
    fakes.pinned = new Set(['X', 'Y']);
    expect((await verifiedOfflinePlaylist('A')).missing_count).toBe(0);

    fakes.pinned.delete('Y');

    const verified = await verifiedOfflinePlaylist('A');
    expect(verified.items.map((entry: any) => entry.audio.youtube_id)).toEqual(['X']);
    expect(verified).toMatchObject({ downloaded_count: 1, wanted_count: 2, missing_count: 1 });
  });

  it('an old saved playlist claiming everything is corrected without a migration', async () => {
    fakes.playlists = [{ ...playlist(1, 'A', ['X', 'Y']), downloaded_count: 2 }];
    fakes.pinned = new Set(['X']);

    const [verified] = await verifiedOfflinePlaylists();

    expect(verified.downloaded_count).toBe(1);
  });

  it('an unknown playlist is absent', async () => {
    expect(await verifiedOfflinePlaylist('nope')).toBeNull();
  });

  it('records a partial save with what is missing still listed', async () => {
    fakes.pinned = new Set(['X']);

    const saved = await saveOfflinePlaylist(playlist(1, 'A', ['X', 'Y']));

    expect(saved).toMatchObject({ downloaded_count: 1, missing_count: 1 });
    expect(fakes.playlists[0].items).toHaveLength(2);
  });

  it('records nothing when no track arrived', async () => {
    const saved = await saveOfflinePlaylist(playlist(1, 'A', ['X']));

    expect(saved.downloaded_count).toBe(0);
    expect(fakes.playlists).toEqual([]);
  });
});

describe('offline lyrics', () => {
  it('replacing stores the new text and drops the old stored response', async () => {
    await replaceOfflineLyrics('X', { plain_lyrics: 'new' });

    expect(fakes.lyrics.get('X')).toEqual({ plain_lyrics: 'new' });
    expect(fakes.steps).toEqual(['save', 'forget']);
  });

  it('removing clears both copies', async () => {
    fakes.lyrics.set('X', { plain_lyrics: 'old' });

    await removeOfflineLyrics('X');

    expect(fakes.lyrics.has('X')).toBe(false);
    expect(fakes.steps).toEqual(['remove', 'forget']);
  });

  it('a failed save reaches the caller', async () => {
    fakes.lyricsSaveFails = true;

    await expect(replaceOfflineLyrics('X', {})).rejects.toThrow('Over quota');
  });
});
