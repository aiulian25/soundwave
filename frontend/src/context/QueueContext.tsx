/**
 * Queue Context
 * 
 * Centralized queue management for:
 * - Viewing and reordering the queue
 * - Adding tracks to "Play Next" or "Add to Queue"
 * - Clearing the queue
 * - Tracking play history for back navigation
 */

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import type { Audio } from '../types';

interface QueueContextValue {
  // State
  queue: Audio[];
  currentIndex: number;
  history: Audio[];  // Previously played tracks (for back button)
  
  // Basic queue operations
  setQueue: (tracks: Audio[], startIndex?: number) => void;
  clearQueue: () => void;
  
  // Add to queue operations
  playNext: (track: Audio) => void;  // Insert after current
  addToQueue: (track: Audio) => void;  // Add to end
  playNextMultiple: (tracks: Audio[]) => void;  // Insert multiple after current
  addToQueueMultiple: (tracks: Audio[]) => void;  // Add multiple to end
  
  // Playback operations
  playTrackAtIndex: (index: number) => Audio | null;
  goToNext: () => Audio | null;
  goToPrevious: () => Audio | null;
  
  // Reorder operations
  moveTrack: (fromIndex: number, toIndex: number) => void;
  removeTrack: (index: number) => void;
  
  // Current track info
  currentTrack: Audio | null;
  hasNext: boolean;
  hasPrevious: boolean;
  
  // For external state sync
  setCurrentIndex: (index: number) => void;
  syncQueueFromExternal: (tracks: Audio[], index: number) => void;
}

const QueueContext = createContext<QueueContextValue | null>(null);

