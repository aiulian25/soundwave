/**
 * Cross-device playback sync hook
 * 
 * Periodically syncs playback position to the server so users can
 * resume on another device from where they left off.
 * 
 * Network-aware: adjusts sync frequency based on connection quality
 * and uses exponential backoff on failures.
 */

import { useEffect, useRef, useCallback } from 'react';
import { playbackSyncAPI } from '../api/client';
import type { Audio } from '../types';
import { getNetworkInfo, getPollingInterval, apiBackoffs } from '../utils/networkQuality';

// Generate a unique device ID for this browser
const getDeviceId = (): string => {
  let deviceId = localStorage.getItem('soundwave_device_id');
  if (!deviceId) {
    deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    localStorage.setItem('soundwave_device_id', deviceId);
  }
  return deviceId;
};

// Get a friendly device name
const getDeviceName = (): string => {
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Mac/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Web Browser';
};

export interface PlaybackSession {
  youtube_id: string;
  position: number;
  duration: number;
  is_playing: boolean;
  volume: number;
  queue_youtube_ids: string[];
  queue_index: number;
  device_id: string;
  device_name: string;
  updated_at: string;
  seconds_since_update: number;
  audio_details: {
    id: number;
    youtube_id: string;
    title: string;
    channel_name: string;
    artist: string;
    album: string;
    duration: number;
    thumbnail_url: string;
    cover_art_url: string;
  } | null;
}

interface UsePlaybackSyncOptions {
  enabled?: boolean;
  syncInterval?: number;  // How often to sync (in ms), default 15s
  currentAudio: Audio | null;
  currentTime: number;
  isPlaying: boolean;
  volume: number;
  queue: Audio[];
  queueIndex: number;
}

interface UsePlaybackSyncReturn {
  syncNow: () => Promise<void>;
  clearSession: () => Promise<void>;
}

