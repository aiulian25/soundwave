import { useState, useEffect, useRef } from 'react';
import type { Audio } from '../types';
import { audioCache } from '../utils/audioCache';

interface StreamResolution {
  streamUrl: string;
  loadingStream: boolean;
  isCachedPlayback: boolean;
}

const encodeMediaPath = (filePath: string) =>
  filePath.split('/').map((segment) => encodeURIComponent(segment)).join('/');

/**
 * Resolves the URL the <audio> element should play, always preferring cached bytes over the
 * network for battery and data savings. Resolution order:
 *
 *   1. `media_url` supplied by the caller (local files) — no lookup needed.
 *   2. Pinned offline download, served by the Service Worker (works fully offline, supports
 *      range requests, no blob: URLs).
 *   3. Known `file_path` — the direct /media/ URL, which the SW's cache-first strategy serves
 *      from STREAM_CACHE when the track was played or prefetched before.
 *   4. The /player/ API, which needs network.
 *
 * Every resolution is tagged with a request id: rapid track changes are common (skip, skip,
 * skip) and a slower response for an abandoned track must never set the URL of the one now
 * playing.
 */
export function useStreamUrl(audio: Audio, prefetchEnabled: boolean): StreamResolution {
  const [streamUrl, setStreamUrl] = useState<string>('');
  const [loadingStream, setLoadingStream] = useState(true);
  const [isCachedPlayback, setIsCachedPlayback] = useState(false);
  const resolvedAudioIdRef = useRef<number | null>(null);

  // Reset during render (React's documented "adjust state when a prop changes" pattern) rather
  // than in the effect below: an effect runs after paint, which would hand the previous track's
  // URL to the <audio> element for a frame.
  if (resolvedAudioIdRef.current !== audio.id) {
    resolvedAudioIdRef.current = audio.id;
    setStreamUrl('');
    setLoadingStream(true);
    setIsCachedPlayback(false);
  }

  // audio.id is the sole dependency on purpose: the other fields are derived from the same
  // track, and depending on them re-runs the resolution (and its API call) needlessly.
  useEffect(() => {
    let cancelled = false;

    const resolve = (url: string, fromCache: boolean) => {
      if (cancelled) return;
      setStreamUrl(url);
      setLoadingStream(false);
      setIsCachedPlayback(fromCache);
    };

    const giveUp = () => {
      if (cancelled) return;
      setLoadingStream(false);
      setIsCachedPlayback(false);
    };

    const prefetchInBackground = () => {
      if (!prefetchEnabled) return;
      audioCache.prefetchTrack(audio, 'low').catch(console.error);
    };

    const fetchStreamUrl = async () => {
      if (audio.media_url) {
        resolve(audio.media_url, false);
        return;
      }

      if (!audio.youtube_id) return;

      try {
        setLoadingStream(true);

        if (await audioCache.isAvailableOffline(audio.youtube_id)) {
          if (cancelled) return;
          if (import.meta.env.DEV) console.log('[Player] ✓ Playing from pinned offline download:', audio.title);
          resolve(`/api/audio/${audio.youtube_id}/download/`, true);
          return;
        }

        if (audio.file_path) {
          if (import.meta.env.DEV) console.log('[Player] → Streaming (SW serves from STREAM_CACHE when available):', audio.title);
          resolve(`/media/${encodeMediaPath(audio.file_path)}`, false);
          if (!cancelled) prefetchInBackground();
          return;
        }

        if (!navigator.onLine) {
          console.warn('[Player] ✗ Offline and no cached audio available:', audio.title);
          giveUp();
          return;
        }

        if (import.meta.env.DEV) console.log('[Player] → Fetching stream URL from API:', audio.title);
        const response = await fetch(`/api/audio/${audio.youtube_id}/player/`, {
          credentials: 'include',
        });
        // Without this the error body parses into an object with no stream_url, which would
        // silently set the <audio> src to undefined instead of surfacing a failure.
        if (!response.ok) {
          throw new Error(`player endpoint ${response.status}`);
        }
        const data = await response.json();
        if (cancelled) return;

        resolve(data.stream_url, false);
        if (data.stream_url) prefetchInBackground();
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to fetch stream URL:', error);
        setLoadingStream(false);
      }
    };

    fetchStreamUrl();

    return () => {
      cancelled = true;
    };
  }, [audio.id]);

  return { streamUrl, loadingStream, isCachedPlayback };
}
