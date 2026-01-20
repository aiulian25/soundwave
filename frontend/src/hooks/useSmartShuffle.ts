/**
 * Smart Shuffle Hook - Avoids recently played songs in shuffle mode
 * Keeps track of play history and ensures better shuffle distribution
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { Audio } from '../types';

interface SmartShuffleOptions {
  historySize?: number; // Number of recently played songs to avoid
  enabled?: boolean;
}

const DEFAULT_HISTORY_SIZE = 10; // Avoid last 10 songs by default
const STORAGE_KEY = 'soundwave_play_history';

export const useSmartShuffle = (options: SmartShuffleOptions = {}) => {
  const { historySize = DEFAULT_HISTORY_SIZE, enabled = true } = options;
  const [playHistory, setPlayHistory] = useState<number[]>([]);
  const historyRef = useRef<number[]>([]);

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setPlayHistory(parsed.slice(-historySize));
          historyRef.current = parsed.slice(-historySize);
        }
      }
    } catch (e) {
      console.error('Failed to load play history:', e);
    }
  }, [historySize]);

  // Save history to localStorage when it changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(playHistory));
      historyRef.current = playHistory;
    } catch (e) {
      console.error('Failed to save play history:', e);
    }
  }, [playHistory]);

  // Add a song to play history
  const addToHistory = useCallback((audioId: number) => {
    setPlayHistory(prev => {
      const newHistory = [...prev.filter(id => id !== audioId), audioId];
      // Keep only the last N songs
      return newHistory.slice(-historySize);
    });
  }, [historySize]);

  // Clear play history
  const clearHistory = useCallback(() => {
    setPlayHistory([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  // Get smart shuffled next track from a queue
  const getSmartShuffledNext = useCallback((
    queue: Audio[],
    currentIndex: number,
    excludeCurrentTrack: boolean = true
  ): { audio: Audio; index: number } | null => {
    if (!queue || queue.length === 0) return null;
    if (queue.length === 1) return { audio: queue[0], index: 0 };

    // Get available tracks (not in recent history)
    const currentHistory = historyRef.current;
    let availableTracks = queue.map((audio, index) => ({ audio, index }));

    // Exclude current track if requested
    if (excludeCurrentTrack && currentIndex >= 0) {
      availableTracks = availableTracks.filter(t => t.index !== currentIndex);
    }

    if (enabled && currentHistory.length > 0) {
      // Filter out recently played tracks
      const notRecentlyPlayed = availableTracks.filter(
        t => !currentHistory.includes(t.audio.id)
      );

      // If we have non-recently-played tracks, prefer those
      if (notRecentlyPlayed.length > 0) {
        availableTracks = notRecentlyPlayed;
      }
      // Otherwise, fall back to all available tracks (excluding current)
    }

    if (availableTracks.length === 0) return null;

    // Randomly select from available tracks
    const randomIndex = Math.floor(Math.random() * availableTracks.length);
    return availableTracks[randomIndex];
  }, [enabled]);

  // Generate a smart shuffled queue
  const generateSmartShuffledQueue = useCallback((
    originalQueue: Audio[],
    startWithAudio?: Audio
  ): Audio[] => {
    if (!originalQueue || originalQueue.length === 0) return [];
    if (originalQueue.length === 1) return [...originalQueue];

    const currentHistory = historyRef.current;
    const result: Audio[] = [];
    const remaining = [...originalQueue];

    // If we have a start audio, put it first
    if (startWithAudio) {
      const startIndex = remaining.findIndex(a => a.id === startWithAudio.id);
      if (startIndex !== -1) {
        result.push(remaining.splice(startIndex, 1)[0]);
      }
    }

    // Smart shuffle the rest
    while (remaining.length > 0) {
      let selectedIndex: number;

      if (enabled && currentHistory.length > 0) {
        // Find tracks not in recent history
        const notRecentIndices = remaining
          .map((audio, index) => ({ audio, index }))
          .filter(t => !currentHistory.includes(t.audio.id))
          .map(t => t.index);

        if (notRecentIndices.length > 0) {
          // Prefer non-recently played tracks
          selectedIndex = notRecentIndices[Math.floor(Math.random() * notRecentIndices.length)];
        } else {
          // Fall back to random
          selectedIndex = Math.floor(Math.random() * remaining.length);
        }
      } else {
        // Standard random shuffle
        selectedIndex = Math.floor(Math.random() * remaining.length);
      }

      result.push(remaining.splice(selectedIndex, 1)[0]);
    }

    return result;
  }, [enabled]);

  return {
    playHistory,
    addToHistory,
    clearHistory,
    getSmartShuffledNext,
    generateSmartShuffledQueue,
  };
};
