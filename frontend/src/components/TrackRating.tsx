import { useId } from 'react';
import { Rating } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { HIGHEST_RATING, UNRATED } from '../hooks/useTrackRating';

interface TrackRatingProps {
  rating: number;
  onRate: (stars: number) => void;
  size?: 'small' | 'medium';
}

/** Five stars; choosing the current star again takes the rating away. */
export default function TrackRating({ rating, onRate, size = 'small' }: TrackRatingProps) {
  const { t } = useTranslation();
  const groupName = useId();

  return (
    <Rating
      data-testid="track-rating"
      data-rating={rating}
      name={groupName}
      value={rating || null}
      max={HIGHEST_RATING}
      size={size}
      onChange={(_event, stars) => onRate(stars ?? UNRATED)}
      getLabelText={(stars) => t('trackRating.stars', { count: stars })}
      emptyLabelText={t('trackRating.stars', { count: UNRATED })}
    />
  );
}
