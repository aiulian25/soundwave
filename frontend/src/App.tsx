import { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Box, IconButton, Typography, useMediaQuery, useTheme } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import LibraryPage from './pages/LibraryPage';
import SearchPage from './pages/SearchPage';
import FavoritesPage from './pages/FavoritesPage';
import ChannelsPage from './pages/ChannelsPage';
import ChannelDetailPage from './pages/ChannelDetailPage';
import PlaylistsPage from './pages/PlaylistsPage';
import PlaylistDetailPage from './pages/PlaylistDetailPage';
import SmartPlaylistsPage from './pages/SmartPlaylistsPage';
import SmartPlaylistDetailPage from './pages/SmartPlaylistDetailPage';
import SettingsPage from './pages/SettingsPage';
import LocalFilesPage from './pages/LocalFilesPageNew';
import AdminUsersPage from './pages/AdminUsersPage';
import OfflineManagerPage from './pages/OfflineManagerPage';
import AnalyticsPage from './pages/AnalyticsPage';
import AchievementsPage from './pages/AchievementsPage';
import YearlyWrappedPage from './pages/YearlyWrappedPage';
import ListeningHistoryPage from './pages/ListeningHistoryPage';
import AdminRoute from './components/AdminRoute';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import Player from './components/Player';
import PWAPrompts from './components/PWAPrompts';
import ResumePlaybackDialog from './components/ResumePlaybackDialog';
import RadioIndicator from './components/RadioIndicator';
import { useSmartShuffle } from './hooks/useSmartShuffle';
import { useIntelligentPrefetch } from './hooks/useIntelligentPrefetch';
import { useSettings } from './context/SettingsContext';
import { useRadio } from './context/RadioContext';
import { checkPlaybackSession, type PlaybackSession } from './hooks/usePlaybackSync';
import { offlineStorage } from './utils/offlineStorage';
import { pwaManager } from './utils/pwa';
import { audioAPI, playbackSyncAPI } from './api/client';
import type { Audio } from './types';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentAudio, setCurrentAudio] = useState<Audio | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [playerMinimized, setPlayerMinimized] = useState(false);
  const [queue, setQueue] = useState<Audio[]>([]);
  const [currentQueueIndex, setCurrentQueueIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);  // For playback sync
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('lg'));
  const navigate = useNavigate();
  
  // Playback sync state
  const [resumeSession, setResumeSession] = useState<PlaybackSession | null>(null);
  const [showResumeDialog, setShowResumeDialog] = useState(false);
  const lastSyncTimeRef = useRef<number>(0);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // Get settings from context (may not be available if not authenticated)
  const settingsContext = (() => {
    try {
      return useSettings();
    } catch {
      return null;
    }
  })();
  
  // Radio mode hook
  const { isRadioMode, getNextTrack, reportPlayed, reportSkip, stopRadio, setCurrentTrackInfo } = useRadio();
  
  // Update radio context with current track info
  useEffect(() => {
    if (isRadioMode && currentAudio?.youtube_id) {
      setCurrentTrackInfo(currentAudio.youtube_id, currentAudio.duration);
    }
  }, [isRadioMode, currentAudio?.youtube_id, currentAudio?.duration, setCurrentTrackInfo]);
  
  // Smart shuffle hook with settings
  const smartShuffle = useSmartShuffle({
    historySize: settingsContext?.settings?.smart_shuffle_history_size ?? 10,
    enabled: settingsContext?.settings?.smart_shuffle_enabled ?? true,
  });

  // Intelligent prefetch hook for caching upcoming tracks
  const prefetch = useIntelligentPrefetch({
    enabled: settingsContext?.settings?.prefetch_enabled !== false && isAuthenticated,
    queue,
    currentIndex: currentQueueIndex,
    currentAudio,
    isPlaying,
    shuffleEnabled: settingsContext?.settings?.shuffle_enabled ?? false,
  });

  useEffect(() => {
    // Check if user is already logged in
    const token = localStorage.getItem('token');
    if (token) {
      setIsAuthenticated(true);
      // Load user settings on app load if already authenticated
      if (settingsContext?.loadSettings) {
        settingsContext.loadSettings();
      }
      
      // Check for existing playback session from another device (only on page load, not when already playing)
      const checkSession = async () => {
        try {
          const session = await checkPlaybackSession();
          if (session && session.audio_details) {
            console.log('[App] Found existing playback session on page load:', session);
            setResumeSession(session);
            setShowResumeDialog(true);
          }
        } catch (error) {
          console.debug('[App] No playback session to resume');
        }
      };
      checkSession();
    }
    
    // Listen for token expiry events from API client
    const handleTokenExpired = (event: CustomEvent) => {
      console.log('[App] Token expired:', event.detail?.message);
      // Trigger logout to clean up state
      handleLogout();
    };
    
    window.addEventListener('token-expired', handleTokenExpired as EventListener);
    
    return () => {
      window.removeEventListener('token-expired', handleTokenExpired as EventListener);
    };
  }, []);

  // Auto-play when new audio is set
  useEffect(() => {
    if (currentAudio) {
      setIsPlaying(true);
    }
  }, [currentAudio]);

  // Cross-device playback sync - periodically save playback state
  useEffect(() => {
    if (!isAuthenticated || !currentAudio?.youtube_id) {
      // Clear sync interval if no audio
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
      }
      return;
    }

    // Get device info
    const getDeviceId = () => {
      let deviceId = localStorage.getItem('soundwave_device_id');
      if (!deviceId) {
        deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
        localStorage.setItem('soundwave_device_id', deviceId);
      }
      return deviceId;
    };

    const getDeviceName = () => {
      const ua = navigator.userAgent;
      if (/iPhone/i.test(ua)) return 'iPhone';
      if (/iPad/i.test(ua)) return 'iPad';
      if (/Android/i.test(ua)) return 'Android';
      if (/Mac/i.test(ua)) return 'Mac';
      if (/Windows/i.test(ua)) return 'Windows';
      if (/Linux/i.test(ua)) return 'Linux';
      return 'Web Browser';
    };

    // Sync function
    const syncPlayback = async () => {
      if (!currentAudio?.youtube_id) return;
      
      try {
        await playbackSyncAPI.syncPlayback({
          youtube_id: currentAudio.youtube_id,
          position: currentTime,
          duration: currentAudio.duration,
          is_playing: isPlaying,
          volume: settingsContext?.settings?.volume ?? 100,
          queue_youtube_ids: queue.map(a => a.youtube_id).filter(Boolean) as string[],
          queue_index: currentQueueIndex,
          device_id: getDeviceId(),
          device_name: getDeviceName(),
        });
        lastSyncTimeRef.current = Date.now();
      } catch (error) {
        // Silently fail - sync is best-effort
        console.debug('[PlaybackSync] Sync failed:', error);
      }
    };

    // Sync immediately when track changes
    syncPlayback();

    // Set up periodic sync (every 30 seconds while playing) - reduced from 15s for better performance
    syncIntervalRef.current = setInterval(() => {
      if (isPlaying) {
        syncPlayback();
      }
    }, 30000);

    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
      }
    };
  }, [isAuthenticated, currentAudio?.youtube_id, currentAudio?.duration, isPlaying, currentTime, queue, currentQueueIndex, settingsContext?.settings?.volume]);

  // Sync when pausing (important for resume)
  useEffect(() => {
    if (!isAuthenticated || !currentAudio?.youtube_id) return;

    // When pausing, sync after a short delay (non-blocking)
    if (!isPlaying && currentTime > 0 && currentAudio?.youtube_id) {
      // Debounce pause sync - only sync if still paused after 1 second
      const youtubeId = currentAudio.youtube_id; // Capture for closure
      const timeoutId = setTimeout(() => {
        const getDeviceId = () => localStorage.getItem('soundwave_device_id') || 'unknown';
        const getDeviceName = () => {
          const ua = navigator.userAgent;
          if (/iPhone|iPad/i.test(ua)) return 'iOS';
          if (/Android/i.test(ua)) return 'Android';
          if (/Mac/i.test(ua)) return 'Mac';
          if (/Windows/i.test(ua)) return 'Windows';
          return 'Web';
        };

        playbackSyncAPI.syncPlayback({
          youtube_id: youtubeId,
          position: currentTime,
          duration: currentAudio.duration,
          is_playing: false,
          volume: settingsContext?.settings?.volume ?? 100,
          queue_youtube_ids: queue.map(a => a.youtube_id).filter(Boolean) as string[],
          queue_index: currentQueueIndex,
          device_id: getDeviceId(),
          device_name: getDeviceName(),
        }).catch(() => {});
      }, 1000);
      
      return () => clearTimeout(timeoutId);
    }
  }, [isPlaying]);

  // Update current time from Player (via callback)
  const handleTimeUpdate = useCallback((time: number) => {
    setCurrentTime(time);
  }, []);

  // Handle favorite toggle from player
  const handlePlayerFavoriteToggle = (audioId: number, isFavorite: boolean) => {
    if (currentAudio && currentAudio.id === audioId) {
      setCurrentAudio({
        ...currentAudio,
        is_favorite: isFavorite
      });
    }
  };

  // Handle track selection from related tracks
  const handleRelatedTrackSelect = (audio: Audio) => {
    setCurrentAudio(audio);
    setIsPlaying(true);
  };

  const handleLoginSuccess = async () => {
    setIsAuthenticated(true);
    // Load user settings after login
    if (settingsContext?.loadSettings) {
      settingsContext.loadSettings();
    }
    
    // Check for existing playback session from another device
    try {
      const session = await checkPlaybackSession();
      if (session && session.audio_details) {
        console.log('[App] Found existing playback session:', session);
        setResumeSession(session);
        setShowResumeDialog(true);
      }
    } catch (error) {
      console.debug('[App] No playback session to resume');
    }
  };

  // Handle resume playback from another device
  const handleResumePlayback = async () => {
    if (!resumeSession?.audio_details) return;
    
    try {
      // Fetch the full audio object
      const response = await audioAPI.get(resumeSession.youtube_id);
      const audio = response.data;
      
      if (audio) {
        // Calculate resume position (5 seconds before last position)
        const resumePosition = Math.max(0, resumeSession.position - 5);
        
        // Set up the queue if available
        if (resumeSession.queue_youtube_ids?.length > 0) {
          // Try to restore queue - fetch audio details for queue items
          try {
            const queueResponse = await audioAPI.list({ 
              youtube_ids: resumeSession.queue_youtube_ids.join(','),
              page_size: 100 
            });
            const queueTracks = queueResponse.data?.data || queueResponse.data || [];
            if (queueTracks.length > 0) {
              setQueue(queueTracks);
              setCurrentQueueIndex(resumeSession.queue_index);
            } else {
              setQueue([audio]);
              setCurrentQueueIndex(0);
            }
          } catch {
            setQueue([audio]);
            setCurrentQueueIndex(0);
          }
        } else {
          setQueue([audio]);
          setCurrentQueueIndex(0);
        }
        
        // Set the audio with initial seek position
        setCurrentAudio({ ...audio, _initialSeek: resumePosition } as Audio & { _initialSeek: number });
        setIsPlaying(true);
      }
    } catch (error) {
      console.error('[App] Failed to resume playback:', error);
    }
    
    setShowResumeDialog(false);
    setResumeSession(null);
  };

  const handleDismissResume = () => {
    setShowResumeDialog(false);
    setResumeSession(null);
    // Clear the session on server since user dismissed it
    playbackSyncAPI.clearSession().catch(() => {});
  };

  const handleLogout = async () => {
    // Clear local storage first to prevent any API calls with old token
    localStorage.removeItem('token');
    
    try {
      // Call logout endpoint to delete token on server
      await fetch('/api/user/logout/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      console.error('Logout error:', error);
    }
    
    // Clear offline data (IndexedDB playlists, favorites, etc.)
    try {
      await offlineStorage.clearAllData();
      console.log('[Logout] Cleared IndexedDB offline data');
    } catch (error) {
      console.error('Failed to clear offline data:', error);
    }
    
    // Clear Service Worker caches (audio files, API responses)
    try {
      await pwaManager.clearCache();
      console.log('[Logout] Cleared Service Worker caches');
    } catch (error) {
      console.error('Failed to clear SW cache:', error);
    }
    
    // Clear all session cookies
    document.cookie.split(";").forEach((c) => {
      document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
    });
    
    // Reset all state
    setCurrentAudio(null);
    setQueue([]);
    setCurrentQueueIndex(0);
    setIsPlaying(false);
    setPlayerMinimized(false);
    setMobileDrawerOpen(false);
    
    // Navigate to root and set authenticated to false
    navigate('/', { replace: true });
    setIsAuthenticated(false);
  };

  const toggleMobileDrawer = () => {
    setMobileDrawerOpen(!mobileDrawerOpen);
  };

  // Add current track to play history when it starts playing
  useEffect(() => {
    if (currentAudio && isPlaying) {
      smartShuffle.addToHistory(currentAudio.id);
    }
  }, [currentAudio?.id, isPlaying]);

  const playNext = useCallback(async () => {
    // Radio mode - get next track from radio
    if (isRadioMode) {
      try {
        // Report current track as played (not skipped) when auto-advancing
        if (currentAudio) {
          await reportPlayed();
        }
        
        const result = await getNextTrack();
        if (result) {
          setCurrentAudio(result as Audio);
          setQueue(prev => [...prev, result as Audio]);
          setCurrentQueueIndex(prev => prev + 1);
          return;
        }
      } catch (error) {
        console.error('[Radio] Failed to get next track:', error);
        // Fall through to regular playback if radio fails
      }
    }
    
    if (queue.length === 0) return;
    
    const shuffleEnabled = settingsContext?.settings?.shuffle_enabled ?? false;
    const smartShuffleEnabled = settingsContext?.settings?.smart_shuffle_enabled ?? true;
    const repeatMode = settingsContext?.settings?.repeat_mode ?? 'none';
    
    // Smart shuffle mode
    if (shuffleEnabled && smartShuffleEnabled) {
      const result = smartShuffle.getSmartShuffledNext(queue, currentQueueIndex);
      if (result) {
        setCurrentQueueIndex(result.index);
        setCurrentAudio(result.audio);
        return;
      }
    }
    
    // Regular shuffle (random)
    if (shuffleEnabled && !smartShuffleEnabled) {
      const availableIndices = queue
        .map((_, i) => i)
        .filter(i => i !== currentQueueIndex);
      if (availableIndices.length > 0) {
        const randomIdx = availableIndices[Math.floor(Math.random() * availableIndices.length)];
        setCurrentQueueIndex(randomIdx);
        setCurrentAudio(queue[randomIdx]);
        return;
      }
    }
    
    // Normal sequential playback
    if (currentQueueIndex < queue.length - 1) {
      const nextIndex = currentQueueIndex + 1;
      setCurrentQueueIndex(nextIndex);
      setCurrentAudio(queue[nextIndex]);
    } else if (repeatMode === 'all') {
      // At end of queue with repeat all - wrap to beginning
      setCurrentQueueIndex(0);
      setCurrentAudio(queue[0]);
    }
  }, [queue, currentQueueIndex, settingsContext?.settings?.shuffle_enabled, settingsContext?.settings?.smart_shuffle_enabled, settingsContext?.settings?.repeat_mode, smartShuffle, isRadioMode, getNextTrack, reportPlayed, currentAudio]);

  const playPrevious = () => {
    if (queue.length > 0 && currentQueueIndex > 0) {
      const prevIndex = currentQueueIndex - 1;
      setCurrentQueueIndex(prevIndex);
      setCurrentAudio(queue[prevIndex]);
    }
  };

  // Skip handler - reports skip to radio for learning
  const handleSkip = useCallback(async () => {
    if (isRadioMode) {
      // Report the skip before moving to next track
      await reportSkip();
    }
    // Then play the next track
    await playNext();
  }, [isRadioMode, reportSkip, playNext]);

  const setAudioWithQueue = (audio: Audio, audioQueue?: Audio[]) => {
    setCurrentAudio(audio);
    if (audioQueue && audioQueue.length > 0) {
      setQueue(audioQueue);
      const index = audioQueue.findIndex(a => a.id === audio.id);
      setCurrentQueueIndex(index >= 0 ? index : 0);
    } else {
      // Single audio, no queue
      setQueue([audio]);
      setCurrentQueueIndex(0);
    }
  };

  // Queue management handlers
  const handleQueueReorder = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    
    setQueue(prev => {
      const newQueue = [...prev];
      const [removed] = newQueue.splice(fromIndex, 1);
      newQueue.splice(toIndex, 0, removed);
      return newQueue;
    });
    
    // Update current index if affected
    setCurrentQueueIndex(prev => {
      if (fromIndex === prev) {
        return toIndex;
      } else if (fromIndex < prev && toIndex >= prev) {
        return prev - 1;
      } else if (fromIndex > prev && toIndex <= prev) {
        return prev + 1;
      }
      return prev;
    });
  }, []);

  const handleRemoveFromQueue = useCallback((index: number) => {
    if (index === currentQueueIndex) return;  // Can't remove currently playing
    
    setQueue(prev => {
      const newQueue = [...prev];
      newQueue.splice(index, 1);
      return newQueue;
    });
    
    // Update current index if needed
    setCurrentQueueIndex(prev => {
      if (index < prev) {
        return prev - 1;
      }
      return prev;
    });
  }, [currentQueueIndex]);

  const handlePlayQueueTrack = useCallback((index: number) => {
    if (index >= 0 && index < queue.length) {
      setCurrentQueueIndex(index);
      setCurrentAudio(queue[index]);
    }
  }, [queue]);

  const handleClearQueue = useCallback(() => {
    // Keep only the current track
    if (currentAudio) {
      setQueue([currentAudio]);
      setCurrentQueueIndex(0);
    }
  }, [currentAudio]);

  // Add track to play next (after current)
  const addToPlayNext = useCallback((track: Audio) => {
    setQueue(prev => {
      // Remove if already in queue (except current)
      const existingIndex = prev.findIndex(t => t.id === track.id);
      const newQueue = [...prev];
      
      if (existingIndex !== -1 && existingIndex !== currentQueueIndex) {
        newQueue.splice(existingIndex, 1);
        const adjustedInsertIndex = existingIndex < currentQueueIndex + 1 
          ? currentQueueIndex 
          : currentQueueIndex + 1;
        newQueue.splice(adjustedInsertIndex, 0, track);
      } else if (existingIndex === -1) {
        newQueue.splice(currentQueueIndex + 1, 0, track);
      }
      
      return newQueue;
    });
  }, [currentQueueIndex]);

  // Add track to end of queue
  const addToQueueEnd = useCallback((track: Audio) => {
    setQueue(prev => {
      if (prev.some(t => t.id === track.id)) {
        return prev;  // Don't add duplicates
      }
      return [...prev, track];
    });
  }, []);

  if (!isAuthenticated) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <Box sx={{ display: 'flex', height: '100vh', backgroundColor: 'background.default' }}>
      {/* Sidebar - Desktop Permanent, Mobile Drawer */}
      <Sidebar mobileOpen={mobileDrawerOpen} onMobileClose={() => setMobileDrawerOpen(false)} />

      {/* Main Content */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
        {/* Top Gradient Fade */}
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '96px',
            background: (theme) =>
              `linear-gradient(to bottom, ${theme.palette.background.default} 0%, transparent 100%)`,
            zIndex: 10,
            pointerEvents: 'none',
          }}
        />
        
        {/* Top Bar */}
        <TopBar onLogout={handleLogout} onMenuClick={toggleMobileDrawer} />

        {/* Radio Indicator - Shows when radio mode is active */}
        {isRadioMode && (
          <Box sx={{ px: 4, pt: 1 }}>
            <RadioIndicator />
          </Box>
        )}

        {/* Page Content */}
        <Box
          sx={{
            flex: 1,
            overflow: 'auto',
            px: 4,
            py: 2,
            pb: 3,
            '&::-webkit-scrollbar': {
              display: 'none',
            },
            msOverflowStyle: 'none',
            scrollbarWidth: 'none',
          }}
        >
          <Routes>
            <Route path="/" element={<HomePage setCurrentAudio={setAudioWithQueue} />} />
            <Route path="/search" element={<SearchPage setCurrentAudio={setAudioWithQueue} />} />
            <Route path="/library" element={<LibraryPage setCurrentAudio={setAudioWithQueue} />} />
            <Route path="/favorites" element={<FavoritesPage setCurrentAudio={setAudioWithQueue} />} />
            <Route path="/channels" element={<ChannelsPage />} />
            <Route path="/channels/:channelId" element={<ChannelDetailPage setCurrentAudio={setAudioWithQueue} />} />
            <Route path="/playlists" element={<PlaylistsPage />} />
            <Route path="/playlists/:playlistId" element={<PlaylistDetailPage setCurrentAudio={setAudioWithQueue} />} />
            <Route path="/smart-playlists" element={<SmartPlaylistsPage setCurrentAudio={setAudioWithQueue} />} />
            <Route path="/smart-playlist/:playlistId" element={<SmartPlaylistDetailPage setCurrentAudio={setAudioWithQueue} />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/achievements" element={<AchievementsPage />} />
            <Route path="/wrapped" element={<YearlyWrappedPage />} />
            <Route path="/history" element={<ListeningHistoryPage onTrackSelect={setAudioWithQueue} />} />
            <Route path="/local-files" element={<LocalFilesPage setCurrentAudio={setAudioWithQueue} />} />
            <Route path="/offline" element={<OfflineManagerPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/admin/users" element={<AdminRoute><AdminUsersPage /></AdminRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Box>
      </Box>

      {/* Right Side Player - Desktop Only (Like Reference Design) */}
      {currentAudio && isDesktop && (
        <Box
          sx={{
            width: 380,
            display: 'flex',
            flexDirection: 'column',
            bgcolor: 'background.paper',
            borderLeft: '1px solid',
            borderColor: 'rgba(255, 255, 255, 0.05)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <Player 
            audio={currentAudio} 
            isPlaying={isPlaying} 
            setIsPlaying={setIsPlaying} 
            onClose={() => {
              setCurrentAudio(null);
              if (isRadioMode) stopRadio();
            }}
            onNext={handleSkip}
            onPrevious={playPrevious}
            hasNext={isRadioMode || queue.length > 1 && (settingsContext?.settings?.shuffle_enabled || settingsContext?.settings?.repeat_mode === 'all' || currentQueueIndex < queue.length - 1)}
            hasPrevious={currentQueueIndex > 0}
            onFavoriteToggle={handlePlayerFavoriteToggle}
            onTrackSelect={handleRelatedTrackSelect}
            onTimeUpdate={handleTimeUpdate}
            initialSeek={(currentAudio as any)._initialSeek}
            isRadioMode={isRadioMode}
            queue={queue}
            currentQueueIndex={currentQueueIndex}
            onQueueReorder={handleQueueReorder}
            onRemoveFromQueue={handleRemoveFromQueue}
            onPlayQueueTrack={handlePlayQueueTrack}
            onClearQueue={handleClearQueue}
          />
        </Box>
      )}

      {/* Bottom Player - Mobile/Tablet Only */}
      {currentAudio && !isDesktop && (
        <>
          {/* Backdrop - Click outside to minimize */}
          {!playerMinimized && (
            <Box
              onClick={() => setPlayerMinimized(true)}
              sx={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                bgcolor: 'rgba(0, 0, 0, 0.5)',
                zIndex: 999,
                backdropFilter: 'blur(4px)',
              }}
            />
          )}
          
          {/* Full Player - Hidden when minimized but still mounted */}
          <Box
            sx={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 1000,
              maxHeight: '85vh',
              overflowY: 'auto',
              transform: playerMinimized ? 'translateY(100%)' : 'translateY(0)',
              transition: 'transform 0.3s ease-in-out',
              visibility: playerMinimized ? 'hidden' : 'visible',
            }}
          >
            <Player 
              audio={currentAudio} 
              isPlaying={isPlaying} 
              setIsPlaying={setIsPlaying} 
              onClose={() => {
                setCurrentAudio(null);
                if (isRadioMode) stopRadio();
              }}
              onMinimize={() => setPlayerMinimized(true)}
              onNext={handleSkip}
              onPrevious={playPrevious}
              hasNext={isRadioMode || queue.length > 1 && (settingsContext?.settings?.shuffle_enabled || settingsContext?.settings?.repeat_mode === 'all' || currentQueueIndex < queue.length - 1)}
              hasPrevious={currentQueueIndex > 0}
              onFavoriteToggle={handlePlayerFavoriteToggle}
              onTrackSelect={handleRelatedTrackSelect}
              onTimeUpdate={handleTimeUpdate}
              initialSeek={(currentAudio as any)._initialSeek}
              isRadioMode={isRadioMode}
              queue={queue}
              currentQueueIndex={currentQueueIndex}
              onQueueReorder={handleQueueReorder}
              onRemoveFromQueue={handleRemoveFromQueue}
              onPlayQueueTrack={handlePlayQueueTrack}
              onClearQueue={handleClearQueue}
            />
          </Box>

          {/* Minimized Player Bar */}
          {playerMinimized && (
            <Box
              onClick={() => setPlayerMinimized(false)}
              sx={{
                display: { xs: 'flex', lg: 'none' },
                position: 'fixed',
                bottom: 0,
                left: 0,
                right: 0,
                height: 72,
                bgcolor: 'background.paper',
                borderTop: '1px solid',
                borderColor: 'rgba(255, 255, 255, 0.1)',
                alignItems: 'center',
                px: 2,
                gap: 2,
                zIndex: 1000,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                '&:active': {
                  bgcolor: 'rgba(255, 255, 255, 0.05)',
                },
              }}
            >
              {/* Album Art */}
              <Box
                component="img"
                src={currentAudio.cover_art_url || '/img/icons/icon-192x192.png'}
                alt={currentAudio.title}
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: 1,
                  objectFit: 'cover',
                  flexShrink: 0,
                }}
              />
              
              {/* Track Info */}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography 
                  variant="body2" 
                  sx={{ 
                    fontWeight: 600, 
                    color: 'text.primary',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {currentAudio.title}
                </Typography>
                <Typography 
                  variant="caption" 
                  sx={{ 
                    color: 'text.secondary',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    display: 'block',
                  }}
                >
                  {currentAudio.artist || 'Unknown Artist'}
                </Typography>
              </Box>

              {/* Play/Pause Button */}
              <IconButton
                onClick={(e) => {
                  e.stopPropagation();
                  setIsPlaying(!isPlaying);
                }}
                sx={{
                  bgcolor: 'primary.main',
                  color: 'background.dark',
                  width: 40,
                  height: 40,
                  flexShrink: 0,
                  '&:hover': {
                    bgcolor: 'primary.main',
                    transform: 'scale(1.05)',
                  },
                }}
              >
                {isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
              </IconButton>
            </Box>
          )}
        </>
      )}

      {/* Resume Playback Dialog - Shows when user has an active session from another device */}
      <ResumePlaybackDialog
        open={showResumeDialog}
        session={resumeSession}
        onResume={handleResumePlayback}
        onDismiss={handleDismissResume}
      />

      {/* PWA Prompts */}
      <PWAPrompts />
    </Box>
  );
}

export default App;
