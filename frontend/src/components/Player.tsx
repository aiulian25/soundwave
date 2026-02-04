import { Box, IconButton, Slider, Typography, LinearProgress, Fade, Skeleton, CircularProgress, Tabs, Tab, useMediaQuery, useTheme, Tooltip, Chip, Menu, MenuItem, ListItemIcon, ListItemText, Divider } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import SkipPreviousIcon from '@mui/icons-material/SkipPrevious';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import ShuffleIcon from '@mui/icons-material/Shuffle';
import RepeatIcon from '@mui/icons-material/Repeat';
import RepeatOneIcon from '@mui/icons-material/RepeatOne';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import FavoriteIcon from '@mui/icons-material/Favorite';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import RecommendIcon from '@mui/icons-material/Recommend';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CachedIcon from '@mui/icons-material/Cached';
import CloseIcon from '@mui/icons-material/Close';
import MusicNoteIcon from '@mui/icons-material/MusicNote';
import EditIcon from '@mui/icons-material/Edit';
import DownloadIcon from '@mui/icons-material/Download';
import RadioIcon from '@mui/icons-material/Radio';
import BedtimeIcon from '@mui/icons-material/Bedtime';
import QueueMusicIcon from '@mui/icons-material/QueueMusic';
import EqualizerIcon from '@mui/icons-material/Equalizer';
import { useState, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import type { Audio } from '../types';
import { useSettings } from '../context/SettingsContext';
import { useRadio } from '../context/RadioContext';
import { useSleepTimer } from '../context/SleepTimerContext';
import { useEqualizer } from '../context/EqualizerContext';
import { useAchievementNotification } from '../context/AchievementNotificationContext';
import { useSwipeGesture } from '../hooks/useSwipeGesture';
import { audioAPI, statsAPI } from '../api/client';
import AudioVisualizer from './AudioVisualizer';
import WaveformSeekBar from './WaveformSeekBar';
import { visualizerThemes } from '../config/visualizerThemes';
import { audioCache } from '../utils/audioCache';
import MetadataEditor from './MetadataEditor';
import DownloadDialog from './DownloadDialog';
import StartRadioMenu from './StartRadioMenu';
import SleepTimerDialog from './SleepTimerDialog';
import QueueDrawer from './QueueDrawer';
import EqualizerDialog from './EqualizerDialog';
import AddToPlaylistDialog from './AddToPlaylistDialog';

// Import LyricsPlayer directly instead of lazy to avoid offline loading issues
import LyricsPlayer from './LyricsPlayer';
const RelatedTracks = lazy(() => import('./RelatedTracks'));
import {
  setMediaMetadata,
  setMediaActionHandlers,
  setPlaybackState,
  setPositionState,
  clearMediaSession,
} from '../utils/mediaSession';

interface PlayerProps {
  audio: Audio;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  onClose?: () => void;
  onMinimize?: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  hasNext?: boolean;
  hasPrevious?: boolean;
  onFavoriteToggle?: (audioId: number, isFavorite: boolean) => void;
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

export default function Player({ audio, isPlaying, setIsPlaying, onClose, onMinimize, onNext, onPrevious, hasNext = false, hasPrevious = false, onFavoriteToggle, onTrackSelect, onTimeUpdate, initialSeek, isRadioMode = false, queue = [], currentQueueIndex = 0, onQueueReorder, onRemoveFromQueue, onPlayQueueTrack, onClearQueue }: PlayerProps) {
  const { settings, updateSetting } = useSettings();
  const { isRadioMode: radioActive, stopRadio } = useRadio();
  const { timerState: sleepTimerState, getFadeVolume, shouldStop: shouldSleepStop, onSongEnded } = useSleepTimer();
  const { enabled: eqEnabled, gains: eqGains, connectAudioSource } = useEqualizer();
  const { showAchievements } = useAchievementNotification();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
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
  const [trackActionsMenuAnchor, setTrackActionsMenuAnchor] = useState<HTMLElement | null>(null);
  const [showAddToPlaylistDialog, setShowAddToPlaylistDialog] = useState(false);
  const [currentAudioData, setCurrentAudioData] = useState<Audio>(audio);
  const [activeTab, setActiveTab] = useState(0);
  const [streamUrl, setStreamUrl] = useState<string>('');
  const [loadingStream, setLoadingStream] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isCachedPlayback, setIsCachedPlayback] = useState(false);
  const [visualizerData, setVisualizerData] = useState<number[]>(Array(16).fill(0));
  const [isFavorite, setIsFavorite] = useState(audio.is_favorite || false);
  const [imageLoadError, setImageLoadError] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const eqFiltersRef = useRef<BiquadFilterNode[]>([]);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const isPlayingRef = useRef(isPlaying);
  const isSeeking = useRef(false);
  const currentAudioId = useRef(audio.id);
  const volumeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playStartTimeRef = useRef<number>(0);
  const listenedDurationRef = useRef<number>(0);
  const hasRecordedPlayRef = useRef<boolean>(false);
  const initialSeekApplied = useRef<boolean>(false);  // Track if initial seek was applied

  // EQ frequencies (10-band)
  const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

  // Update currentAudioData when audio prop changes
  useEffect(() => {
    setCurrentAudioData(audio);
  }, [audio]);

  // Handle initial seek for cross-device resume
  useEffect(() => {
    if (initialSeek && initialSeek > 0 && !initialSeekApplied.current && audioRef.current && streamUrl) {
      const applyInitialSeek = () => {
        if (audioRef.current && audioRef.current.readyState >= 2) {
          console.log(`[Player] Resuming playback at ${initialSeek}s`);
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
    console.log('[Player] Settings sync triggered - volume:', settings.volume, 'repeat:', settings.repeat_mode, 'shuffle:', settings.shuffle_enabled);
    setVolume(settings.volume);
    setRepeatMode(settings.repeat_mode);
    setShuffleEnabled(settings.shuffle_enabled);
  }, [settings.volume, settings.repeat_mode, settings.shuffle_enabled]);

  // Reset stream when audio changes
  if (currentAudioId.current !== audio.id) {
    currentAudioId.current = audio.id;
    setStreamUrl('');
    setLoadingStream(true);
    setIsCachedPlayback(false);
    setIsFavorite(audio.is_favorite || false);
    setImageLoadError(false); // Reset image error state for new track
    // Reset listening tracking for new track
    playStartTimeRef.current = 0;
    listenedDurationRef.current = 0;
    hasRecordedPlayRef.current = false;
  }

  // Record listening history when playback ends or track changes
  const recordListeningHistory = useCallback(async (completed: boolean) => {
    if (!audio.youtube_id || hasRecordedPlayRef.current) return;
    
    const durationListened = listenedDurationRef.current;
    // Only record if listened for at least 10 seconds
    if (durationListened < 10) return;
    
    hasRecordedPlayRef.current = true;
    
    try {
      const response = await statsAPI.recordListening({
        youtube_id: audio.youtube_id,
        duration_listened: Math.floor(durationListened),
        completed,
      });
      
      // Check for new achievements in the response
      if (response.data?.new_achievements && response.data.new_achievements.length > 0) {
        showAchievements(response.data.new_achievements);
      }
    } catch (error) {
      console.error('Failed to record listening history:', error);
    }
  }, [audio.youtube_id, showAchievements]);

  // Track play duration
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    
    if (isPlaying && !loadingStream) {
      if (playStartTimeRef.current === 0) {
        playStartTimeRef.current = Date.now();
      }
      
      // Update listened duration every second
      interval = setInterval(() => {
        listenedDurationRef.current += 1;
      }, 1000);
    }
    
    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [isPlaying, loadingStream]);

  // Record on component unmount or track change
  useEffect(() => {
    return () => {
      // Record when track changes (component stays mounted)
      if (listenedDurationRef.current >= 10 && audio.youtube_id && !hasRecordedPlayRef.current) {
        recordListeningHistory(false);
      }
    };
  }, [audio.id, audio.youtube_id, recordListeningHistory]);

  // Fetch stream URL when audio changes - ALWAYS prioritize cache for battery/data savings
  useEffect(() => {
    const fetchStreamUrl = async () => {
      if (audio.media_url) {
        setStreamUrl(audio.media_url);
        setLoadingStream(false);
        setIsCachedPlayback(false);
        return;
      }

      if (audio.youtube_id) {
        try {
          setLoadingStream(true);
          
          // PRIORITY: Check ALL caches first (IndexedDB + Service Worker)
          // This reduces data usage and battery consumption
          const cachedResult = await audioCache.getAnyCachedUrl(audio.youtube_id);
          if (cachedResult) {
            console.log(`[Player] ✓ Playing from ${cachedResult.source} cache (saves data/battery):`, audio.title);
            setStreamUrl(cachedResult.url);
            setLoadingStream(false);
            setIsCachedPlayback(true);
            return; // Always use cache if available - don't stream online
          }
          
          // Check if we're offline - if so, we can't fetch from server
          if (!navigator.onLine) {
            console.warn('[Player] ✗ Offline and no cached audio available:', audio.title);
            setLoadingStream(false);
            setIsCachedPlayback(false);
            return;
          }
          
          // OPTIMIZATION: If we have file_path, construct URL directly without API call
          // This reduces latency and prevents buffering on track change
          if (audio.file_path) {
            const encodedPath = audio.file_path.split('/').map(part => encodeURIComponent(part)).join('/');
            const directUrl = `/media/${encodedPath}`;
            console.log('[Player] → Streaming directly (no API call):', audio.title);
            setStreamUrl(directUrl);
            setLoadingStream(false);
            setIsCachedPlayback(false);
            
            // Cache the audio in the background for future plays
            if (settings.prefetch_enabled !== false) {
              audioCache.prefetchTrack(audio, 'low').catch(console.error);
            }
            return;
          }
          
          // Fallback: fetch stream URL from API (for tracks without file_path)
          console.log('[Player] → Fetching stream URL from API:', audio.title);
          const response = await fetch(`/api/audio/${audio.youtube_id}/player/`, {
            headers: {
              'Authorization': `Token ${localStorage.getItem('token')}`,
            },
          });
          const data = await response.json();
          setStreamUrl(data.stream_url);
          setLoadingStream(false);
          setIsCachedPlayback(false);
          
          // Cache the audio in the background for future plays (saves data next time)
          if (data.stream_url && settings.prefetch_enabled !== false) {
            audioCache.prefetchTrack(audio, 'low').catch(console.error);
          }
        } catch (error) {
          console.error('Failed to fetch stream URL:', error);
          
          // If fetch failed (possibly offline), try one more time to get cached audio
          const cachedResult = await audioCache.getAnyCachedUrl(audio.youtube_id);
          if (cachedResult) {
            console.log(`[Player] ✓ Fallback to ${cachedResult.source} cache after fetch error:`, audio.title);
            setStreamUrl(cachedResult.url);
            setIsCachedPlayback(true);
          }
          
          setLoadingStream(false);
        }
      }
    };

    fetchStreamUrl();
    // Use audio.id as single dependency to prevent double fetching
  }, [audio.id]);

  // Initialize Media Session API with artwork
  useEffect(() => {
    // Get the best available artwork URL - use our proxy to avoid CORS issues
    const artworkUrl = audio.cover_art_url || audio.thumbnail_url;
    const proxyArtworkUrl = `/api/audio/${audio.youtube_id}/artwork/`;
    
    // Function to set metadata with artwork
    const updateMediaSession = (artworkArray?: Array<{src: string; sizes: string; type: string}>) => {
      setMediaMetadata({
        title: audio.title,
        artist: audio.artist || audio.channel_name || 'Unknown Artist',
        album: audio.album,
        artwork: artworkArray,
      });
    };

    // Use proxied URL for artwork (works with CORS)
    if (artworkUrl) {
      updateMediaSession([
        { src: proxyArtworkUrl, sizes: '96x96', type: 'image/jpeg' },
        { src: proxyArtworkUrl, sizes: '128x128', type: 'image/jpeg' },
        { src: proxyArtworkUrl, sizes: '256x256', type: 'image/jpeg' },
        { src: proxyArtworkUrl, sizes: '512x512', type: 'image/jpeg' },
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
  }, [audio, hasNext, hasPrevious, onNext, onPrevious, setIsPlaying, settings.seek_duration]);

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
    }, 100); // Update every 100ms for smooth fade
    
    return () => clearInterval(fadeInterval);
  }, [sleepTimerState.isFading, volume, getFadeVolume]);

  // Sleep timer stop check
  useEffect(() => {
    if (shouldSleepStop()) {
      console.log('[Player] Sleep timer triggered stop');
      setIsPlaying(false);
    }
  }, [shouldSleepStop, setIsPlaying]);

  // iOS Audio Context resume - Safari requires user interaction to start AudioContext
  useEffect(() => {
    const resumeAudioContext = () => {
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        console.log('[Player] Resuming suspended AudioContext (iOS)');
        audioContextRef.current.resume().catch(console.error);
      }
    };
    
    // Resume on user interaction
    const events = ['touchstart', 'touchend', 'click', 'keydown'];
    events.forEach(event => {
      document.addEventListener(event, resumeAudioContext, { once: true, passive: true });
    });
    
    return () => {
      events.forEach(event => {
        document.removeEventListener(event, resumeAudioContext);
      });
    };
  }, []);

  // Initialize Web Audio API for visualizer and EQ
  useEffect(() => {
    if (!audioRef.current || !streamUrl) return;

    // Create audio context, EQ filters, and analyser
    if (!audioContextRef.current) {
      try {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        sourceNodeRef.current = audioContextRef.current.createMediaElementSource(audioRef.current);
        
        // Create 10-band EQ filters
        eqFiltersRef.current = EQ_FREQUENCIES.map((freq) => {
          const filter = audioContextRef.current!.createBiquadFilter();
          filter.type = 'peaking';
          filter.frequency.value = freq;
          filter.Q.value = 1.4; // Standard Q for 10-band EQ
          filter.gain.value = 0; // Will be updated by EQ context
          return filter;
        });
        
        // Create analyser for visualizer
        analyserRef.current = audioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 64; // 32 frequency bins
        analyserRef.current.smoothingTimeConstant = 0.8; // Smooth animation
        
        // Connect chain: source -> EQ filters -> analyser -> destination
        let lastNode: AudioNode = sourceNodeRef.current;
        
        // Connect EQ filters in series
        eqFiltersRef.current.forEach((filter) => {
          lastNode.connect(filter);
          lastNode = filter;
        });
        
        // Connect to analyser and then to destination
        lastNode.connect(analyserRef.current);
        analyserRef.current.connect(audioContextRef.current.destination);
        
        dataArrayRef.current = new Uint8Array(analyserRef.current.frequencyBinCount);
        console.log('[Player] Audio chain initialized with EQ');
      } catch (error) {
        console.error('Web Audio API not supported:', error);
      }
    }

    // Animate visualizer with real audio data
    const updateVisualizer = () => {
      if (analyserRef.current && dataArrayRef.current && isPlayingRef.current) {
        analyserRef.current.getByteFrequencyData(dataArrayRef.current as any);
        
        // Sample 16 frequencies evenly across the spectrum
        const bars: number[] = [];
        const step = Math.floor(dataArrayRef.current.length / 16);
        for (let i = 0; i < 16; i++) {
          const index = Math.min(i * step, dataArrayRef.current.length - 1);
          // Normalize to 0-1 and apply slight boost to lower frequencies
          const value = dataArrayRef.current[index] / 255;
          const boost = i < 8 ? 1.3 : 1.0; // Boost bass/mid frequencies
          bars.push(Math.min(value * boost, 1));
        }
        
        setVisualizerData(bars);
      } else if (!isPlayingRef.current) {
        // Fade to zero when not playing
        setVisualizerData(prev => prev.map(v => v * 0.9));
      }
      
      animationFrameRef.current = requestAnimationFrame(updateVisualizer);
    };
    
    updateVisualizer();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [streamUrl]);

  // Apply EQ gains when they change
  useEffect(() => {
    if (eqFiltersRef.current.length > 0) {
      eqFiltersRef.current.forEach((filter, index) => {
        if (eqGains[index] !== undefined) {
          filter.gain.value = eqEnabled ? eqGains[index] : 0;
        }
      });
    }
  }, [eqGains, eqEnabled]);

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
          }
        }
      }
    }
  }, [isPlaying, setIsPlaying, loadingStream, streamUrl]);

  const handleTimeUpdate = useCallback(() => {
    // Don't update time display while user is seeking
    if (audioRef.current && !isSeeking.current) {
      const time = audioRef.current.currentTime;
      setCurrentTime(time);
      
      // Notify parent for cross-device sync (throttled in parent)
      onTimeUpdate?.(time);
      
      // Update Media Session position state
      setPositionState({
        duration: audio.duration,
        playbackRate: audioRef.current.playbackRate,
        position: time,
      });
    }
  }, [audio.duration]);

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
  }, []);

  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

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
        title={`Click to change visualizer theme (Current: ${visualizerThemes.find(t => t.id === settings.visualizer_theme)?.name || 'Classic Bars'})`}
      >
        <AudioVisualizer
          data={visualizerData}
          isPlaying={isPlaying}
          themeId={settings.visualizer_theme}
          height={120}
          showGlow={settings.visualizer_glow}
        />
      </Box>
    );
  }, [visualizerData, isPlaying, settings.visualizer_theme, settings.visualizer_enabled, settings.visualizer_glow, handleVisualizerClick]);

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
        {/* Animated gradient overlay based on audio intensity */}
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            background: (theme) => {
              const intensity = isPlaying ? Math.max(...visualizerData) * 0.15 : 0;
              const isDark = theme.palette.mode === 'dark';
              // More subtle on light themes
              const adjustedIntensity = isDark ? intensity : intensity * 0.4;
              return `radial-gradient(ellipse at center, ${theme.palette.primary.main}${Math.round(adjustedIntensity * 255).toString(16).padStart(2, '0')} 0%, transparent 70%)`;
            },
            zIndex: 11,
            transition: 'background 0.15s ease',
            pointerEvents: 'none',
          }}
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
            transform: 'scale(1.5)',
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
            onCanPlay={() => setIsBuffering(false)}
            onPlaying={() => setIsBuffering(false)}
            onStalled={() => {
              console.warn('[Player] Audio stalled');
              setIsBuffering(true);
              // Don't call load() on stall - it causes more buffering
              // Just wait for the browser to recover
            }}
            onEnded={() => {
              // Record completed play
              recordListeningHistory(true);
              
              // Notify sleep timer that song ended and check if we should stop
              const sleepTimerShouldStop = onSongEnded();
              
              // If sleep timer says stop, don't proceed to next track
              if (sleepTimerShouldStop) {
                console.log('[Player] Sleep timer triggered stop - not playing next track');
                setIsPlaying(false);
                return;
              }
              
              // Handle repeat modes
              if (repeatMode === 'one') {
                // Repeat current track
                if (audioRef.current) {
                  audioRef.current.currentTime = 0;
                  audioRef.current.play().catch(console.error);
                }
              } else if (hasNext && onNext) {
                // Play next track (works for both 'none' and 'all' when not at end)
                onNext();
              } else if (repeatMode === 'all' && onNext) {
                // At end of playlist with repeat all - go back to first track
                // This is handled by the parent component through onNext
                onNext();
              } else {
                setIsPlaying(false);
              }
            }}
            onError={(e) => {
              console.error('Audio playback error:', e);
              console.error('Stream URL:', streamUrl);
              console.error('Audio element:', audioRef.current);
            }}
          />
        ) : (
          <audio ref={audioRef} />
        )}

        {/* Top: Visualizer */}
        {VisualizerComponent}

        {/* Middle: Album Art & Song Info */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 4 }}>
          {(audio.cover_art_url || audio.thumbnail_url) && !imageLoadError ? (
            <Box
              onClick={() => audio.youtube_id && setShowLyrics(!showLyrics)}
              sx={{
                width: 200,
                height: 200,
                borderRadius: 3,
                bgcolor: 'background.paper',
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                mb: 3,
                boxShadow: isPlaying 
                  ? '0 8px 32px rgba(19, 236, 106, 0.4), 0 0 60px rgba(19, 236, 106, 0.2)'
                  : (theme) => theme.palette.mode === 'dark' 
                    ? '0 8px 32px rgba(0, 0, 0, 0.4)'
                    : '0 8px 24px rgba(0, 0, 0, 0.1)',
                cursor: audio.youtube_id ? 'pointer' : 'default',
                transition: 'all 0.3s ease',
                position: 'relative',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                animation: isPlaying ? 'album-pulse 2s ease-in-out infinite' : 'none',
                '&:hover': audio.youtube_id ? {
                  transform: 'scale(1.05) rotate(2deg)',
                  boxShadow: (theme) => theme.palette.mode === 'dark'
                    ? '0 12px 40px rgba(19, 236, 106, 0.5)'
                    : `0 12px 40px ${theme.palette.primary.main}40`,
                } : {},
                '&::after': isBuffering ? {
                  content: '""',
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(0, 0, 0, 0.5)',
                  borderRadius: 3,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                } : {},
                '@keyframes album-pulse': {
                  '0%, 100%': { 
                    boxShadow: '0 8px 32px rgba(19, 236, 106, 0.4), 0 0 60px rgba(19, 236, 106, 0.2)',
                  },
                  '50%': { 
                    boxShadow: '0 8px 32px rgba(19, 236, 106, 0.6), 0 0 80px rgba(19, 236, 106, 0.4)',
                  },
                },
              }}
              title={audio.youtube_id ? 'Click to toggle lyrics' : 'Lyrics not available for local files'}
            >
              {/* Hidden img to detect load errors */}
              <img 
                src={audio.cover_art_url || audio.thumbnail_url}
                alt=""
                style={{ 
                  width: '100%', 
                  height: '100%', 
                  objectFit: 'cover',
                  position: 'absolute',
                  inset: 0,
                }}
                onError={() => setImageLoadError(true)}
              />
              {isBuffering && (
                <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
                  <CircularProgress size={48} sx={{ color: 'primary.main' }} />
                </Box>
              )}
            </Box>
          ) : (
            /* Fallback album art - show music icon */
            <Box
              onClick={() => audio.youtube_id && setShowLyrics(!showLyrics)}
              sx={{
                width: 200,
                height: 200,
                borderRadius: 3,
                mb: 3,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: 'rgba(19, 236, 106, 0.1)',
                border: '2px solid',
                borderColor: 'primary.main',
                cursor: audio.youtube_id ? 'pointer' : 'default',
                boxShadow: isPlaying 
                  ? '0 8px 32px rgba(19, 236, 106, 0.4), 0 0 60px rgba(19, 236, 106, 0.2)'
                  : '0 8px 32px rgba(0, 0, 0, 0.4)',
                animation: isPlaying ? 'album-pulse 2s ease-in-out infinite' : 'none',
                transition: 'all 0.3s ease',
                '&:hover': audio.youtube_id ? {
                  transform: 'scale(1.05)',
                  bgcolor: 'rgba(19, 236, 106, 0.2)',
                } : {},
                '@keyframes album-pulse': {
                  '0%, 100%': { 
                    boxShadow: '0 8px 32px rgba(19, 236, 106, 0.4), 0 0 60px rgba(19, 236, 106, 0.2)',
                  },
                  '50%': { 
                    boxShadow: '0 8px 32px rgba(19, 236, 106, 0.6), 0 0 80px rgba(19, 236, 106, 0.4)',
                  },
                },
              }}
              title={audio.youtube_id ? 'Click to toggle lyrics' : 'Lyrics not available for local files'}
            >
              <MusicNoteIcon sx={{ fontSize: 80, color: 'primary.main', opacity: 0.7 }} />
            </Box>
          )}
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5, textAlign: 'center', px: 2, color: 'text.primary' }}>
            {audio.title}
          </Typography>
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
              <Tooltip title="Playing from cache">
                <CachedIcon sx={{ fontSize: 16, color: 'success.main' }} />
              </Tooltip>
            )}
          </Box>
          {/* Track Actions & Related Tracks & Metadata Buttons */}
          <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
            <Tooltip title="Track options">
              <IconButton
                onClick={(e) => setTrackActionsMenuAnchor(e.currentTarget)}
                sx={{
                  color: 'text.secondary',
                  transition: 'all 0.2s ease',
                  '&:hover': {
                    transform: 'scale(1.1)',
                    color: 'primary.main',
                  },
                }}
              >
                <MoreVertIcon />
              </IconButton>
            </Tooltip>
            {/* Track Actions Menu */}
            <Menu
              anchorEl={trackActionsMenuAnchor}
              open={Boolean(trackActionsMenuAnchor)}
              onClose={() => setTrackActionsMenuAnchor(null)}
            >
              <MenuItem onClick={() => { setShowAddToPlaylistDialog(true); setTrackActionsMenuAnchor(null); }}>
                <ListItemIcon>
                  <PlaylistAddIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>Add to Playlist</ListItemText>
              </MenuItem>
              <MenuItem onClick={() => { handleFavoriteToggle(); setTrackActionsMenuAnchor(null); }}>
                <ListItemIcon>
                  {isFavorite ? <FavoriteIcon fontSize="small" sx={{ color: 'error.main' }} /> : <FavoriteBorderIcon fontSize="small" />}
                </ListItemIcon>
                <ListItemText>{isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}</ListItemText>
              </MenuItem>
              {audio.youtube_id && (
                <>
                  <Divider />
                  <MenuItem onClick={() => { setShowDownloadDialog(true); setTrackActionsMenuAnchor(null); }}>
                    <ListItemIcon>
                      <DownloadIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>Export Track</ListItemText>
                  </MenuItem>
                  <MenuItem onClick={() => { setShowMetadataEditor(true); setTrackActionsMenuAnchor(null); }}>
                    <ListItemIcon>
                      <EditIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>Edit Metadata</ListItemText>
                  </MenuItem>
                </>
              )}
            </Menu>
            {audio.youtube_id && onTrackSelect && (
              <Tooltip title="Related tracks">
                <IconButton
                  onClick={() => setShowRelatedTracks(!showRelatedTracks)}
                  sx={{
                    color: showRelatedTracks ? 'primary.main' : 'text.secondary',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      transform: 'scale(1.1)',
                      color: 'primary.main',
                    },
                  }}
                >
                  <AutoAwesomeIcon />
                </IconButton>
              </Tooltip>
            )}
            {audio.youtube_id && !radioActive && (
              <Tooltip title="Start Radio">
                <IconButton
                  onClick={(e) => setRadioMenuAnchor(e.currentTarget)}
                  sx={{
                    color: 'text.secondary',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      transform: 'scale(1.1)',
                      color: 'secondary.main',
                    },
                  }}
                >
                  <RadioIcon />
                </IconButton>
              </Tooltip>
            )}
            {radioActive && (
              <Tooltip title="Click to stop radio">
                <Chip
                  icon={<RadioIcon sx={{ fontSize: 16 }} />}
                  label="RADIO"
                  size="small"
                  color="secondary"
                  onClick={() => stopRadio()}
                  sx={{
                    cursor: 'pointer',
                    animation: 'pulse 2s ease-in-out infinite',
                    '@keyframes pulse': {
                      '0%, 100%': { opacity: 1 },
                      '50%': { opacity: 0.7 },
                    },
                    '&:hover': {
                      opacity: 0.8,
                    },
                  }}
                />
              </Tooltip>
            )}
            {/* Sleep Timer Button */}
            <Tooltip title={sleepTimerState.isActive ? 'Sleep timer active' : 'Sleep timer'}>
              <IconButton
                onClick={() => setShowSleepTimerDialog(true)}
                sx={{
                  color: sleepTimerState.isActive ? 'warning.main' : 'text.secondary',
                  transition: 'all 0.2s ease',
                  position: 'relative',
                  '&:hover': {
                    transform: 'scale(1.1)',
                    color: 'warning.main',
                  },
                }}
              >
                <BedtimeIcon />
                {sleepTimerState.isActive && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      bgcolor: 'warning.main',
                      animation: 'pulse 2s ease-in-out infinite',
                    }}
                  />
                )}
              </IconButton>
            </Tooltip>
            {/* Queue Button */}
            <Tooltip title={`Queue (${queue.length} tracks)`}>
              <IconButton
                onClick={() => setShowQueueDrawer(true)}
                sx={{
                  color: queue.length > 1 ? 'primary.main' : 'text.secondary',
                  transition: 'all 0.2s ease',
                  position: 'relative',
                  '&:hover': {
                    transform: 'scale(1.1)',
                    color: 'primary.main',
                  },
                }}
              >
                <QueueMusicIcon />
                {queue.length > 1 && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 2,
                      right: 2,
                      minWidth: 16,
                      height: 16,
                      borderRadius: '50%',
                      bgcolor: 'primary.main',
                      color: 'primary.contrastText',
                      fontSize: 10,
                      fontWeight: 'bold',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {queue.length > 99 ? '99+' : queue.length}
                  </Box>
                )}
              </IconButton>
            </Tooltip>
            {/* Equalizer Button */}
            <Tooltip title={eqEnabled ? 'Equalizer (on)' : 'Equalizer'}>
              <IconButton
                onClick={() => setShowEqualizerDialog(true)}
                sx={{
                  color: eqEnabled ? 'secondary.main' : 'text.secondary',
                  transition: 'all 0.2s ease',
                  '&:hover': {
                    transform: 'scale(1.1)',
                    color: 'secondary.main',
                  },
                }}
              >
                <EqualizerIcon />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* Bottom: Player Controls */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Waveform Progress Bar */}
          <WaveformSeekBar
            audioElement={audioRef.current}
            currentTime={currentTime}
            duration={audio.duration}
            onSeek={(time) => handleSeekChange(null, time)}
            onSeekCommitted={(time) => handleSeekCommitted(null, time)}
            streamUrl={streamUrl}
          />

          {/* Buttons */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1 }}>
            <Box sx={{ position: 'relative' }}>
              <IconButton
                size="small"
                onClick={handleShuffleToggle}
                sx={{
                  color: shuffleEnabled ? 'primary.main' : 'text.secondary',
                  transition: 'all 0.2s ease',
                  '&:hover': { 
                    color: 'primary.main',
                    transform: 'scale(1.1)',
                  },
                  '&:active': {
                    transform: 'scale(0.95)',
                  },
                }}
              >
                <ShuffleIcon />
              </IconButton>
              {shuffleEnabled && (
                <Box
                  sx={{
                    position: 'absolute',
                    bottom: 8,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 4,
                    height: 4,
                    borderRadius: '50%',
                    bgcolor: 'primary.main',
                    boxShadow: '0 0 4px rgba(19, 236, 106, 0.8)',
                  }}
                />
              )}
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <IconButton
                onClick={onPrevious}
                disabled={!hasPrevious}
                sx={{
                  color: 'text.primary',
                  transition: 'all 0.2s ease',
                  '&:hover': { 
                    color: 'primary.main',
                    transform: 'scale(1.1)',
                  },
                  '&:active': {
                    transform: 'scale(0.95)',
                  },
                  '&:disabled': { color: 'text.disabled' },
                }}
              >
                <SkipPreviousIcon sx={{ fontSize: 30 }} />
              </IconButton>
              <IconButton
                onClick={() => setIsPlaying(!isPlaying)}
                disabled={loadingStream}
                sx={{
                  width: 64,
                  height: 64,
                  bgcolor: 'primary.main',
                  color: 'background.dark',
                  boxShadow: '0 0 20px rgba(19, 236, 106, 0.4)',
                  '&:hover': {
                    bgcolor: 'primary.main',
                    transform: 'scale(1.05)',
                    boxShadow: '0 0 30px rgba(19, 236, 106, 0.6)',
                  },
                  '&:active': {
                    transform: 'scale(0.95)',
                  },
                  '&:disabled': {
                    bgcolor: 'rgba(19, 236, 106, 0.3)',
                    color: 'rgba(0, 0, 0, 0.3)',
                  },
                  transition: 'all 0.2s ease',
                }}
              >
                {loadingStream ? (
                  <CircularProgress size={28} sx={{ color: 'background.dark' }} />
                ) : isPlaying ? (
                  <PauseIcon sx={{ fontSize: 36 }} />
                ) : (
                  <PlayArrowIcon sx={{ fontSize: 36 }} />
                )}
              </IconButton>
              <IconButton
                onClick={onNext}
                disabled={!hasNext}
                sx={{
                  color: 'text.primary',
                  transition: 'all 0.2s ease',
                  '&:hover': { 
                    color: 'primary.main',
                    transform: 'scale(1.1)',
                  },
                  '&:active': {
                    transform: 'scale(0.95)',
                  },
                  '&:disabled': { color: 'text.disabled' },
                }}
              >
                <SkipNextIcon sx={{ fontSize: 30 }} />
              </IconButton>
            </Box>

            <Box sx={{ position: 'relative' }}>
              <IconButton
                size="small"
                onClick={handleRepeatToggle}
                sx={{
                  color: repeatMode !== 'none' ? 'primary.main' : 'text.secondary',
                  transition: 'all 0.2s ease',
                  '&:hover': { 
                    color: 'primary.main',
                    transform: 'scale(1.1)',
                  },
                  '&:active': {
                    transform: 'scale(0.95)',
                  },
                }}
              >
                {repeatMode === 'one' ? <RepeatOneIcon /> : <RepeatIcon />}
              </IconButton>
              {repeatMode !== 'none' && (
                <Box
                  sx={{
                    position: 'absolute',
                    bottom: 8,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 4,
                    height: 4,
                    borderRadius: '50%',
                    bgcolor: 'primary.main',
                    boxShadow: '0 0 4px rgba(19, 236, 106, 0.8)',
                  }}
                />
              )}
            </Box>
          </Box>

          {/* Volume Mini */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, mt: 1 }}>
            <IconButton 
              onClick={toggleMute} 
              size="small" 
              sx={{ 
                color: isMuted ? 'text.disabled' : 'primary.main',
                transition: 'color 0.2s ease',
                '&:hover': {
                  color: 'primary.main',
                }
              }}
            >
              {isMuted || volume === 0 ? <VolumeOffIcon sx={{ fontSize: 20 }} /> : <VolumeUpIcon sx={{ fontSize: 20 }} />}
            </IconButton>
            <Box sx={{ width: 120 }}>
              <Slider
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                min={0}
                max={100}
                size="small"
                sx={{
                  color: 'primary.main',
                  '& .MuiSlider-thumb': { 
                    width: 10, 
                    height: 10,
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      boxShadow: '0 0 0 8px rgba(19, 236, 106, 0.16)',
                    }
                  },
                  '& .MuiSlider-track': { border: 'none', height: 3 },
                  '& .MuiSlider-rail': { 
                    opacity: 0.3,
                    height: 3,
                  },
                }}
              />
            </Box>
            <Typography variant="caption" sx={{ color: 'text.secondary', minWidth: 32, textAlign: 'right', fontWeight: 500 }}>
              {Math.round(isMuted ? 0 : volume)}%
            </Typography>
          </Box>

        </Box>
      </Box>

      {/* Related Tracks Overlay */}
      {showRelatedTracks && audio.youtube_id && onTrackSelect && (
        <Suspense fallback={
          <Box sx={{ 
            position: 'absolute', 
            inset: 0, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            bgcolor: 'rgba(0, 0, 0, 0.95)',
            zIndex: 20,
          }}>
            <CircularProgress size={60} sx={{ color: 'primary.main' }} />
          </Box>
        }>
          <Fade in={showRelatedTracks}>
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                bgcolor: (theme) => theme.palette.mode === 'dark' 
                  ? 'rgba(0, 0, 0, 0.95)' 
                  : 'rgba(255, 255, 255, 0.98)',
                backdropFilter: 'blur(10px)',
                zIndex: 20,
                overflow: 'auto',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2, borderBottom: 1, borderColor: 'divider' }}>
                <Typography variant="h6" sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <AutoAwesomeIcon sx={{ color: 'primary.main' }} />
                  Related Tracks
                </Typography>
                <IconButton onClick={() => setShowRelatedTracks(false)} size="small">
                  <CloseIcon />
                </IconButton>
              </Box>
              <Box sx={{ flex: 1, overflow: 'auto', p: 1 }}>
                <RelatedTracks
                  currentAudio={audio}
                  onTrackSelect={(track) => {
                    setShowRelatedTracks(false);
                    onTrackSelect(track);
                  }}
                  onFavoriteToggle={onFavoriteToggle ? (track) => onFavoriteToggle(track.id, !track.is_favorite) : undefined}
                  compact={true}
                />
              </Box>
            </Box>
          </Fade>
        </Suspense>
      )}

      {/* Lyrics Overlay */}
      {showLyrics && audio.youtube_id && (
        <Fade in={showLyrics}>
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              bgcolor: 'rgba(0, 0, 0, 0.95)',
              backdropFilter: 'blur(10px)',
              zIndex: 20,
              overflow: 'auto',
            }}
          >
            <LyricsPlayer
              youtubeId={audio.youtube_id}
              currentTime={currentTime}
              onClose={() => setShowLyrics(false)}
              embedded={true}
              visualizerTheme={settings.visualizer_theme}
              isLightMode={theme.palette.mode === 'light'}
              onSeek={(time) => {
                if (audioRef.current) {
                  audioRef.current.currentTime = time;
                  setCurrentTime(time);
                }
              }}
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
        onClose={() => setShowQueueDrawer(false)}
        queue={queue}
        currentIndex={currentQueueIndex}
        onPlayTrack={(index) => {
          onPlayQueueTrack?.(index);
          setShowQueueDrawer(false);
        }}
        onRemoveTrack={(index) => onRemoveFromQueue?.(index)}
        onReorderTrack={(from, to) => onQueueReorder?.(from, to)}
        onClearQueue={() => {
          onClearQueue?.();
          setShowQueueDrawer(false);
        }}
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