export function QueueProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueueState] = useState<Audio[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [history, setHistory] = useState<Audio[]>([]);
  
  // Track if we're in an internal update to prevent loops
  const isInternalUpdate = useRef(false);
  
  // Set a new queue
  const setQueue = useCallback((tracks: Audio[], startIndex: number = 0) => {
    isInternalUpdate.current = true;
    setQueueState(tracks);
    setCurrentIndex(Math.max(0, Math.min(startIndex, tracks.length - 1)));
    setHistory([]);  // Clear history when starting a new queue
    isInternalUpdate.current = false;
  }, []);
  
  // Sync queue from external source (App.tsx) without triggering callbacks
  const syncQueueFromExternal = useCallback((tracks: Audio[], index: number) => {
    setQueueState(tracks);
    setCurrentIndex(index);
  }, []);
  
  // Clear the entire queue
  const clearQueue = useCallback(() => {
    setQueueState([]);
    setCurrentIndex(0);
    setHistory([]);
  }, []);
  
  // Play a track next (insert after current position)
  const playNext = useCallback((track: Audio) => {
    setQueueState(prev => {
      // Don't add duplicates right after current
      const insertIndex = currentIndex + 1;
      const newQueue = [...prev];
      
      // Remove if already in queue (to avoid duplicates)
      const existingIndex = newQueue.findIndex(t => t.id === track.id);
      if (existingIndex !== -1 && existingIndex !== currentIndex) {
        newQueue.splice(existingIndex, 1);
        // Adjust insert index if we removed something before it
        const adjustedInsertIndex = existingIndex < insertIndex ? insertIndex - 1 : insertIndex;
        newQueue.splice(adjustedInsertIndex, 0, track);
      } else if (existingIndex === -1) {
        newQueue.splice(insertIndex, 0, track);
      }
      
      return newQueue;
    });
  }, [currentIndex]);
  
  // Add to end of queue
  const addToQueue = useCallback((track: Audio) => {
    setQueueState(prev => {
      // Check if already in queue
      if (prev.some(t => t.id === track.id)) {
        return prev;  // Don't add duplicates
      }
      return [...prev, track];
    });
  }, []);
  
  // Play multiple tracks next
  const playNextMultiple = useCallback((tracks: Audio[]) => {
    setQueueState(prev => {
      const newQueue = [...prev];
      const insertIndex = currentIndex + 1;
      
      // Filter out tracks already in queue
      const tracksToAdd = tracks.filter(t => 
        !newQueue.some(q => q.id === t.id) || 
        newQueue.findIndex(q => q.id === t.id) === currentIndex
      );
      
      newQueue.splice(insertIndex, 0, ...tracksToAdd);
      return newQueue;
    });
  }, [currentIndex]);
  
  // Add multiple to end of queue
  const addToQueueMultiple = useCallback((tracks: Audio[]) => {
    setQueueState(prev => {
      // Filter out duplicates
      const tracksToAdd = tracks.filter(t => !prev.some(q => q.id === t.id));
      return [...prev, ...tracksToAdd];
    });
  }, []);
  
  // Play track at specific index
  const playTrackAtIndex = useCallback((index: number): Audio | null => {
    if (index < 0 || index >= queue.length) return null;
    
    // Add current track to history before moving
    if (queue[currentIndex]) {
      setHistory(prev => [...prev.slice(-49), queue[currentIndex]]);  // Keep last 50
    }
    
    setCurrentIndex(index);
    return queue[index];
  }, [queue, currentIndex]);
  
  // Go to next track
  const goToNext = useCallback((): Audio | null => {
    if (currentIndex >= queue.length - 1) return null;
    
    // Add current track to history
    if (queue[currentIndex]) {
      setHistory(prev => [...prev.slice(-49), queue[currentIndex]]);
    }
    
    const nextIndex = currentIndex + 1;
    setCurrentIndex(nextIndex);
    return queue[nextIndex];
  }, [queue, currentIndex]);
  
  // Go to previous track (from history or queue)
  const goToPrevious = useCallback((): Audio | null => {
    if (currentIndex > 0) {
      const prevIndex = currentIndex - 1;
      setCurrentIndex(prevIndex);
      return queue[prevIndex];
    }
    
    // If at start of queue, try to use history
    if (history.length > 0) {
      const prevTrack = history[history.length - 1];
      setHistory(prev => prev.slice(0, -1));
      // Insert at current position
      setQueueState(prev => [prevTrack, ...prev]);
      // Index stays at 0
      return prevTrack;
    }
    
    return null;
  }, [queue, currentIndex, history]);
  
  // Move a track within the queue (for drag-and-drop reordering)
  const moveTrack = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= queue.length) return;
    if (toIndex < 0 || toIndex >= queue.length) return;
    
    setQueueState(prev => {
      const newQueue = [...prev];
      const [removed] = newQueue.splice(fromIndex, 1);
      newQueue.splice(toIndex, 0, removed);
      return newQueue;
    });
    
    // Update current index if affected
    setCurrentIndex(prev => {
      if (fromIndex === prev) {
        // We moved the current track
        return toIndex;
      } else if (fromIndex < prev && toIndex >= prev) {
        // Track moved from before current to after/at current
        return prev - 1;
      } else if (fromIndex > prev && toIndex <= prev) {
        // Track moved from after current to before/at current
        return prev + 1;
      }
      return prev;
    });
  }, [queue.length]);
  
  // Remove a track from the queue
  const removeTrack = useCallback((index: number) => {
    if (index < 0 || index >= queue.length) return;
    if (index === currentIndex) return;  // Can't remove currently playing track
    
    setQueueState(prev => {
      const newQueue = [...prev];
      newQueue.splice(index, 1);
      return newQueue;
    });
    
    // Update current index if needed
    setCurrentIndex(prev => {
      if (index < prev) {
        return prev - 1;
      }
      return prev;
    });
  }, [queue.length, currentIndex]);
  
  const currentTrack = queue[currentIndex] || null;
  const hasNext = currentIndex < queue.length - 1;
  const hasPrevious = currentIndex > 0 || history.length > 0;
  
  const value: QueueContextValue = {
    queue,
    currentIndex,
    history,
    setQueue,
    clearQueue,
    playNext,
    addToQueue,
    playNextMultiple,
    addToQueueMultiple,
    playTrackAtIndex,
    goToNext,
    goToPrevious,
    moveTrack,
    removeTrack,
    currentTrack,
    hasNext,
    hasPrevious,
    setCurrentIndex,
    syncQueueFromExternal,
  };
  
  return (
    <QueueContext.Provider value={value}>
      {children}
    </QueueContext.Provider>
  );
}

export function useQueue() {
  const context = useContext(QueueContext);
  if (!context) {
    throw new Error('useQueue must be used within a QueueProvider');
  }
  return context;
}
