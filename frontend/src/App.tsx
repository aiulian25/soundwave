import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
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
import SettingsPage from './pages/SettingsPage';
import LocalFilesPage from './pages/LocalFilesPageNew';
import AdminUsersPage from './pages/AdminUsersPage';
import OfflineManagerPage from './pages/OfflineManagerPage';
import AnalyticsPage from './pages/AnalyticsPage';
import AdminRoute from './components/AdminRoute';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import Player from './components/Player';
import PWAPrompts from './components/PWAPrompts';
import { useSmartShuffle } from './hooks/useSmartShuffle';
import { useIntelligentPrefetch } from './hooks/useIntelligentPrefetch';
import { useSettings } from './context/SettingsContext';
import { offlineStorage } from './utils/offlineStorage';
import { pwaManager } from './utils/pwa';
import type { Audio } from './types';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentAudio, setCurrentAudio] = useState<Audio | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [playerMinimized, setPlayerMinimized] = useState(false);
  const [queue, setQueue] = useState<Audio[]>([]);
  const [currentQueueIndex, setCurrentQueueIndex] = useState(0);
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('lg'));
  
  // Get settings from context (may not be available if not authenticated)
  const settingsContext = (() => {
    try {
      return useSettings();
    } catch {
      return null;
    }
  })();
  
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
    }
  }, []);

  // Auto-play when new audio is set
  useEffect(() => {
    if (currentAudio) {
      setIsPlaying(true);
    }
  }, [currentAudio]);

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

  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
    // Load user settings after login
    if (settingsContext?.loadSettings) {
      settingsContext.loadSettings();
    }
  };

  const handleLogout = async () => {
    try {
      // Call logout endpoint to delete token on server
      await fetch('/api/user/logout/', {
        method: 'POST',
        headers: {
          'Authorization': `Token ${localStorage.getItem('token')}`,
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
    
    // Always clear local storage and redirect to login
    localStorage.removeItem('token');
    setIsAuthenticated(false);
    setCurrentAudio(null);
    setQueue([]);
    setCurrentQueueIndex(0);
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

  const playNext = useCallback(() => {
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
  }, [queue, currentQueueIndex, settingsContext?.settings?.shuffle_enabled, settingsContext?.settings?.smart_shuffle_enabled, settingsContext?.settings?.repeat_mode, smartShuffle]);

  const playPrevious = () => {
    if (queue.length > 0 && currentQueueIndex > 0) {
      const prevIndex = currentQueueIndex - 1;
      setCurrentQueueIndex(prevIndex);
      setCurrentAudio(queue[prevIndex]);
    }
  };

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
            <Route path="/analytics" element={<AnalyticsPage />} />
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
            onClose={() => setCurrentAudio(null)}
            onNext={playNext}
            onPrevious={playPrevious}
            hasNext={queue.length > 1 && (settingsContext?.settings?.shuffle_enabled || settingsContext?.settings?.repeat_mode === 'all' || currentQueueIndex < queue.length - 1)}
            hasPrevious={currentQueueIndex > 0}
            onFavoriteToggle={handlePlayerFavoriteToggle}
            onTrackSelect={handleRelatedTrackSelect}
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
              onClose={() => setCurrentAudio(null)}
              onMinimize={() => setPlayerMinimized(true)}
              onNext={playNext}
              onPrevious={playPrevious}
              hasNext={queue.length > 1 && (settingsContext?.settings?.shuffle_enabled || settingsContext?.settings?.repeat_mode === 'all' || currentQueueIndex < queue.length - 1)}
              hasPrevious={currentQueueIndex > 0}
              onFavoriteToggle={handlePlayerFavoriteToggle}
              onTrackSelect={handleRelatedTrackSelect}
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

      {/* PWA Prompts */}
      <PWAPrompts />
    </Box>
  );
}

export default App;
