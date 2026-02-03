/**
 * Smart Radio / Auto-DJ Context and Hook
 * 
 * Provides radio functionality throughout the app including:
 * - Starting radio from any track/artist
 * - Automatic next track selection
 * - Learning from user behavior (skips/plays)
 */

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { radioAPI } from '../api/client';
import type { Audio } from '../types';

export type RadioMode = 'track' | 'artist' | 'favorites' | 'discovery' | 'recent';

export interface RadioSession {
  mode: RadioMode;
  seed_youtube_id: string;
  seed_channel_id: string;
  seed_title: string;
  seed_artist: string;
  is_active: boolean;
  current_youtube_id: string;
  variety_level: number;
  started_at: string;
  updated_at: string;
  seed_track: {
    id: number;
    youtube_id: string;
    title: string;
    artist: string;
    thumbnail_url: string;
    cover_art_url: string;
  } | null;
  tracks_played: number;
  tracks_skipped: number;
}

interface RadioContextValue {
  // State
  isRadioMode: boolean;
  radioSession: RadioSession | null;
  isLoading: boolean;
  currentReason: string;
  
  // Actions
  startRadio: (mode: RadioMode, seedYoutubeId?: string, seedChannelId?: string, varietyLevel?: number) => Promise<Audio | null>;
  stopRadio: () => Promise<void>;
  getNextTrack: () => Promise<Audio | null>;
  reportSkip: () => Promise<void>;  // Simplified - uses current track info
  reportPlayed: () => Promise<void>;  // Simplified - uses current track info
  reportLiked: () => Promise<void>;  // Simplified - uses current track info
  setCurrentTrackInfo: (youtubeId: string, duration: number) => void;  // Set current track for reporting
  refreshStatus: () => Promise<void>;
}

const RadioContext = createContext<RadioContextValue | null>(null);

export function RadioProvider({ children }: { children: React.ReactNode }) {
  const [isRadioMode, setIsRadioMode] = useState(false);
  const [radioSession, setRadioSession] = useState<RadioSession | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [currentReason, setCurrentReason] = useState('');
  
  // Track info for reporting
  const currentTrackInfoRef = useRef<{ youtubeId: string; duration: number; startTime: number } | null>(null);
  
  // Set current track info for reporting
  const setCurrentTrackInfo = useCallback((youtubeId: string, duration: number) => {
    currentTrackInfoRef.current = { youtubeId, duration, startTime: Date.now() };
  }, []);
  // Check for existing radio session on mount
  useEffect(() => {
    refreshStatus();
  }, []);
  
  const refreshStatus = useCallback(async () => {
    try {
      const response = await radioAPI.status();
      if (response.data?.has_session && response.data?.session?.is_active) {
        setRadioSession(response.data.session);
        setIsRadioMode(true);
      } else {
        setRadioSession(null);
        setIsRadioMode(false);
      }
    } catch (error) {
      console.debug('[Radio] Failed to get status:', error);
    }
  }, []);
  
  const startRadio = useCallback(async (
    mode: RadioMode,
    seedYoutubeId?: string,
    seedChannelId?: string,
    varietyLevel: number = 50
  ): Promise<Audio | null> => {
    setIsLoading(true);
    try {
      const response = await radioAPI.start({
        mode,
        seed_youtube_id: seedYoutubeId,
        seed_channel_id: seedChannelId,
        variety_level: varietyLevel,
      });
      
      if (response.data?.session) {
        setRadioSession(response.data.session);
        setIsRadioMode(true);
        setCurrentReason('Radio started');
        
        return response.data.first_track || null;
      }
      return null;
    } catch (error) {
      console.error('[Radio] Failed to start:', error);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);
  
  const stopRadio = useCallback(async () => {
    try {
      await radioAPI.stop();
      setIsRadioMode(false);
      setRadioSession(null);
      setCurrentReason('');
    } catch (error) {
      console.error('[Radio] Failed to stop:', error);
    }
  }, []);
  
  const getNextTrack = useCallback(async (): Promise<Audio | null> => {
    if (!isRadioMode) return null;
    
    setIsLoading(true);
    try {
      const response = await radioAPI.next();
      
      if (response.data?.track) {
        setCurrentReason(response.data.reason || '');
        
        // Update session stats
        if (radioSession) {
          setRadioSession({
            ...radioSession,
            current_youtube_id: response.data.track.youtube_id,
            tracks_played: response.data.total_played,
          });
        }
        
        return response.data.track;
      }
      return null;
    } catch (error) {
      console.error('[Radio] Failed to get next track:', error);
      // If we can't get next track, stop radio
      if ((error as any)?.response?.status === 404) {
        setIsRadioMode(false);
      }
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [isRadioMode, radioSession]);
  
  const reportSkip = useCallback(async () => {
    if (!isRadioMode || !currentTrackInfoRef.current) return;
    
    const { youtubeId, duration, startTime } = currentTrackInfoRef.current;
    const listenDuration = (Date.now() - startTime) / 1000;
    
    try {
      await radioAPI.skip({
        youtube_id: youtubeId,
        listen_duration: Math.floor(listenDuration),
        track_duration: Math.floor(duration),
      });
      
      // Update session stats
      if (radioSession) {
        setRadioSession({
          ...radioSession,
          tracks_skipped: radioSession.tracks_skipped + 1,
        });
      }
    } catch (error) {
      console.debug('[Radio] Failed to report skip:', error);
    }
  }, [isRadioMode, radioSession]);
  
  const reportPlayed = useCallback(async () => {
    if (!isRadioMode || !currentTrackInfoRef.current) return;
    
    const { youtubeId, duration, startTime } = currentTrackInfoRef.current;
    const listenDuration = (Date.now() - startTime) / 1000;
    
    try {
      await radioAPI.like({
        youtube_id: youtubeId,
        feedback_type: 'played',
        listen_duration: Math.floor(listenDuration),
        track_duration: Math.floor(duration),
      });
    } catch (error) {
      console.debug('[Radio] Failed to report played:', error);
    }
  }, [isRadioMode]);
  
  const reportLiked = useCallback(async () => {
    if (!isRadioMode || !currentTrackInfoRef.current) return;
    
    try {
      await radioAPI.like({
        youtube_id: currentTrackInfoRef.current.youtubeId,
        feedback_type: 'liked',
      });
    } catch (error) {
      console.debug('[Radio] Failed to report liked:', error);
    }
  }, [isRadioMode]);
  
  const value: RadioContextValue = {
    isRadioMode,
    radioSession,
    isLoading,
    currentReason,
    startRadio,
    stopRadio,
    getNextTrack,
    reportSkip,
    reportPlayed,
    reportLiked,
    setCurrentTrackInfo,
    refreshStatus,
  };
  
  return (
    <RadioContext.Provider value={value}>
      {children}
    </RadioContext.Provider>
  );
}

export function useRadio() {
  const context = useContext(RadioContext);
  if (!context) {
    throw new Error('useRadio must be used within a RadioProvider');
  }
  return context;
}
