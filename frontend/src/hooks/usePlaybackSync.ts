/**
 * Cross-device playback session lookup.
 *
 * Reads the session the server holds for this user so playback can resume on another
 * device. The periodic *writing* side lives inline in App.tsx; the hook that used to
 * duplicate it here was never wired up and carried a currentTime-in-deps bug that stopped
 * its timers from ever firing, so it was removed rather than left as a trap.
 */

import { playbackSyncAPI } from '../api/client';

export interface PlaybackSession {
  youtube_id: string;
  position: number;
  duration: number;
  is_playing: boolean;
  volume: number;
  queue_youtube_ids: string[];
  queue_index: number;
  device_id: string;
  device_name: string;
  updated_at: string;
  seconds_since_update: number;
  audio_details: {
    id: number;
    youtube_id: string;
    title: string;
    channel_name: string;
    artist: string;
    album: string;
    duration: number;
    thumbnail_url: string;
    cover_art_url: string;
  } | null;
}

// Helper to check for active session on login
export async function checkPlaybackSession(): Promise<PlaybackSession | null> {
  try {
    const response = await playbackSyncAPI.getSession();
    if (response.data?.has_session && response.data?.session) {
      return response.data.session;
    }
  } catch (error) {
    // 404 means no session, which is fine
    if ((error as any)?.response?.status !== 404) {
      console.debug('[PlaybackSync] Check session failed:', error);
    }
  }
  return null;
}
