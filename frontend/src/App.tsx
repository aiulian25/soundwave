import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { ButtonBase, Box, IconButton, Snackbar, Typography, useMediaQuery, useTheme } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import LoginPage from './pages/LoginPage';
import ForcePasswordChangePage from './pages/ForcePasswordChangePage';
import ConfirmEmailPage from './pages/ConfirmEmailPage';
import HomePage from './pages/HomePage';
import LibraryPage from './pages/LibraryPage';
import SearchPage from './pages/SearchPage';
import FavoritesPage from './pages/FavoritesPage';
// Rare / heavy routes are code-split so they stay out of the first-paint bundle.
const ChannelsPage = lazy(() => import('./pages/ChannelsPage'));
const ChannelDetailPage = lazy(() => import('./pages/ChannelDetailPage'));
const PlaylistsPage = lazy(() => import('./pages/PlaylistsPage'));
const PlaylistDetailPage = lazy(() => import('./pages/PlaylistDetailPage'));
const SmartPlaylistsPage = lazy(() => import('./pages/SmartPlaylistsPage'));
const SmartPlaylistDetailPage = lazy(() => import('./pages/SmartPlaylistDetailPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const LocalFilesPage = lazy(() => import('./pages/LocalFilesPageNew'));
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage'));
const OfflineManagerPage = lazy(() => import('./pages/OfflineManagerPage'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const AchievementsPage = lazy(() => import('./pages/AchievementsPage'));
const YearlyWrappedPage = lazy(() => import('./pages/YearlyWrappedPage'));
const ListeningHistoryPage = lazy(() => import('./pages/ListeningHistoryPage'));
import AdminRoute from './components/AdminRoute';
import LazyRouteBoundary from './components/LazyRouteBoundary';
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
import { NowPlayingProvider, getTrackKey } from './context/NowPlayingContext';
import { AddMusicProvider, SharedLinkRoute } from './context/AddMusicContext';
import { checkPlaybackSession, deviceId, loadResumedQueue, usePlaybackSyncWriter, useRemotePlayback, type PlaybackSession } from './hooks/usePlaybackSync';
import RemotePlaybackBanner from './components/RemotePlaybackBanner';
import StatsTabs from './components/StatsTabs';
import BottomNav, { BOTTOM_NAV_OFFSET } from './components/BottomNav';
import ConfirmDialog from './components/ConfirmDialog';
import { audioCache } from './utils/audioCache';
import { useTranslation } from 'react-i18next';
import { claimBrowserData, clearAccountData, watchDataOwner } from './utils/accountData';
import { flushListeningEvents } from './utils/listeningOutbox';
import { audioAPI, playbackSyncAPI, userAPI, ensureCsrfCookie, setAuthEventsEnabled } from './api/client';
import type { Audio } from './types';

const UNAVAILABLE_NOTICE_MS = 6000;
// One broken file should not end a listening session, but a dead connection should not skip
// through a whole queue either.
const MAX_CONSECUTIVE_PLAYBACK_FAILURES = 3;
// Resuming starts a little early, so the listener hears where they were.
const RESUME_REWIND_SECONDS = 5;

function App() {
  const { t } = useTranslation();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [currentAudio, setCurrentAudio] = useState<Audio | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [playerMinimized, setPlayerMinimized] = useState(false);
  const [queue, setQueue] = useState<Audio[]>([]);
  const [currentQueueIndex, setCurrentQueueIndex] = useState(0);
  // Playback position for the sync effects below. A ref, not state: the position
  // changes several times a second and nothing in App's render output uses it.
  const currentTimeRef = useRef(0);
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('lg'));
  const navigate = useNavigate();
  
  // Playback sync state
  const [resumeSession, setResumeSession] = useState<PlaybackSession | null>(null);
  const [showResumeDialog, setShowResumeDialog] = useState(false);
  const [unavailableOnResume, setUnavailableOnResume] = useState(0);
  const [playbackNotice, setPlaybackNotice] = useState('');
  const [offlineTracksAtLogout, setOfflineTracksAtLogout] = useState(0);
  const consecutivePlaybackFailures = useRef(0);
  
  const settingsContext = useSettings();
  
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
  useIntelligentPrefetch({
    enabled: settingsContext?.settings?.prefetch_enabled !== false && isAuthenticated,
    queue,
    currentIndex: currentQueueIndex,
    currentAudio,
    isPlaying,
    shuffleEnabled: settingsContext?.settings?.shuffle_enabled ?? false,
  });

  // The account's settings first: a session is only read when sync is allowed.
  const offerResumeIfAllowed = async () => {
    const loaded = await settingsContext?.loadSettings();
    if (!loaded?.playback_sync_enabled) return;

    const session = await checkPlaybackSession();
    // Still playing on another device: the "Playing on …" bar offers that instead.
    const playingElsewhere = session?.is_live && session.device_id !== deviceId();
    if (session?.audio_details && !playingElsewhere) {
      setResumeSession(session);
      setShowResumeDialog(true);
    }
  };

  useEffect(() => {
    const bootstrapAuth = async () => {
      try {
        await ensureCsrfCookie();
        const accountRes = await userAPI.account();
        await claimBrowserData(accountRes.data.id, { adoptUnknown: true });
        setAccountId(accountRes.data.id);
        setIsAuthenticated(true);
        setAuthEventsEnabled(true);

        // APP-01: if the account still requires a password change, gate the app
        // and skip the rest of the post-auth bootstrap until it's resolved.
        if (accountRes.data?.password_change_required) {
          setMustChangePassword(true);
          return;
        }

        await offerResumeIfAllowed();
      } catch {
        setIsAuthenticated(false);
        setAuthEventsEnabled(false);
      }
    };

    bootstrapAuth();
    
    // Listen for token expiry events from API client
    const handleAuthRequired = (event: CustomEvent) => {
      console.log('[App] Auth required:', event.detail?.message);
      // Trigger logout to clean up state
      handleLogout();
    };
    
    window.addEventListener('auth-required', handleAuthRequired as EventListener);
    
    return () => {
      window.removeEventListener('auth-required', handleAuthRequired as EventListener);
    };
  }, []);

  // Another tab signed out or switched account: this tab must not keep showing the old one.
  useEffect(() => watchDataOwner(accountId, () => window.location.reload()), [accountId]);

  // Auto-play when new audio is set
  useEffect(() => {
    if (currentAudio) {
      setIsPlaying(true);
    }
  }, [currentAudio]);

  const playbackSyncAllowed = isAuthenticated && (settingsContext?.playbackSyncEnabled ?? false);
  // Only while nothing plays here: this device's own playback always comes first.
  const remotePlayback = useRemotePlayback(playbackSyncAllowed && !currentAudio);

  // Cross-device playback sync; can be disabled in settings to reduce battery/data usage.
  usePlaybackSyncWriter({
    enabled: playbackSyncAllowed,
    audio: currentAudio,
    isPlaying,
    queue,
    queueIndex: currentQueueIndex,
    volume: settingsContext?.settings?.volume ?? 100,
    positionRef: currentTimeRef,
  });

  // Update current time from Player (via callback). Writing a ref rather than state
  // keeps the whole App tree from reconciling on every timeupdate event.
  const handleTimeUpdate = useCallback((time: number) => {
    currentTimeRef.current = time;
    if (time > 0) consecutivePlaybackFailures.current = 0;
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

  const handlePlayerRatingChange = (audioId: number, rating: number) => {
    if (currentAudio?.id !== audioId) return;
    setCurrentAudio({ ...currentAudio, rating });
  };

  // Handle track selection from related tracks
  const handleRelatedTrackSelect = (audio: Audio) => {
    setCurrentAudio(audio);
    setIsPlaying(true);
  };

  const handleLoginSuccess = async (passwordChangeRequired = false, loggedInAccountId?: number) => {
    // Before anything renders: the previous account's data must not be readable by this one.
    if (loggedInAccountId === undefined) {
      await clearAccountData();
    } else {
      await claimBrowserData(loggedInAccountId);
      setAccountId(loggedInAccountId);
    }
    setIsAuthenticated(true);
    setAuthEventsEnabled(true);

    // APP-01: a forced password change blocks the rest of the app until resolved.
    if (passwordChangeRequired) {
      setMustChangePassword(true);
      return;
    }

    await offerResumeIfAllowed();
  };

  // Called when the forced password change completes successfully.
  const handlePasswordChanged = async () => {
    setMustChangePassword(false);
    await offerResumeIfAllowed();
  };

  // Handle resume playback from another device
  // Starts the session's track here, from `position`, with its saved queue.
  const resumeFrom = async (session: PlaybackSession, position: number) => {
    try {
      // Fetch the full audio object
      const response = await audioAPI.get(session.youtube_id);
      const audio = response.data;
      
      if (audio) {
        const resumePosition = Math.max(0, position - RESUME_REWIND_SECONDS);
        
        const resumed = await loadResumedQueue(audio);
        setQueue(resumed.tracks);
        setCurrentQueueIndex(resumed.index);
        setUnavailableOnResume(resumed.missing);

        // Set the audio with initial seek position
        setCurrentAudio({ ...audio, _initialSeek: resumePosition } as Audio & { _initialSeek: number });
        setIsPlaying(true);
      }
    } catch (error) {
      console.error('[App] Failed to resume playback:', error);
    }
  };

  const handleResumePlayback = async () => {
    if (!resumeSession?.audio_details) return;
    await resumeFrom(resumeSession, resumeSession.position);
    setShowResumeDialog(false);
    setResumeSession(null);
  };

  // The other device kept playing since its last report: carry on from where it is now,
  // so the usual rewind is added back.
  const playRemoteHere = (session: PlaybackSession) =>
    resumeFrom(session, session.position + session.seconds_since_update + RESUME_REWIND_SECONDS);

  const handleDismissResume = () => {
    setShowResumeDialog(false);
    setResumeSession(null);
    // Clear the session on server since user dismissed it
    playbackSyncAPI.clearSession().catch(() => {});
  };

  const endServerSession = async () => {
    try {
      await ensureCsrfCookie();
      // Call logout endpoint via API client so CSRF header is included.
      await userAPI.logout();
    } catch (error) {
      console.error('Logout error:', error);
    }

    // Clear all session cookies
    document.cookie.split(";").forEach((c) => {
      document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
    });
  };

  const handleLogout = async () => {
    setAuthEventsEnabled(false);

    // The interface goes first, so logging out never waits on the network or a service worker.
    setCurrentAudio(null);
    setQueue([]);
    setCurrentQueueIndex(0);
    setIsPlaying(false);
    setPlayerMinimized(false);
    setMobileDrawerOpen(false);
    
    // Navigate to root and set authenticated to false
    navigate('/', { replace: true });
    setIsAuthenticated(false);
    setMustChangePassword(false);
    setAccountId(null);

    await clearAccountData(endServerSession);
  };

  // Logging out clears what this device saved for offline listening, so that is asked first.
  const requestLogout = async () => {
    const savedForOffline = await audioCache.pinnedTrackIds().catch(() => new Set<string>());
    if (savedForOffline.size === 0) {
      handleLogout();
      return;
    }
    setOfflineTracksAtLogout(savedForOffline.size);
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

  const advanceToNext = useCallback(async () => {
    // Radio mode - get next track from radio
    if (isRadioMode) {
      try {
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
  }, [queue, currentQueueIndex, settingsContext?.settings?.shuffle_enabled, settingsContext?.settings?.smart_shuffle_enabled, settingsContext?.settings?.repeat_mode, smartShuffle, isRadioMode, getNextTrack]);

  const playPrevious = () => {
    if (queue.length > 0 && currentQueueIndex > 0) {
      const prevIndex = currentQueueIndex - 1;
      setCurrentQueueIndex(prevIndex);
      setCurrentAudio(queue[prevIndex]);
    }
  };

  // Hiding the player would drop keyboard focus to nowhere, so it moves with the player: the
  // mini player takes it when it appears, and the minimize button gets it back here.
  const wasMinimized = useRef(false);
  useEffect(() => {
    if (wasMinimized.current && !playerMinimized) {
      document.querySelector<HTMLElement>('[data-testid="player-minimize"]')?.focus();
    }
    wasMinimized.current = playerMinimized;
  }, [playerMinimized]);

  // The user chose to move on, which is what radio learns from.
  const handleSkip = useCallback(async () => {
    if (isRadioMode) {
      await reportSkip();
    }
    await advanceToNext();
  }, [isRadioMode, reportSkip, advanceToNext]);

  // The track played to its end: a play, not a skip.
  const handleTrackEnded = useCallback(async () => {
    if (isRadioMode && currentAudio) {
      await reportPlayed();
    }
    await advanceToNext();
  }, [isRadioMode, currentAudio, reportPlayed, advanceToNext]);

  const hasNextTrack = isRadioMode || queue.length > 1 && (
    Boolean(settingsContext?.settings?.shuffle_enabled)
    || settingsContext?.settings?.repeat_mode === 'all'
    || currentQueueIndex < queue.length - 1
  );

  // The player could not play the current track: say which one, and move on if that can help.
  const handlePlaybackError = useCallback(() => {
    if (!currentAudio) return;

    consecutivePlaybackFailures.current += 1;
    const failedTooOften = consecutivePlaybackFailures.current >= MAX_CONSECUTIVE_PLAYBACK_FAILURES;
    if (failedTooOften) {
      setIsPlaying(false);
      setPlaybackNotice(t('player.errors.stoppedAfterSeveral'));
      return;
    }
    if (!hasNextTrack) {
      setIsPlaying(false);
      setPlaybackNotice(t('player.errors.cannotPlay', { title: currentAudio.title }));
      return;
    }
    setPlaybackNotice(t('player.errors.cannotPlaySkipping', { title: currentAudio.title }));
    advanceToNext();
  }, [currentAudio, hasNextTrack, advanceToNext, t]);

  // Waiting plays go out when the app opens and when the connection returns.
  useEffect(() => {
    if (!accountId) return undefined;

    const flush = () => { flushListeningEvents(); };
    flush();
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
  }, [accountId]);

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

  // Public route: email-change confirmation, reachable from the emailed link even
  // when logged out / on another device (APP-10).
  if (window.location.pathname === '/confirm-email') {
    return <ConfirmEmailPage />;
  }

  if (!isAuthenticated) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  // APP-01: block the entire app behind a forced password change when required.
  if (mustChangePassword) {
    return <ForcePasswordChangePage onChanged={handlePasswordChanged} onLogout={handleLogout} />;
  }

  return (
    <AddMusicProvider>
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
        <TopBar onLogout={requestLogout} onMenuClick={toggleMobileDrawer} />

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
          <LazyRouteBoundary>
          <Suspense
            fallback={
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
                <Box sx={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid', borderColor: 'divider', borderTopColor: 'primary.main', animation: 'spin 0.8s linear infinite', '@keyframes spin': { to: { transform: 'rotate(360deg)' } } }} />
              </Box>
            }
          >
          <NowPlayingProvider
            trackKey={getTrackKey(currentAudio) ?? remotePlayback?.youtube_id ?? null}
            isPlaying={currentAudio ? isPlaying : Boolean(remotePlayback)}
          >
          {remotePlayback && (
            <RemotePlaybackBanner session={remotePlayback} onPlayHere={() => playRemoteHere(remotePlayback)} />
          )}
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
            <Route path="/analytics" element={<><StatsTabs /><AnalyticsPage /></>} />
            <Route path="/achievements" element={<><StatsTabs /><AchievementsPage /></>} />
            <Route path="/wrapped" element={<><StatsTabs /><YearlyWrappedPage /></>} />
            <Route path="/history" element={<><StatsTabs /><ListeningHistoryPage onTrackSelect={setAudioWithQueue} /></>} />
            <Route path="/local-files" element={accountId !== null && <LocalFilesPage setCurrentAudio={setAudioWithQueue} accountId={accountId} />} />
            <Route path="/offline" element={<OfflineManagerPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/share" element={<SharedLinkRoute />} />
            <Route path="/admin/users" element={<AdminRoute><AdminUsersPage /></AdminRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </NowPlayingProvider>
          </Suspense>
          </LazyRouteBoundary>
        </Box>

        <BottomNav />
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
            onTrackEnded={handleTrackEnded}
            onPlaybackError={handlePlaybackError}
            onPrevious={playPrevious}
            hasNext={hasNextTrack}
            hasPrevious={currentQueueIndex > 0}
            onFavoriteToggle={handlePlayerFavoriteToggle}
            onRatingChange={handlePlayerRatingChange}
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
              onTrackEnded={handleTrackEnded}
              onPlaybackError={handlePlaybackError}
              onPrevious={playPrevious}
              hasNext={hasNextTrack}
              hasPrevious={currentQueueIndex > 0}
              onFavoriteToggle={handlePlayerFavoriteToggle}
              onRatingChange={handlePlayerRatingChange}
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
              sx={{
                display: { xs: 'flex', lg: 'none' },
                position: 'fixed',
                bottom: { xs: BOTTOM_NAV_OFFSET, md: 0 },
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
              }}
            >
              <ButtonBase
                autoFocus
                onClick={() => setPlayerMinimized(false)}
                aria-label={t('player.a11y.restore', { title: currentAudio.title })}
                sx={{
                  flex: 1,
                  minWidth: 0,
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  textAlign: 'left',
                  gap: 2,
                  transition: 'all 0.2s ease',
                  '&:active': {
                    bgcolor: 'rgba(255, 255, 255, 0.05)',
                  },
                  '&:focus-visible': {
                    outline: '2px solid',
                    outlineColor: 'primary.main',
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
                  {currentAudio.artist || t('player.unknownArtist')}
                </Typography>
              </Box>
              </ButtonBase>

              {/* Play/Pause Button */}
              <IconButton
                onClick={() => setIsPlaying(!isPlaying)}
                aria-label={isPlaying ? t('player.a11y.pause') : t('player.a11y.play')}
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
      <Snackbar
        open={unavailableOnResume > 0}
        autoHideDuration={UNAVAILABLE_NOTICE_MS}
        onClose={() => setUnavailableOnResume(0)}
        message={t('resumePlayback.tracksUnavailable', { count: unavailableOnResume })}
      />
      <Snackbar
        open={playbackNotice !== ''}
        autoHideDuration={UNAVAILABLE_NOTICE_MS}
        onClose={() => setPlaybackNotice('')}
        message={playbackNotice}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        data-testid="playback-notice"
      />
      <ResumePlaybackDialog
        open={showResumeDialog}
        session={resumeSession}
        onResume={handleResumePlayback}
        onDismiss={handleDismissResume}
      />

      <ConfirmDialog
        open={offlineTracksAtLogout > 0}
        title={t('topbar.logoutConfirm.title')}
        message={t('topbar.logoutConfirm.message', { count: offlineTracksAtLogout })}
        confirmLabel={t('topbar.logout')}
        onConfirm={() => {
          setOfflineTracksAtLogout(0);
          handleLogout();
        }}
        onCancel={() => setOfflineTracksAtLogout(0)}
      />

      {/* PWA Prompts */}
      <PWAPrompts />
    </Box>
    </AddMusicProvider>
  );
}

export default App;
