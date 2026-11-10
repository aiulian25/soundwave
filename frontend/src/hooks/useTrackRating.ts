import { useEffect, useState } from 'react';
import { audioAPI } from '../api/client';

export const UNRATED = 0;
export const HIGHEST_RATING = 5;

/** A track's stars: shown at once, and put back if the server does not take them. */
export function useTrackRating(
  youtubeId: string | undefined,
  savedRating: number | undefined,
  onRated?: (rating: number) => void,
) {
  const [rating, setRating] = useState(savedRating ?? UNRATED);

  useEffect(() => {
    setRating(savedRating ?? UNRATED);
  }, [youtubeId, savedRating]);

  const rate = async (stars: number) => {
    if (!youtubeId) return;
    const ratingBefore = rating;
    setRating(stars);
    try {
      const response = await audioAPI.setRating(youtubeId, stars);
      onRated?.(response.data.rating);
    } catch (error) {
      console.error('Failed to rate track:', error);
      setRating(ratingBefore);
    }
  };

  return { rating, rate };
}