export function usePlaybackSync({
  enabled = true,
  syncInterval = 15000,
  currentAudio,
  currentTime,
  isPlaying,
  volume,
  queue,
  queueIndex,
}: UsePlaybackSyncOptions): UsePlaybackSyncReturn {
  const lastSyncRef = useRef<number>(0);
  const lastPositionRef = useRef<number>(0);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // Get network-aware sync interval
  const getEffectiveSyncInterval = useCallback(() => {
    // If we have failures, use backoff
    if (!apiBackoffs.playbackSync.shouldAttempt()) {
      const failures = apiBackoffs.playbackSync.getFailureCount();
      console.debug(`[PlaybackSync] Using backoff interval (failures: ${failures})`);
      return Math.min(syncInterval * Math.pow(2, failures), 120000);  // Max 2 min
    }
    
    // Otherwise use network-aware interval
    return getPollingInterval(syncInterval);
  }, [syncInterval]);
  
  // Sync playback state to server
  const syncNow = useCallback(async () => {
    if (!enabled || !currentAudio?.youtube_id) return;
    
    // Don't sync if we're in backoff mode (unless it's been long enough)
    if (!apiBackoffs.playbackSync.shouldAttempt()) {
      console.debug('[PlaybackSync] Skipping sync due to backoff');
      return;
    }
    
    // Don't sync if offline
    const networkInfo = getNetworkInfo();
    if (!networkInfo.isOnline) {
      console.debug('[PlaybackSync] Skipping sync - offline');
      return;
    }
    
    // Don't sync if position hasn't changed much (avoid spam)
    const positionDiff = Math.abs(currentTime - lastPositionRef.current);
    const timeSinceLastSync = Date.now() - lastSyncRef.current;
    const effectiveInterval = getEffectiveSyncInterval();
    
    // Sync if: position changed by >3s, or it's been >interval since last sync, or we're pausing
    if (positionDiff < 3 && timeSinceLastSync < effectiveInterval && isPlaying) {
      return;
    }
    
    try {
      await playbackSyncAPI.syncPlayback({
        youtube_id: currentAudio.youtube_id,
        position: currentTime,
        duration: currentAudio.duration,
        is_playing: isPlaying,
        volume: volume,
        queue_youtube_ids: queue.map(a => a.youtube_id).filter(Boolean) as string[],
        queue_index: queueIndex,
        device_id: getDeviceId(),
        device_name: getDeviceName(),
      });
      
      lastSyncRef.current = Date.now();
      lastPositionRef.current = currentTime;
      
      // Record success - reset backoff
      apiBackoffs.playbackSync.recordSuccess();
    } catch (error) {
      // Record failure for backoff
      const nextDelay = apiBackoffs.playbackSync.recordFailure();
      console.debug(`[PlaybackSync] Sync failed, next attempt in ${Math.round(nextDelay / 1000)}s:`, error);
    }
  }, [enabled, currentAudio, currentTime, isPlaying, volume, queue, queueIndex, getEffectiveSyncInterval]);
  
  // Clear the session
  const clearSession = useCallback(async () => {
    try {
      await playbackSyncAPI.clearSession();
    } catch (error) {
      console.debug('[PlaybackSync] Clear session failed:', error);
    }
  }, []);
  
  // Periodic sync while playing - with dynamic interval based on network
  useEffect(() => {
    if (!enabled || !currentAudio?.youtube_id) return;
    
    // Sync immediately when track changes
    syncNow();
    
    // Set up dynamic periodic sync that adapts to network conditions
    const setupInterval = () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
      
      const interval = getEffectiveSyncInterval();
      console.debug(`[PlaybackSync] Setting sync interval: ${Math.round(interval / 1000)}s`);
      
      syncIntervalRef.current = setInterval(() => {
        if (isPlaying) {
          syncNow();
          // Dynamically adjust interval based on current conditions
          const newInterval = getEffectiveSyncInterval();
          if (newInterval !== interval) {
            setupInterval();  // Re-setup with new interval
          }
        }
      }, interval);
    };
    
    setupInterval();
    
    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
      }
    };
  }, [enabled, currentAudio?.youtube_id, isPlaying, syncNow, getEffectiveSyncInterval]);
  
  // Sync when pausing (important for resume)
  useEffect(() => {
    if (!enabled || !currentAudio?.youtube_id) return;
    
    // When isPlaying changes to false, sync the position
    if (!isPlaying && lastPositionRef.current !== currentTime) {
      syncNow();
    }
  }, [enabled, currentAudio?.youtube_id, isPlaying, currentTime, syncNow]);
  
  // Sync before page unload
  useEffect(() => {
    if (!enabled) return;
    
    const handleBeforeUnload = () => {
      if (currentAudio?.youtube_id) {
        const data = JSON.stringify({
          youtube_id: currentAudio.youtube_id,
          position: currentTime,
          duration: currentAudio.duration,
          is_playing: false,  // Mark as paused since we're leaving
          volume: volume,
          queue_youtube_ids: queue.map(a => a.youtube_id).filter(Boolean),
          queue_index: queueIndex,
          device_id: getDeviceId(),
          device_name: getDeviceName(),
        });
        
        const token = localStorage.getItem('token');
        
        // Use fetch with keepalive for reliable sync on page close
        fetch('/api/playback-sync/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Token ${token}`,
          },
          body: data,
          keepalive: true,  // Allow request to outlive the page
        }).catch(() => {});
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handleBeforeUnload);
    };
  }, [enabled, currentAudio, currentTime, volume, queue, queueIndex]);
  
  return { syncNow, clearSession };
}

// Helper to check for active session on login
export async function checkPlaybackSession(): Promise<PlaybackSession | null> {
  try {
    const response = await playbackSyncAPI.getSession();
    if (response.data?.has_session && response.data?.session) {
      return response.data.session;
    }
  } catch (error) {
    // 404 means no session, which is fine
    if ((error as any)?.response?.status !== 404) {
      console.debug('[PlaybackSync] Check session failed:', error);
    }
  }
  return null;
}
