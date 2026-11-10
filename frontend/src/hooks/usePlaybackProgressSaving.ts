import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import type { Audio } from '../types';
import { audioAPI, getCsrfToken } from '../api/client';

const MINIMUM_SAVEABLE_POSITION_SECONDS = 10;

interface ProgressSavingInputs {
  audio: Audio;
  isPlaying: boolean;
  audioRef: RefObject<HTMLAudioElement>;
  /** The last known position, for when the element is already detached. */
  currentTimeRef: MutableRefObject<number>;
}

/**
 * Keeps the server's "continue listening" position current: every minute while playing, on
 * pause, and when the track changes or the player goes away. Returns the save function so the
 * player can mark a track as finished.
 */
export function usePlaybackProgressSaving({ audio, isPlaying, audioRef, currentTimeRef }: ProgressSavingInputs) {
  // Save playback progress for "Continue Listening" feature
  // Saves position periodically and when pausing/changing tracks
  // Only saves when online to reduce mobile data usage
  const lastProgressSaveRef = useRef<number>(0);
  const lastSavedPositionRef = useRef<number>(0);
  
  // The <audio> element is the source of truth while it is mounted; the ref covers unmount,
  // when the element may already be detached. Seeks write the element but not the ref, so
  // reading the element first keeps a save that lands after a seek from storing a stale spot.
  const readPlaybackPosition = useCallback(
    () => audioRef.current?.currentTime ?? currentTimeRef.current,
    [audioRef, currentTimeRef]
  );

  const saveProgress = useCallback(async (completed: boolean = false) => {
    // Skip if offline - will sync when back online
    if (!navigator.onLine) {
      console.debug('[Player] Skipping progress save - offline');
      return;
    }
    
    if (!audio.youtube_id) return;
    
    const position = Math.floor(readPlaybackPosition());
    // Only save if position has changed by at least 10 seconds (increased from 5s)
    if (!completed && Math.abs(position - lastSavedPositionRef.current) < 10) return;
    
    try {
      await audioAPI.updateProgress(audio.youtube_id, {
        position,
        completed,
      });
      lastSavedPositionRef.current = position;
      lastProgressSaveRef.current = Date.now();
    } catch (error) {
      // Silently fail - progress save is best effort
      console.debug('[Player] Progress save failed:', error);
    }
  }, [audio.youtube_id, readPlaybackPosition]);
  
  // Periodic progress save while playing
  // Network-aware: only save when online and at reduced frequency
  useEffect(() => {
    if (!isPlaying || !audio.youtube_id) return;
    
    // Check every 30 seconds and save every 60 seconds (reduced frequency for mobile)
    const interval = setInterval(() => {
      if (navigator.onLine && Date.now() - lastProgressSaveRef.current > 60000) {
        saveProgress(false);
      }
    }, 30000);
    
    return () => clearInterval(interval);
  }, [isPlaying, audio.youtube_id, saveProgress]);
  
  // Save progress when pausing (only if online)
  useEffect(() => {
    if (!isPlaying && readPlaybackPosition() > MINIMUM_SAVEABLE_POSITION_SECONDS && audio.youtube_id && navigator.onLine) {
      saveProgress(false);
    }
  }, [isPlaying, audio.youtube_id, saveProgress, readPlaybackPosition]);
  
  // Save progress when the track changes or the player unmounts (only if online).
  // Deliberately does NOT depend on currentTime: a cleanup re-runs on every dependency
  // change, so listing it here fired this request on every timeupdate event.
  useEffect(() => {
    return () => {
      // Skip save if offline
      if (!navigator.onLine) return;

      // The element is ground truth while it is still attached; the ref covers unmount,
      // when the element may already be gone.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- the position has to be read when the cleanup runs, not when the effect did
      const elapsedSeconds = audioRef.current?.currentTime ?? currentTimeRef.current;

      if (elapsedSeconds > MINIMUM_SAVEABLE_POSITION_SECONDS && audio.youtube_id) {
        // Raw fetch rather than the axios client: keepalive lets the request outlive the
        // page, which is the whole point of saving here. That bypasses the client's
        // interceptor, so the CSRF token has to be attached by hand.
        fetch(`/api/audio/${audio.youtube_id}/progress/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken() || '',
          },
          credentials: 'include',
          body: JSON.stringify({ position: Math.floor(elapsedSeconds), completed: false }),
          keepalive: true,
        }).catch(() => {});
      }
    };
  }, [audio.youtube_id, audioRef, currentTimeRef]);

  return saveProgress;
}
