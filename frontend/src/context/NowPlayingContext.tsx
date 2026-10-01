import { createContext, useCallback, useContext, type ReactNode } from 'react';
import type { Audio } from '../types';

// Two contexts so track lists re-render only when the song changes; play/pause reaches just
// the equalizer indicator.
const NowPlayingKeyContext = createContext<string | null>(null);
const PlaybackActiveContext = createContext(false);

interface NowPlayingProviderProps {
  trackKey: string | null;
  isPlaying: boolean;
  children: ReactNode;
}

export function NowPlayingProvider({ trackKey, isPlaying, children }: NowPlayingProviderProps) {
  return (
    <NowPlayingKeyContext.Provider value={trackKey}>
      <PlaybackActiveContext.Provider value={isPlaying}>{children}</PlaybackActiveContext.Provider>
    </NowPlayingKeyContext.Provider>
  );
}

/** Identifies a track on every page: its YouTube id, or the stored file id for local files. */
export function getTrackKey(audio: Pick<Audio, 'youtube_id' | 'local_file_id'> | null): string | null {
  return audio?.youtube_id ?? audio?.local_file_id ?? null;
}

/** Returns a checker telling whether a track key belongs to the track that is playing. */
export function useIsNowPlaying() {
  const nowPlayingKey = useContext(NowPlayingKeyContext);
  return useCallback(
    (trackKey?: string | null) => Boolean(trackKey) && trackKey === nowPlayingKey,
    [nowPlayingKey],
  );
}

export function usePlaybackActive() {
  return useContext(PlaybackActiveContext);
}
