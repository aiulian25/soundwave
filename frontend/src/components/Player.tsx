import {
  Box,
  Typography,
  Fade,
  useMediaQuery,
  useTheme,
  Tooltip,
  Chip,
  ListItemText,
  Collapse,
  List,
  ListItemButton,
} from '@mui/material';
import CachedIcon from '@mui/icons-material/Cached';
import QueueMusicIcon from '@mui/icons-material/QueueMusic';
import { useState, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import type { Audio, Chapter } from '../types';
import { useSettings } from '../context/SettingsContext';
import { useSleepTimer } from '../context/SleepTimerContext';
import { useAchievementNotification } from '../context/AchievementNotificationContext';
import { useSwipeGesture } from '../hooks/useSwipeGesture';
import { useStreamUrl } from '../hooks/useStreamUrl';
import PlayerActionButtons from './player/PlayerActionButtons';
import PlayerArtwork from './player/PlayerArtwork';
import RelatedTracksOverlay from './player/RelatedTracksOverlay';
import PlayerTransportControls from './player/PlayerTransportControls';
import { usePlayerAudioGraph } from '../hooks/usePlayerAudioGraph';
import { usePlaybackProgressSaving } from '../hooks/usePlaybackProgressSaving';
import { usePlayerMediaSession } from '../hooks/usePlayerMediaSession';
import { useTrackRating } from '../hooks/useTrackRating';
import { audioAPI } from '../api/client';
import { ListeningTracker } from '../utils/listeningTracker';
import { recordListeningEvent } from '../utils/listeningOutbox';
// Code-split: the visualizer (17 theme renderers) loads only when the player is shown.
const AudioVisualizer = lazy(() => import('./AudioVisualizer'));
import WaveformSeekBar from './WaveformSeekBar';
import { visualizerThemes } from '../config/visualizerThemes';
import MetadataEditor from './MetadataEditor';
import DownloadDialog from './DownloadDialog';
import StartRadioMenu from './StartRadioMenu';
import SleepTimerDialog from './SleepTimerDialog';
import QueueDrawer from './QueueDrawer';
import EqualizerDialog from './EqualizerDialog';
import AddToPlaylistDialog from './AddToPlaylistDialog';
import { useTranslation } from 'react-i18next';

// Import LyricsPlayer directly instead of lazy to avoid offline loading issues
import LyricsPlayer from './LyricsPlayer';
import { setPlaybackState, setPositionState } from '../utils/mediaSession';

// Below this position a track is treated as "not really started", so no progress is stored.

interface PlayerProps {
  audio: Audio;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  onClose?: () => void;
  onMinimize?: () => void;
  onNext?: () => void;
  /** Moving on because the track finished, which is not a skip. Falls back to onNext. */
  onTrackEnded?: () => void;
  /** The track cannot be played: its file failed to load, or no address for it could be found. */
  onPlaybackError?: () => void;
  onPrevious?: () => void;
  hasNext?: boolean;
  hasPrevious?: boolean;
  onFavoriteToggle?: (audioId: number, isFavorite: boolean) => void;
  onRatingChange?: (audioId: number, rating: number) => void;
  onTrackSelect?: (audio: Audio) => void;
  onTimeUpdate?: (time: number) => void;  // Callback for cross-device sync
  initialSeek?: number;  // Initial seek position for resuming playback
  isRadioMode?: boolean;  // Whether radio mode is active
  // Queue management props
  queue?: Audio[];
  currentQueueIndex?: number;
  onQueueReorder?: (fromIndex: number, toIndex: number) => void;
  onRemoveFromQueue?: (index: number) => void;
  onPlayQueueTrack?: (index: number) => void;
  onClearQueue?: () => void;
}

export default function Player({ audio, isPlaying, setIsPlaying, onClose, onMinimize, onNext, onTrackEnded, onPlaybackError, onPrevious, hasNext = false, hasPrevious = false, onFavoriteToggle, onRatingChange, onTrackSelect, onTimeUpdate, initialSeek, queue = [], currentQueueIndex = 0, onQueueReorder, onRemoveFromQueue, onPlayQueueTrack, onClearQueue }: PlayerProps) {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const { timerState: sleepTimerState, getFadeVolume, shouldStop: shouldSleepStop, onSongEnded } = useSleepTimer();
  const { showAchievements } = useAchievementNotification();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { streamUrl, loadingStream, isCachedPlayback } = useStreamUrl(audio, settings.prefetch_enabled !== false);

  // No address to play from (offline with nothing cached, or the server refused) is as much a
  // failure as a file that will not load, and must not look like a player that is just idle.
  // The callback is read through a ref so that a new function from the parent is not mistaken
  // for a new failure.
  const reportPlaybackError = useRef(onPlaybackError);
  reportPlaybackError.current = onPlaybackError;
  const hasNoStream = !loadingStream && !streamUrl;
  useEffect(() => {
    if (hasNoStream) reportPlaybackError.current?.();
  }, [hasNoStream, audio.id]);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(settings.volume);
  const [repeatMode, setRepeatMode] = useState<'none' | 'one' | 'all'>(settings.repeat_mode);
  const [shuffleEnabled, setShuffleEnabled] = useState(settings.shuffle_enabled);
  const [isMuted, setIsMuted] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [showRelatedTracks, setShowRelatedTracks] = useState(false);
  const [showMetadataEditor, setShowMetadataEditor] = useState(false);
  const [showDownloadDialog, setShowDownloadDialog] = useState(false);
  const [radioMenuAnchor, setRadioMenuAnchor] = useState<HTMLElement | null>(null);
  const [showSleepTimerDialog, setShowSleepTimerDialog] = useState(false);
  const [showQueueDrawer, setShowQueueDrawer] = useState(false);
  const [showEqualizerDialog, setShowEqualizerDialog] = useState(false);
  const [showAddToPlaylistDialog, setShowAddToPlaylistDialog] = useState(false);
  const [currentAudioData, setCurrentAudioData] = useState<Audio>(audio);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isFavorite, setIsFavorite] = useState(audio.is_favorite || false);
  const { rating, rate } = useTrackRating(audio.youtube_id, currentAudioData.rating, (stars) => onRatingChange?.(audio.id, stars));
  const audioRef = useRef<HTMLAudioElement>(null);
  // Latest playback position without the re-render cost of state. Read this from
  // effects and callbacks that only need the value at the moment they run.
  const currentTimeRef = useRef(0);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const isPlayingRef = useRef(isPlaying);
  const isSeeking = useRef(false);
  const currentAudioId = useRef(audio.id);
  const volumeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listeningTracker = useRef(new ListeningTracker());
  const initialSeekApplied = useRef<boolean>(false);  // Track if initial seek was applied
  const advanceAfterEnd = onTrackEnded ?? onNext;


  // Update currentAudioData when audio prop changes
  useEffect(() => {
    setCurrentAudioData(audio);
  }, [audio]);

  // Lists hand the player whatever copy of a track they hold: the homepage sections build
  // lean objects without the details fields (description, counts, published_date) or
  // chapters, and a list loaded before a track was split carries no chapters. Merging the
  // owner-scoped record for every new track keeps the details button and chapters current
  // whichever page started playback, without fattening list payloads.
  useEffect(() => {
    if (!audio.youtube_id || !navigator.onLine) {
      return;
    }
    let cancelled = false;
    audioAPI
      .get(audio.youtube_id)
      .then((response) => {
        if (!cancelled) {
          setCurrentAudioData((previous) => ({ ...previous, ...response.data }));
        }
      })
      .catch(() => undefined); // non-fatal: the player keeps the list's copy
    return () => {
      cancelled = true;
    };
  }, [audio]);

  // Handle initial seek for cross-device resume
  useEffect(() => {
    if (initialSeek && initialSeek > 0 && !initialSeekApplied.current && audioRef.current && streamUrl) {
      const applyInitialSeek = () => {
        if (audioRef.current && audioRef.current.readyState >= 2) {
          if (import.meta.env.DEV) console.log(`[Player] Resuming playback at ${initialSeek}s`);
          audioRef.current.currentTime = initialSeek;
          setCurrentTime(initialSeek);
          initialSeekApplied.current = true;
        }
      };
      
      // Try immediately if audio is ready
      if (audioRef.current.readyState >= 2) {
        applyInitialSeek();
      } else {
        // Wait for audio to be ready
        const handleCanPlay = () => {
          applyInitialSeek();
          audioRef.current?.removeEventListener('canplay', handleCanPlay);
        };
        audioRef.current.addEventListener('canplay', handleCanPlay);
        return () => {
          audioRef.current?.removeEventListener('canplay', handleCanPlay);
        };
      }
    }
  }, [initialSeek, streamUrl]);

  // Reset initial seek flag when audio changes
  useEffect(() => {
    initialSeekApplied.current = false;
  }, [audio.id]);

  // Swipe gestures for mobile navigation
  useSwipeGesture(playerContainerRef, {
    onSwipeLeft: () => hasNext && onNext?.(),
    onSwipeRight: () => hasPrevious && onPrevious?.(),
    onSwipeDown: onMinimize || onClose,
    threshold: 80,
  });

  // Keyboard shortcuts for seek (arrow keys)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if not typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (audioRef.current && streamUrl && !loadingStream) {
        const seekAmount = settings.seek_duration || 3;
        
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          isSeeking.current = true;
          audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - seekAmount);
          setCurrentTime(audioRef.current.currentTime);
          setTimeout(() => { isSeeking.current = false; }, 100);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          isSeeking.current = true;
          audioRef.current.currentTime = Math.min(audio.duration, audioRef.current.currentTime + seekAmount);
          setCurrentTime(audioRef.current.currentTime);
          setTimeout(() => { isSeeking.current = false; }, 100);
        } else if (e.key === ' ') {
          e.preventDefault();
          setIsPlaying(!isPlaying);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [audio.duration, streamUrl, loadingStream, isPlaying, setIsPlaying, settings.seek_duration]);

  // Sync settings from context when they change (volume, repeat, shuffle)
  useEffect(() => {
    if (import.meta.env.DEV) console.log('[Player] Settings sync triggered - volume:', settings.volume, 'repeat:', settings.repeat_mode, 'shuffle:', settings.shuffle_enabled);
    setVolume(settings.volume);
    setRepeatMode(settings.repeat_mode);
    setShuffleEnabled(settings.shuffle_enabled);
  }, [settings.volume, settings.repeat_mode, settings.shuffle_enabled]);

  // Reset stream when audio changes
  if (currentAudioId.current !== audio.id) {
    currentAudioId.current = audio.id;
    setIsFavorite(audio.is_favorite || false);
  }

  const showAchievementsRef = useRef(showAchievements);
  showAchievementsRef.current = showAchievements;

  const finishPlay = useCallback((completed: boolean) => {
    const play = listeningTracker.current.finish(completed);
    if (play) recordListeningEvent(play, showAchievementsRef.current);
  }, []);

  // One play per track, finished before the next begins. Ending the old play in this cleanup is
  // what keeps a partial listen when the user skips. Closing the page ends it too, and if the page
  // comes back from the browser's cache, what follows is a new play.
  useEffect(() => {
    const youtubeId = audio.youtube_id;
    if (!youtubeId) return undefined;

    listeningTracker.current.begin(youtubeId);
    const finishOnPageHide = () => {
      finishPlay(false);
      listeningTracker.current.begin(youtubeId);
    };
    window.addEventListener('pagehide', finishOnPageHide);

    return () => {
      window.removeEventListener('pagehide', finishOnPageHide);
      finishPlay(false);
    };
  }, [audio.id, audio.youtube_id, finishPlay]);

  const saveProgress = usePlaybackProgressSaving({ audio, isPlaying, audioRef, currentTimeRef });

  usePlayerMediaSession({
    audio, audioRef, isSeeking, isPlayingRef, setCurrentTime, setIsPlaying, hasNext, hasPrevious, onNext, onPrevious,
  });

  useEffect(() => {
    if (audioRef.current) {
      // Apply both user volume and sleep timer fade
      const fadeMultiplier = getFadeVolume();
      audioRef.current.volume = (volume / 100) * fadeMultiplier;
    }
  }, [volume, getFadeVolume]);

  // Sleep timer fade effect - update volume during fade
  useEffect(() => {
    if (!sleepTimerState.isFading || !audioRef.current) return;
    
    const fadeInterval = setInterval(() => {
      if (audioRef.current) {
        const fadeMultiplier = getFadeVolume();
        audioRef.current.volume = (volume / 100) * fadeMultiplier;
      }
    }, 500); // Update every 500ms - sufficient for smooth fade with less CPU overhead
    
    return () => clearInterval(fadeInterval);
  }, [sleepTimerState.isFading, volume, getFadeVolume]);

  // Sleep timer stop check
  useEffect(() => {
    if (shouldSleepStop()) {
      if (import.meta.env.DEV) console.log('[Player] Sleep timer triggered stop');
      setIsPlaying(false);
    }
  }, [shouldSleepStop, setIsPlaying]);

  const { getBars, handleVizIntensity } = usePlayerAudioGraph({
    audioRef, playerContainerRef, audio, streamUrl, loadingStream, isPlaying,
  });

  // Handlers for settings changes with debouncing
  const handleVolumeChange = useCallback((_: Event, value: number | number[]) => {
    const vol = value as number;
    setVolume(vol);
    setIsMuted(vol === 0);
    
    // Debounce API call
    if (volumeDebounceRef.current) {
      clearTimeout(volumeDebounceRef.current);
    }
    volumeDebounceRef.current = setTimeout(() => {
      updateSetting('volume', vol);
    }, 300);
  }, [updateSetting]);

  const handleRepeatToggle = useCallback(() => {
    const modes: Array<'none' | 'one' | 'all'> = ['none', 'one', 'all'];
    const currentIndex = modes.indexOf(repeatMode);
    const nextMode = modes[(currentIndex + 1) % modes.length];
    setRepeatMode(nextMode);
    updateSetting('repeat_mode', nextMode);
  }, [repeatMode, updateSetting]);

  const handleShuffleToggle = useCallback(() => {
    const newShuffleState = !shuffleEnabled;
    setShuffleEnabled(newShuffleState);
    updateSetting('shuffle_enabled', newShuffleState);
  }, [shuffleEnabled, updateSetting]);

  // Handle audio source changes
  useEffect(() => {
    if (audioRef.current && streamUrl) {
      // Pause current playback before loading new source
      audioRef.current.pause();
      // Reset current time when audio changes
      setCurrentTime(0);
      // Don't call load() - just changing src is enough and causes less buffering on iOS
      // The browser will automatically start loading when src changes
      // Reset playing ref
      isPlayingRef.current = false;
    }
  }, [streamUrl]);

  // Publish the position to the OS media controller. Called on state changes only —
  // seek, play, pause and canplay — because the Media Session spec interpolates between
  // calls from playbackRate. Doing this per timeupdate was one IPC per tick for nothing.
  const publishPositionState = useCallback(() => {
    const element = audioRef.current;
    if (!element) return;
    setPositionState({
      duration: audio.duration,
      playbackRate: element.playbackRate,
      position: element.currentTime,
    });
  }, [audio.duration]);

  // Handle play/pause state
  useEffect(() => {
    // Skip if we're currently seeking or loading
    if (isSeeking.current || loadingStream) {
      return;
    }

    if (audioRef.current && streamUrl) {
      // Check if the playing state actually changed
      if (isPlaying !== isPlayingRef.current) {
        isPlayingRef.current = isPlaying;
        
        if (isPlaying) {
          // Only play if audio is not already playing
          if (audioRef.current.paused) {
            const playPromise = audioRef.current.play();
            if (playPromise !== undefined) {
              playPromise
                .then(() => {
                  setPlaybackState('playing');
                  publishPositionState();
                })
                .catch(err => {
                  console.error('Playback failed:', err);
                  setIsPlaying(false);
                  isPlayingRef.current = false;
                });
            }
          }
        } else {
          // Only pause if audio is actually playing
          if (!audioRef.current.paused) {
            audioRef.current.pause();
            setPlaybackState('paused');
            publishPositionState();
          }
        }
      }
    }
  }, [isPlaying, setIsPlaying, loadingStream, streamUrl, publishPositionState]);

  const handleTimeUpdate = useCallback(() => {
    // Don't update time display while user is seeking
    if (audioRef.current && !isSeeking.current) {
      const time = audioRef.current.currentTime;
      currentTimeRef.current = time;
      setCurrentTime(time);
      listeningTracker.current.observePosition(time);
      
      // Hand the position to App for cross-device sync. App stores it in a ref, so
      // this does not re-render the app tree.
      onTimeUpdate?.(time);
    }
  }, [onTimeUpdate]);

  const handleCanPlay = useCallback(() => {
    setIsBuffering(false);
    publishPositionState();
  }, [publishPositionState]);

  const handleSeekChange = useCallback((_: Event | null, value: number | number[]) => {
    // Block time updates during drag
    isSeeking.current = true;
    // Update visual position while dragging (no actual seek yet)
    const time = value as number;
    setCurrentTime(time);
  }, []);

  const handleSeekCommitted = useCallback((_: Event | React.SyntheticEvent | null, value: number | number[]) => {
    // Actually seek when user releases slider
    const time = value as number;
    if (audioRef.current && !loadingStream) {
      // Ensure flag is still set
      isSeeking.current = true;
      
      const wasPlaying = !audioRef.current.paused;
      
      // On iOS, don't pause before seeking - it causes more buffering
      // Just seek directly
      audioRef.current.currentTime = time;
      
      // If audio wasn't ready, wait for canplay
      if (audioRef.current.readyState < 2) {
        const handleCanPlay = () => {
          if (audioRef.current) {
            // Seek again to ensure we're at the right position
            audioRef.current.currentTime = time;
            if (wasPlaying) {
              audioRef.current.play().catch(console.error);
            }
            audioRef.current.removeEventListener('canplay', handleCanPlay);
          }
        };
        audioRef.current.addEventListener('canplay', handleCanPlay);
      }
    }
  }, [audio.duration, loadingStream]);

  const handleSeeked = useCallback(() => {
    // Called when the audio element completes seeking - now it's safe to update from time events
    isSeeking.current = false;
    if (audioRef.current) listeningTracker.current.observeSeek(audioRef.current.currentTime);
    publishPositionState();
  }, [publishPositionState]);

  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // --- Chapters (F2) ---------------------------------------------------------
  const chapters: Chapter[] = useMemo(
    () => (Array.isArray(currentAudioData.chapters) ? currentAudioData.chapters : []),
    [currentAudioData.chapters],
  );
  const [chaptersOpen, setChaptersOpen] = useState(false);
  // Index of the chapter currently playing (last chapter whose start <= currentTime).
  const currentChapterIndex = useMemo(() => {
    if (chapters.length < 2) return -1;
    let idx = -1;
    for (let i = 0; i < chapters.length; i++) {
      const s = chapters[i].start;
      if (typeof s === 'number' && s <= currentTime + 0.001) idx = i;
    }
    return idx;
  }, [chapters, currentTime]);
  const currentChapter = currentChapterIndex >= 0 ? chapters[currentChapterIndex] : null;
  // Jump playback to a specific time (mirrors the seek-bar's onSeek + onSeekCommitted).
  const seekTo = useCallback((time: number) => {
    handleSeekChange(null, time);
    handleSeekCommitted(null, time);
  }, [handleSeekChange, handleSeekCommitted]);

  const toggleMute = useCallback(() => {
    setIsMuted(!isMuted);
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
    }
  }, [isMuted]);

  // Handle favorite toggle
  const handleFavoriteToggle = useCallback(async () => {
    if (!audio.youtube_id) {
      console.warn('Cannot toggle favorite for files without youtube_id');
      return;
    }
    
    try {
      await audioAPI.toggleFavorite(audio.youtube_id);
      const newFavoriteState = !isFavorite;
      setIsFavorite(newFavoriteState);
      
      // Notify parent component if callback provided
      if (onFavoriteToggle) {
        onFavoriteToggle(audio.id, newFavoriteState);
      }
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
    }
  }, [audio.id, audio.youtube_id, isFavorite, onFavoriteToggle]);

  // Handle visualizer theme cycling on click
  const handleVisualizerClick = useCallback(() => {
    const currentIndex = visualizerThemes.findIndex(t => t.id === settings.visualizer_theme);
    const nextIndex = (currentIndex + 1) % visualizerThemes.length;
    updateSetting('visualizer_theme', visualizerThemes[nextIndex].id);
  }, [settings.visualizer_theme, updateSetting]);

  // Handed to memoized children: an inline arrow would be a fresh identity on every
  // render, so their shallow prop comparison could never bail out.
  const handleWaveformSeek = useCallback((time: number) => handleSeekChange(null, time), [handleSeekChange]);
  const handleWaveformSeekCommitted = useCallback((time: number) => handleSeekCommitted(null, time), [handleSeekCommitted]);

  const handleQueueDrawerClose = useCallback(() => setShowQueueDrawer(false), []);
  const handleQueuePlayTrack = useCallback((index: number) => {
    onPlayQueueTrack?.(index);
    setShowQueueDrawer(false);
  }, [onPlayQueueTrack]);
  const handleQueueRemoveTrack = useCallback((index: number) => onRemoveFromQueue?.(index), [onRemoveFromQueue]);
  const handleQueueReorderTrack = useCallback((from: number, to: number) => onQueueReorder?.(from, to), [onQueueReorder]);
  const handleQueueClear = useCallback(() => {
    onClearQueue?.();
    setShowQueueDrawer(false);
  }, [onClearQueue]);

  const handleLyricsClose = useCallback(() => setShowLyrics(false), []);
  const handleLyricsSeek = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      // Keep the ref aligned with the element so a save landing after this seek is accurate.
      currentTimeRef.current = time;
      setCurrentTime(time);
    }
  }, []);

  // Visualizer component with AudioVisualizer and theme support
  const VisualizerComponent = useMemo(() => {
    if (!settings.visualizer_enabled) {
      return null;
    }
    
    return (
      <Box 
        onClick={handleVisualizerClick}
        sx={{ 
          cursor: 'pointer',
          '&:hover': {
            opacity: 0.9,
          },
          transition: 'opacity 0.2s ease',
        }}
        title={t('player.visualizerThemeHint', {
          themeName: visualizerThemes.find((theme) => theme.id === settings.visualizer_theme)?.name || t('player.classicBars'),
        })}
      >
        <Suspense fallback={null}>
          <AudioVisualizer
            getData={getBars}
            onIntensity={handleVizIntensity}
            isPlaying={isPlaying}
            themeId={settings.visualizer_theme}
            height={120}
            // Canvas shadow blur is a Gaussian pass per stroke and disproportionately
            // expensive on phone GPUs, so the glow is skipped on small screens.
            showGlow={settings.visualizer_glow && !isMobile}
          />
        </Suspense>
      </Box>
    );
  }, [getBars, handleVizIntensity, isPlaying, settings.visualizer_theme, settings.visualizer_enabled, settings.visualizer_glow, handleVisualizerClick]);

  return (
    <Box
      ref={playerContainerRef}
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
        touchAction: 'pan-y', // Allow vertical scrolling but enable horizontal swipe detection
      }}
    >
      {/* Background Blur Image */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            background: (theme) => {
              const isDark = theme.palette.mode === 'dark';
              return isDark
                ? `linear-gradient(to bottom, ${theme.palette.background.paper} 0%, ${theme.palette.background.paper}e6 50%, ${theme.palette.background.default} 100%)`
                : `linear-gradient(to bottom, ${theme.palette.background.paper}f0 0%, ${theme.palette.background.paper}f5 50%, ${theme.palette.background.default}ff 100%)`;
            },
            zIndex: 10,
          }}
        />
        {/* Audio-reactive glow. Opacity is driven by the --sw-viz-intensity CSS
            variable that the visualizer updates each frame (no React re-render). */}
        <Box
          sx={(theme) => ({
            position: 'absolute',
            inset: 0,
            background: `radial-gradient(ellipse at center, ${theme.palette.primary.main} 0%, transparent 70%)`,
            opacity:
              theme.palette.mode === 'dark'
                ? 'calc(var(--sw-viz-intensity, 0) * 0.18)'
                : 'calc(var(--sw-viz-intensity, 0) * 0.07)',
            zIndex: 11,
            transition: 'opacity 0.15s ease',
            pointerEvents: 'none',
          })}
        />
        <Box
          sx={{
            width: '100%',
            height: '100%',
            backgroundImage: audio.cover_art_url || audio.thumbnail_url
              ? `url(${audio.cover_art_url || audio.thumbnail_url})`
              : 'none',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'blur(60px)',
            opacity: 0.3,
            // Overscan so the blur's faded edges fall outside the viewport.
            transform: 'scale(1.5)',
            // Promote to its own compositor layer. Nothing here animates, but the glow layer
            // directly above rewrites its opacity every frame; without promotion that dirties
            // this one and re-runs a full-screen Gaussian each time. Promoted, the blur is
            // rasterized once per artwork change and thereafter only composited.
            willChange: 'transform',
          }}
        />
      </Box>

      {/* Content */}
      <Box
        sx={{
          position: 'relative',
          zIndex: 20,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          p: 3,
          justifyContent: 'space-between',
        }}
      >
        {streamUrl ? (
          <audio
            ref={audioRef}
            src={streamUrl}
            preload="auto"
            playsInline
            x-webkit-airplay="allow"
            onTimeUpdate={handleTimeUpdate}
            onSeeked={handleSeeked}
            onWaiting={() => setIsBuffering(true)}
            onCanPlay={handleCanPlay}
            onPlaying={() => setIsBuffering(false)}
            onStalled={() => {
              console.warn('[Player] Audio stalled');
              setIsBuffering(true);
              // Don't call load() on stall - it causes more buffering
              // Just wait for the browser to recover
            }}
            onEnded={() => {
              finishPlay(true);
              // Mark progress as completed
              saveProgress(true);
              
              // Notify sleep timer that song ended and check if we should stop
              const sleepTimerShouldStop = onSongEnded();
              
              // If sleep timer says stop, don't proceed to next track
              if (sleepTimerShouldStop) {
                if (import.meta.env.DEV) console.log('[Player] Sleep timer triggered stop - not playing next track');
                setIsPlaying(false);
                return;
              }
              
              // Handle repeat modes
              if (repeatMode === 'one') {
                // Repeat current track: a genuinely new play
                if (audio.youtube_id) listeningTracker.current.begin(audio.youtube_id);
                if (audioRef.current) {
                  audioRef.current.currentTime = 0;
                  audioRef.current.play().catch(console.error);
                }
              } else if (hasNext && advanceAfterEnd) {
                // Play next track (works for both 'none' and 'all' when not at end)
                advanceAfterEnd();
              } else if (repeatMode === 'all' && advanceAfterEnd) {
                // At end of playlist with repeat all - go back to first track
                // This is handled by the parent component
                advanceAfterEnd();
              } else {
                setIsPlaying(false);
              }
            }}
            onError={() => onPlaybackError?.()}
          />
        ) : (
          <audio ref={audioRef} />
        )}

        {/* Top: Visualizer */}
        {VisualizerComponent}

        {/* Middle: Album Art & Song Info */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 4 }}>
          <PlayerArtwork
            key={audio.id}
            audio={audio}
            isPlaying={isPlaying}
            isBuffering={isBuffering}
            onToggleLyrics={() => audio.youtube_id && setShowLyrics(!showLyrics)}
          />
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5, textAlign: 'center', px: 2, color: 'text.primary' }}>
            {audio.title}
          </Typography>
          {currentChapter?.title && (
            <Typography
              variant="body2"
              sx={{ textAlign: 'center', color: 'text.secondary', mb: 0.5, px: 2 }}
              noWrap
            >
              {t('player.chapters.current', { title: currentChapter.title })}
            </Typography>
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="body1" sx={{ fontWeight: 500, color: 'primary.main' }}>
              {currentAudioData.artist || audio.channel_name}
            </Typography>
            {currentAudioData.album && (
              <Typography variant="body2" color="text.secondary">
                • {currentAudioData.album} {currentAudioData.year && `(${currentAudioData.year})`}
              </Typography>
            )}
            {isCachedPlayback && (
              <Tooltip title={t('player.playingFromCache')}>
                <CachedIcon sx={{ fontSize: 16, color: 'success.main' }} />
              </Tooltip>
            )}
          </Box>
          <PlayerActionButtons
            audio={audio}
            isFavorite={isFavorite}
            relatedTracksAvailable={Boolean(onTrackSelect)}
            showRelatedTracks={showRelatedTracks}
            queueLength={queue.length}
            onMinimize={onMinimize}
            onFavoriteToggle={handleFavoriteToggle}
            onToggleRelatedTracks={() => setShowRelatedTracks(!showRelatedTracks)}
            onAddToPlaylist={() => setShowAddToPlaylistDialog(true)}
            onExport={() => setShowDownloadDialog(true)}
            onEditMetadata={() => setShowMetadataEditor(true)}
            onOpenRadioMenu={setRadioMenuAnchor}
            onOpenSleepTimer={() => setShowSleepTimerDialog(true)}
            onOpenQueue={() => setShowQueueDrawer(true)}
            onOpenEqualizer={() => setShowEqualizerDialog(true)}
          />
        </Box>

        {/* Bottom: Player Controls */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Waveform Progress Bar */}
          <WaveformSeekBar
            currentTime={currentTime}
            duration={audio.duration}
            onSeek={handleWaveformSeek}
            onSeekCommitted={handleWaveformSeekCommitted}
            streamUrl={streamUrl}
            chapters={chapters}
          />

          {/* Chapter list (F2) — accessible, touch/keyboard-friendly navigation */}
          {chapters.length >= 2 && (
            <Box>
              <Chip
                icon={<QueueMusicIcon />}
                label={`${t('player.chapters.title')} (${chapters.length})`}
                onClick={() => setChaptersOpen((o) => !o)}
                variant="outlined"
                size="small"
                aria-expanded={chaptersOpen}
                sx={{ mb: chaptersOpen ? 1 : 0 }}
              />
              <Collapse in={chaptersOpen}>
                <List dense disablePadding sx={{ maxHeight: 220, overflowY: 'auto' }}>
                  {chapters.map((ch, i) => (
                    <ListItemButton
                      key={i}
                      selected={i === currentChapterIndex}
                      onClick={() => seekTo(typeof ch.start === 'number' ? ch.start : 0)}
                      sx={{ borderRadius: 1, py: 0.25 }}
                    >
                      <ListItemText
                        primary={ch.title || `${i + 1}`}
                        secondary={typeof ch.start === 'number' ? formatTime(ch.start) : undefined}
                        primaryTypographyProps={{ noWrap: true, fontSize: '0.85rem' }}
                        secondaryTypographyProps={{ fontSize: '0.7rem', sx: { fontVariantNumeric: 'tabular-nums' } }}
                      />
                    </ListItemButton>
                  ))}
                </List>
              </Collapse>
            </Box>
          )}

          <PlayerTransportControls
            isPlaying={isPlaying}
            loadingStream={loadingStream}
            hasNext={hasNext}
            hasPrevious={hasPrevious}
            shuffleEnabled={shuffleEnabled}
            repeatMode={repeatMode}
            isMuted={isMuted}
            volume={volume}
            onPlayPause={() => setIsPlaying(!isPlaying)}
            onNext={onNext}
            onPrevious={onPrevious}
            onShuffleToggle={handleShuffleToggle}
            onRepeatToggle={handleRepeatToggle}
            onToggleMute={toggleMute}
            onVolumeChange={handleVolumeChange}
          />

        </Box>
      </Box>

      {/* Related Tracks Overlay */}
      {showRelatedTracks && audio.youtube_id && onTrackSelect && (
        <RelatedTracksOverlay
          audio={audio}
          onClose={() => setShowRelatedTracks(false)}
          onTrackSelect={onTrackSelect}
          onFavoriteToggle={onFavoriteToggle}
        />
      )}

      {/* Lyrics Overlay */}
      {showLyrics && audio.youtube_id && (
        <Fade in={showLyrics}>
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              // See the related-tracks overlay above: invisible at this opacity, recomputed
              // every frame because the player behind it animates.
              bgcolor: 'rgba(0, 0, 0, 0.95)',
              zIndex: 20,
              overflow: 'auto',
            }}
          >
            <LyricsPlayer
              youtubeId={audio.youtube_id}
              currentTime={currentTime}
              duration={audio.duration}
              onClose={handleLyricsClose}
              embedded={true}
              visualizerTheme={settings.visualizer_theme}
              isLightMode={theme.palette.mode === 'light'}
              description={currentAudioData.description}
              viewCount={currentAudioData.view_count}
              likeCount={currentAudioData.like_count}
              publishedDate={currentAudioData.published_date}
              rating={rating}
              onRate={rate}
              onSeek={handleLyricsSeek}
            />
          </Box>
        </Fade>
      )}

      {/* Metadata Editor Dialog */}
      {audio.youtube_id && (
        <MetadataEditor
          audio={currentAudioData}
          open={showMetadataEditor}
          onClose={() => setShowMetadataEditor(false)}
          onUpdate={(updatedAudio) => setCurrentAudioData(updatedAudio)}
        />
      )}

      {/* Download/Export Dialog */}
      {audio.youtube_id && (
        <DownloadDialog
          youtubeId={audio.youtube_id}
          title={audio.title}
          open={showDownloadDialog}
          onClose={() => setShowDownloadDialog(false)}
        />
      )}

      {/* Start Radio Menu */}
      <StartRadioMenu
        anchorEl={radioMenuAnchor}
        open={Boolean(radioMenuAnchor)}
        onClose={() => setRadioMenuAnchor(null)}
        track={audio}
      />

      {/* Sleep Timer Dialog */}
      <SleepTimerDialog
        open={showSleepTimerDialog}
        onClose={() => setShowSleepTimerDialog(false)}
      />

      {/* Queue Drawer */}
      <QueueDrawer
        open={showQueueDrawer}
        onClose={handleQueueDrawerClose}
        queue={queue}
        currentIndex={currentQueueIndex}
        onPlayTrack={handleQueuePlayTrack}
        onRemoveTrack={handleQueueRemoveTrack}
        onReorderTrack={handleQueueReorderTrack}
        onClearQueue={handleQueueClear}
      />

      {/* Equalizer Dialog */}
      <EqualizerDialog
        open={showEqualizerDialog}
        onClose={() => setShowEqualizerDialog(false)}
      />

      {/* Add to Playlist Dialog */}
      <AddToPlaylistDialog
        open={showAddToPlaylistDialog}
        onClose={() => setShowAddToPlaylistDialog(false)}
        track={audio}
      />
    </Box>
  );
}
