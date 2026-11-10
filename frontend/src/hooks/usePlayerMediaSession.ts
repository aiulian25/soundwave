import { useEffect, useState, type MutableRefObject, type RefObject } from 'react';
import type { Audio } from '../types';
import { audioAPI } from '../api/client';
import { useSettings } from '../context/SettingsContext';
import { clearMediaSession, setMediaActionHandlers, setMediaMetadata } from '../utils/mediaSession';
import { useTranslation } from 'react-i18next';

interface MediaSessionInputs {
  audio: Audio;
  audioRef: RefObject<HTMLAudioElement>;
  /** Set while a seek is being applied, so the element's time updates are not taken for playback. */
  isSeeking: MutableRefObject<boolean>;
  isPlayingRef: MutableRefObject<boolean>;
  setCurrentTime: (seconds: number) => void;
  setIsPlaying: (playing: boolean) => void;
  hasNext: boolean;
  hasPrevious: boolean;
  onNext?: () => void;
  onPrevious?: () => void;
}

/** Tells the operating system what is playing and lets its media keys and lock screen drive the player. */
export function usePlayerMediaSession({
  audio, audioRef, isSeeking, isPlayingRef, setCurrentTime, setIsPlaying, hasNext, hasPrevious, onNext, onPrevious,
}: MediaSessionInputs) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const [lockScreenArtwork, setLockScreenArtwork] = useState('');

  // The OS fetches lock-screen artwork without our session cookie, so a server track's artwork
  // needs the short-lived ticketed address. Imported local files carry their own image.
  useEffect(() => {
    setLockScreenArtwork('');
    if (!audio.youtube_id) return undefined;

    let cancelled = false;
    audioAPI
      .getPlayer(audio.youtube_id)
      .then((response) => {
        if (!cancelled) setLockScreenArtwork(response.data.artwork_ticket_url ?? '');
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [audio.youtube_id]);

  // Initialize Media Session API with artwork
  useEffect(() => {
    const artworkUrl = audio.youtube_id ? lockScreenArtwork : audio.cover_art_url || audio.thumbnail_url;
    
    // Function to set metadata with artwork
    const updateMediaSession = (artworkArray?: Array<{src: string; sizes: string; type: string}>) => {
      setMediaMetadata({
        title: audio.title,
        artist: audio.artist || audio.channel_name || t('player.unknownArtist'),
        album: audio.album,
        artwork: artworkArray,
      });
    };

    if (artworkUrl) {
      updateMediaSession([
        { src: artworkUrl, sizes: '96x96', type: 'image/jpeg' },
        { src: artworkUrl, sizes: '128x128', type: 'image/jpeg' },
        { src: artworkUrl, sizes: '256x256', type: 'image/jpeg' },
        { src: artworkUrl, sizes: '512x512', type: 'image/jpeg' },
      ]);
    } else {
      updateMediaSession(undefined);
    }

    // Set action handlers
    setMediaActionHandlers({
      play: () => {
        if (!isPlayingRef.current) {
          setIsPlaying(true);
        }
      },
      pause: () => {
        if (isPlayingRef.current) {
          setIsPlaying(false);
        }
      },
      previoustrack: () => {
        if (hasPrevious && onPrevious) {
          onPrevious();
        }
      },
      nexttrack: () => {
        if (hasNext && onNext) {
          onNext();
        }
      },
      seekbackward: (details) => {
        if (audioRef.current) {
          isSeeking.current = true;
          const seekAmount = details?.seekOffset || settings.seek_duration || 3;
          audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - seekAmount);
          setCurrentTime(audioRef.current.currentTime);
          setTimeout(() => {
            isSeeking.current = false;
          }, 100);
        }
      },
      seekforward: (details) => {
        if (audioRef.current) {
          isSeeking.current = true;
          const seekAmount = details?.seekOffset || settings.seek_duration || 3;
          audioRef.current.currentTime = Math.min(
            audio.duration,
            audioRef.current.currentTime + seekAmount
          );
          setCurrentTime(audioRef.current.currentTime);
          setTimeout(() => {
            isSeeking.current = false;
          }, 100);
        }
      },
      seekto: (details) => {
        if (audioRef.current && details.seekTime !== undefined) {
          isSeeking.current = true;
          audioRef.current.currentTime = details.seekTime;
          setTimeout(() => {
            isSeeking.current = false;
          }, 100);
        }
      },
    });

    // Cleanup on unmount
    return () => {
      clearMediaSession();
    };
  }, [audio, lockScreenArtwork, hasNext, hasPrevious, onNext, onPrevious, setIsPlaying, settings.seek_duration, audioRef, isPlayingRef, isSeeking, setCurrentTime, t]);
}
