/**
 * What is really available offline. A saved playlist only records which tracks it wants; what
 * can play is read from the bytes in Cache Storage every time, so eviction and interrupted
 * downloads show up honestly and older saved playlists need no migration.
 */

import { audioCache } from './audioCache';
import { offlineStorage } from './offlineStorage';

export const offlineAudioUrl = (youtubeId: string) => `/api/audio/${youtubeId}/download/`;

const trackIdsOf = (playlist: any): string[] => (playlist.items ?? []).map((item: any) => item.audio.youtube_id);

function withAvailability(playlist: any, pinnedTrackIds: Set<string>) {
  const wanted: any[] = playlist.items ?? [];
  const playable = wanted.filter((item) => pinnedTrackIds.has(item.audio.youtube_id));
  return {
    ...playlist,
    items: playable,
    downloaded_count: playable.length,
    wanted_count: wanted.length,
    missing_count: wanted.length - playable.length,
  };
}

export async function verifiedOfflinePlaylists() {
  const [playlists, pinnedTrackIds] = await Promise.all([
    offlineStorage.getOfflinePlaylists(),
    audioCache.pinnedTrackIds(),
  ]);
  return playlists.map((playlist) => withAvailability(playlist, pinnedTrackIds));
}

export async function verifiedOfflinePlaylist(playlistId: string) {
  const playlist = await offlineStorage.getPlaylistByPlaylistId(playlistId);
  if (!playlist) return null;
  return withAvailability(playlist, await audioCache.pinnedTrackIds());
}

/** Records the playlist only if at least one of its tracks really arrived. */
export async function saveOfflinePlaylist(playlist: any) {
  const verified = withAvailability(playlist, await audioCache.pinnedTrackIds());
  if (verified.items.length > 0) await offlineStorage.savePlaylist(playlist);
  return verified;
}

/** Deletes only the audio no other saved playlist needs. Rejects if the audio could not be removed. */
export async function removeOfflinePlaylist(
  playlist: { id: number; playlist_id: string },
  removeCachedPlaylist: (playlistId: string, audioUrls: string[]) => Promise<boolean>,
): Promise<void> {
  const saved = await offlineStorage.getOfflinePlaylists();
  const own = saved.find((candidate) => candidate.id === playlist.id);
  const neededElsewhere = new Set(
    saved.filter((candidate) => candidate.id !== playlist.id).flatMap(trackIdsOf),
  );
  const exclusiveUrls = (own ? trackIdsOf(own) : [])
    .filter((youtubeId) => !neededElsewhere.has(youtubeId))
    .map(offlineAudioUrl);

  const removed = await removeCachedPlaylist(playlist.playlist_id, exclusiveUrls);
  if (!removed) throw new Error('Could not remove the offline audio');
  await offlineStorage.removePlaylist(playlist.id);
}

/** A lyrics change must also drop the worker's stored GET, or a failing network brings the old text back. */
export async function replaceOfflineLyrics(youtubeId: string, lyricsData: any): Promise<void> {
  await offlineStorage.saveLyrics(youtubeId, lyricsData);
  await audioCache.forgetLyricsResponse(youtubeId);
}

export async function removeOfflineLyrics(youtubeId: string): Promise<void> {
  await offlineStorage.removeLyrics(youtubeId);
  await audioCache.forgetLyricsResponse(youtubeId);
}
