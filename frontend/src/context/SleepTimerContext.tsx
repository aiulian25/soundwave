/**
 * Sleep Timer Context
 * 
 * Manages sleep timer functionality:
 * - Timer countdown (stop after X minutes)
 * - Song count (stop after Y songs)
 * - Fade out before stopping
 */

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

export type SleepTimerMode = 'minutes' | 'songs' | 'endOfTrack';

export interface SleepTimerSettings {
  mode: SleepTimerMode;
  minutes: number;      // For 'minutes' mode
  songs: number;        // For 'songs' mode
  fadeOut: boolean;     // Whether to fade out before stopping
  fadeDuration: number; // Fade duration in seconds (default 30)
}

interface SleepTimerState {
  isActive: boolean;
  mode: SleepTimerMode;
  remainingMinutes: number;
  remainingSongs: number;
  fadeOut: boolean;
  fadeDuration: number;
  isFading: boolean;
  startedAt: Date | null;
}

interface SleepTimerContextValue {
  // State
  timerState: SleepTimerState;
  
  // Actions
  startTimer: (settings: SleepTimerSettings) => void;
  stopTimer: () => void;
  onSongEnded: () => boolean;  // Call when a song ends - returns true if should stop
  
  // For Player to check/control fade
  getFadeVolume: () => number;  // Returns 0-1 multiplier for volume during fade
  shouldStop: () => boolean;    // Returns true if timer triggered stop
}

const defaultState: SleepTimerState = {
  isActive: false,
  mode: 'minutes',
  remainingMinutes: 0,
  remainingSongs: 0,
  fadeOut: true,
  fadeDuration: 30,
  isFading: false,
  startedAt: null,
};

const SleepTimerContext = createContext<SleepTimerContextValue | null>(null);

export function SleepTimerProvider({ children }: { children: React.ReactNode }) {
  const [timerState, setTimerState] = useState<SleepTimerState>(defaultState);
  const [shouldStopFlag, setShouldStopFlag] = useState(false);
  
  // Refs for timer management
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fadeStartTimeRef = useRef<number | null>(null);
  const targetEndTimeRef = useRef<number | null>(null);
  
  // Clear all timers
  const clearTimers = useCallback(() => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    fadeStartTimeRef.current = null;
    targetEndTimeRef.current = null;
  }, []);
  
  // Start the sleep timer
  const startTimer = useCallback((settings: SleepTimerSettings) => {
    clearTimers();
    setShouldStopFlag(false);
    
    const now = new Date();
    
    if (settings.mode === 'minutes') {
      // Calculate target end time
      const targetEndTime = now.getTime() + settings.minutes * 60 * 1000;
      targetEndTimeRef.current = targetEndTime;
      
      // If fade out is enabled, calculate when to start fading
      const fadeStartTime = settings.fadeOut 
        ? targetEndTime - settings.fadeDuration * 1000 
        : targetEndTime;
      
      setTimerState({
        isActive: true,
        mode: 'minutes',
        remainingMinutes: settings.minutes,
        remainingSongs: 0,
        fadeOut: settings.fadeOut,
        fadeDuration: settings.fadeDuration,
        isFading: false,
        startedAt: now,
      });
      
      // Start countdown interval (update every second)
      countdownIntervalRef.current = setInterval(() => {
        const currentTime = Date.now();
        const remaining = Math.max(0, targetEndTime - currentTime);
        const remainingMinutes = remaining / 60000;
        
        // Check if we should start fading
        const shouldFade = settings.fadeOut && currentTime >= fadeStartTime;
        
        // Check if timer expired
        if (remaining <= 0) {
          clearTimers();
          setShouldStopFlag(true);
          setTimerState(prev => ({
            ...prev,
            isActive: false,
            remainingMinutes: 0,
            isFading: false,
          }));
          return;
        }
        
        // Start fading if it's time
        if (shouldFade && !fadeStartTimeRef.current) {
          fadeStartTimeRef.current = currentTime;
        }
        
        setTimerState(prev => ({
          ...prev,
          remainingMinutes,
          isFading: shouldFade,
        }));
      }, 1000);
      
    } else if (settings.mode === 'songs') {
      setTimerState({
        isActive: true,
        mode: 'songs',
        remainingMinutes: 0,
        remainingSongs: settings.songs,
        fadeOut: settings.fadeOut,
        fadeDuration: settings.fadeDuration,
        isFading: false,
        startedAt: now,
      });
      
    } else if (settings.mode === 'endOfTrack') {
      // Stop at end of current track
      setTimerState({
        isActive: true,
        mode: 'endOfTrack',
        remainingMinutes: 0,
        remainingSongs: 1,
        fadeOut: settings.fadeOut,
        fadeDuration: settings.fadeDuration,
        isFading: false,
        startedAt: now,
      });
    }
    
    console.log('[SleepTimer] Started:', settings);
  }, [clearTimers]);
  
  // Stop the timer
  const stopTimer = useCallback(() => {
    clearTimers();
    setShouldStopFlag(false);
    setTimerState(defaultState);
    console.log('[SleepTimer] Stopped');
  }, [clearTimers]);
  
  // Called when a song ends - returns true if playback should stop
  const onSongEnded = useCallback((): boolean => {
    if (!timerState.isActive) return false;
    
    if (timerState.mode === 'songs' || timerState.mode === 'endOfTrack') {
      const newRemaining = timerState.remainingSongs - 1;
      
      if (newRemaining <= 0) {
        // Timer expired
        clearTimers();
        setShouldStopFlag(true);
        setTimerState(prev => ({
          ...prev,
          isActive: false,
          remainingSongs: 0,
        }));
        console.log('[SleepTimer] Song count reached, stopping');
        return true;  // Signal to stop playback
      } else {
        setTimerState(prev => ({
          ...prev,
          remainingSongs: newRemaining,
        }));
      }
    }
    return false;  // Continue playing
  }, [timerState.isActive, timerState.mode, timerState.remainingSongs, clearTimers]);
  
  // Get current fade volume multiplier (0-1)
  const getFadeVolume = useCallback((): number => {
    if (!timerState.isFading || !fadeStartTimeRef.current) {
      return 1;
    }
    
    const elapsed = (Date.now() - fadeStartTimeRef.current) / 1000;
    const progress = Math.min(1, elapsed / timerState.fadeDuration);
    
    // Smooth fade curve (ease out)
    return Math.max(0, 1 - progress * progress);
  }, [timerState.isFading, timerState.fadeDuration]);
  
  // Check if timer triggered stop
  const shouldStop = useCallback((): boolean => {
    if (shouldStopFlag) {
      setShouldStopFlag(false);
      return true;
    }
    return false;
  }, [shouldStopFlag]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);
  
  const value: SleepTimerContextValue = {
    timerState,
    startTimer,
    stopTimer,
    onSongEnded,
    getFadeVolume,
    shouldStop,
  };
  
  return (
    <SleepTimerContext.Provider value={value}>
      {children}
    </SleepTimerContext.Provider>
  );
}

export function useSleepTimer() {
  const context = useContext(SleepTimerContext);
  if (!context) {
    throw new Error('useSleepTimer must be used within a SleepTimerProvider');
  }
  return context;
}
