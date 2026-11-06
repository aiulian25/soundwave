/**
 * Cross-device playback sync: reads the session the server holds for this user so playback
 * can resume elsewhere, and writes this device's state while the user allows it.
 *
 * One session per user and the last write wins; resuming elsewhere takes over.
 */

import { useEffect, useState, type RefObject } from 'react';
import { getCsrfToken, playbackSyncAPI } from '../api/client';
import type { Audio } from '../types';

const DEVICE_ID_KEY = 'soundwave_device_id';
// Delayed so playback startup is not blocked, and so a burst of changes writes once.
const SYNC_DELAY_MS = 3000;
// Often enough for other devices to show what is playing; the server stops calling a session
// live after LIVE_SESSION_SECONDS (45 s) without a report.
const SYNC_INTERVAL_MS = 15000;
// How often another visible device checks what is playing elsewhere.
const REMOTE_POLL_MS = 15000;
const PLAYBACK_SYNC_PATH = '/api/playback-sync/';
// Must stay within MAX_QUEUE_IDS in backend/audio/serializers_playback_sync.py.
const MAX_SYNCED_QUEUE_IDS = 5000;

export interface PlaybackSession {
  youtube_id: string;
  position: number;
  duration: number;
  is_playing: boolean;
  /** Playing right now on its device, as opposed to a position saved earlier. */
  is_live: boolean;
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

export function deviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = `device_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  localStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}

function deviceName(): string {
  const userAgent = navigator.userAgent;
  if (/iPhone/i.test(userAgent)) return 'iPhone';
  if (/iPad/i.test(userAgent)) return 'iPad';
  if (/Android/i.test(userAgent)) return 'Android';
  if (/Mac/i.test(userAgent)) return 'Mac';
  if (/Windows/i.test(userAgent)) return 'Windows';
  if (/Linux/i.test(userAgent)) return 'Linux';
  return 'Web Browser';
}

/** The queue to save: all of it, or a window around the current track when it is too long. */
export function queueToSync(ids: string[], index: number): { ids: string[]; index: number } {
  if (ids.length <= MAX_SYNCED_QUEUE_IDS) return { ids, index };
  const start = Math.max(0, Math.min(index - Math.floor(MAX_SYNCED_QUEUE_IDS / 2), ids.length - MAX_SYNCED_QUEUE_IDS));
  return { ids: ids.slice(start, start + MAX_SYNCED_QUEUE_IDS), index: index - start };
}

interface PlaybackSyncState {
  enabled: boolean;
  audio: Audio | null;
  isPlaying: boolean;
  queue: Audio[];
  queueIndex: number;
  volume: number;
  positionRef: RefObject<number>;
}

/** Everything is cancelled by the cleanup, so opting out, logging out or changing track leaves nothing pending. */
export function usePlaybackSyncWriter({ enabled, audio, isPlaying, queue, queueIndex, volume, positionRef }: PlaybackSyncState): void {
  const youtubeId = audio?.youtube_id;
  const duration = audio?.duration;

  useEffect(() => {
    if (!enabled || !youtubeId) return undefined;

    // Every report carries the queue: the server replaces the whole session each time.
    const report = (playing: boolean) => {
      const queueIds = queue.map((track) => track.youtube_id).filter(Boolean) as string[];
      const saved = queueToSync(queueIds, queueIndex);
      return {
        youtube_id: youtubeId,
        position: positionRef.current ?? 0,
        duration,
        is_playing: playing,
        volume,
        queue_youtube_ids: saved.ids,
        queue_index: saved.index,
        device_id: deviceId(),
        device_name: deviceName(),
      };
    };

    const sync = () => {
      if (!navigator.onLine) return;
      playbackSyncAPI
        .syncPlayback(report(isPlaying))
        .catch((error) => console.debug('[PlaybackSync] Sync failed:', error));
    };

    // Closing the tab says so straight away, rather than leaving other devices to wait out
    // the live window. keepalive lets the request outlive the page.
    const reportStopped = () => {
      if (!isPlaying) return;
      fetch(PLAYBACK_SYNC_PATH, {
        method: 'POST',
        keepalive: true,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() ?? '' },
        body: JSON.stringify(report(false)),
      }).catch(() => undefined);
    };

    const delayed = setTimeout(sync, SYNC_DELAY_MS);
    const periodic = setInterval(() => {
      if (isPlaying) sync();
    }, SYNC_INTERVAL_MS);
    window.addEventListener('pagehide', reportStopped);

    return () => {
      clearTimeout(delayed);
      clearInterval(periodic);
      window.removeEventListener('pagehide', reportStopped);
    };
  }, [enabled, youtubeId, duration, isPlaying, queue, queueIndex, volume, positionRef]);
}

/** What another of this account's devices is playing right now, while this page is visible. */
export function useRemotePlayback(enabled: boolean): PlaybackSession | null {
  const [remote, setRemote] = useState<PlaybackSession | null>(null);

  useEffect(() => {
    if (!enabled) {
      setRemote(null);
      return undefined;
    }

    let cancelled = false;
    const check = async () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      const session = await checkPlaybackSession();
      if (cancelled) return;
      const playingElsewhere = Boolean(session?.is_live && session.device_id !== deviceId());
      setRemote(playingElsewhere ? session : null);
    };

    check();
    const periodic = setInterval(check, REMOTE_POLL_MS);
    document.addEventListener('visibilitychange', check);
    return () => {
      cancelled = true;
      clearInterval(periodic);
      document.removeEventListener('visibilitychange', check);
    };
  }, [enabled]);

  return remote;
}

export interface ResumedQueue {
  tracks: Audio[];
  index: number;
  missing: number;
}

/** The saved queue from the server, or just the current track if it cannot be restored. */
export async function loadResumedQueue(current: Audio): Promise<ResumedQueue> {
  const onlyCurrent = { tracks: [current], index: 0, missing: 0 };
  try {
    const { data } = await playbackSyncAPI.getQueue();
    if (!data.data?.length || data.index === null) return { ...onlyCurrent, missing: data.missing ?? 0 };
    return { tracks: data.data, index: data.index, missing: data.missing };
  } catch (error) {
    console.debug('[PlaybackSync] Could not restore the queue:', error);
    return onlyCurrent;
  }
}
