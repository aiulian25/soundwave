/**
 * useHighlightTrack Hook
 * 
 * Handles highlighting a specific track when navigating to a page.
 * - Reads ?highlight=youtube_id from URL
 * - Scrolls to the track
 * - Applies temporary highlight animation
 * - Clears the URL parameter after highlighting
 */

import { useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

interface UseHighlightTrackOptions {
  /** Delay before scrolling (ms) - allows page to render */
  scrollDelay?: number;
  /** Duration of highlight effect (ms) */
  highlightDuration?: number;
}

export function useHighlightTrack(options: UseHighlightTrackOptions = {}) {
  const { scrollDelay = 300, highlightDuration = 3000 } = options;
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightedRef = useRef<string | null>(null);
  
  const highlightYoutubeId = searchParams.get('highlight');
  
  // Get the ref callback for track rows
  const getTrackRef = useCallback((youtubeId: string | undefined) => {
    if (!youtubeId || youtubeId !== highlightYoutubeId) return null;
    
    return (element: HTMLElement | null) => {
      if (!element || highlightedRef.current === youtubeId) return;
      
      highlightedRef.current = youtubeId;
      
      // Scroll to element after a short delay to ensure rendering
      setTimeout(() => {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Add highlight class
        element.classList.add('highlight-track');
        
        // Remove highlight and clear URL param after duration
        setTimeout(() => {
          element.classList.remove('highlight-track');
          // Clear the highlight param from URL
          const newParams = new URLSearchParams(searchParams);
          newParams.delete('highlight');
          setSearchParams(newParams, { replace: true });
        }, highlightDuration);
      }, scrollDelay);
    };
  }, [highlightYoutubeId, scrollDelay, highlightDuration, searchParams, setSearchParams]);
  
  // Check if a track should be highlighted
  const shouldHighlight = useCallback((youtubeId: string | undefined) => {
    return youtubeId === highlightYoutubeId;
  }, [highlightYoutubeId]);
  
  // Reset when highlight param changes
  useEffect(() => {
    if (!highlightYoutubeId) {
      highlightedRef.current = null;
    }
  }, [highlightYoutubeId]);
  
  return {
    highlightYoutubeId,
    getTrackRef,
    shouldHighlight,
  };
}

// CSS styles to be added to the global styles or a component
export const highlightTrackStyles = `
  @keyframes highlightPulse {
    0% {
      box-shadow: 0 0 0 0 rgba(19, 236, 106, 0.7);
      background-color: rgba(19, 236, 106, 0.15);
    }
    50% {
      box-shadow: 0 0 20px 4px rgba(19, 236, 106, 0.4);
      background-color: rgba(19, 236, 106, 0.25);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(19, 236, 106, 0);
      background-color: transparent;
    }
  }
  
  .highlight-track {
    animation: highlightPulse 1s ease-in-out 3;
    border-left: 3px solid #13ec6a !important;
  }
`;
