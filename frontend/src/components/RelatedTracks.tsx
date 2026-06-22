import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemButton,
  ListItemAvatar,
  Avatar,
  ListItemText,
  IconButton,
  Chip,
  Skeleton,
  Divider,
  Collapse,
  Alert,
  Tooltip,
} from '@mui/material';
import {
  PlayArrow as PlayIcon,
  Favorite as FavoriteIcon,
  FavoriteBorder as FavoriteBorderIcon,
  ExpandLess,
  ExpandMore,
  TrendingUp,
  History,
  Recommend,
  MusicNote,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { audioAPI } from '../api/client';
import type { Audio } from '../types';

interface RelatedTracksProps {
  currentAudio: Audio;
  onTrackSelect: (audio: Audio) => void;
  onFavoriteToggle?: (audio: Audio) => void;
  compact?: boolean;
}

interface RecommendationResponse {
  recommendations: Audio[];
  total: number;
  based_on: string;
  algorithm_weights: {
    same_channel: number;
    frequent_channels: number;
    favorite_channels: number;
    popular_recent: number;
  };
}

interface SimilarTracksResponse {
  similar_tracks: Audio[];
  based_on_channel: string;
  total: number;
}

export default function RelatedTracks({ 
  currentAudio, 
  onTrackSelect, 
  onFavoriteToggle,
  compact = false 
}: RelatedTracksProps) {
  const { t } = useTranslation();
  const [recommendations, setRecommendations] = useState<Audio[]>([]);
  const [similarTracks, setSimilarTracks] = useState<Audio[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showRecommendations, setShowRecommendations] = useState(true);
  const [showSimilar, setShowSimilar] = useState(false);
  const [algorithmInfo, setAlgorithmInfo] = useState<any>(null);

  useEffect(() => {
    loadRelatedTracks();
  }, [currentAudio.id]);

  const loadRelatedTracks = async () => {
    if (!currentAudio.youtube_id) {
      setError(t('relatedTracks.errors.notAvailableForLocalFiles'));
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    
    try {
      // Load both recommendations and similar tracks in parallel
      const [recResponse, simResponse] = await Promise.allSettled([
        audioAPI.getRecommendations(currentAudio.youtube_id),
        audioAPI.getSimilarTracks(currentAudio.youtube_id)
      ]);

      if (recResponse.status === 'fulfilled') {
        const recData = recResponse.value.data as RecommendationResponse;
        setRecommendations(recData.recommendations);
        setAlgorithmInfo(recData.algorithm_weights);
      }

      if (simResponse.status === 'fulfilled') {
        const simData = simResponse.value.data as SimilarTracksResponse;
        setSimilarTracks(simData.similar_tracks);
      }

      if (recResponse.status === 'rejected' && simResponse.status === 'rejected') {
        setError(t('relatedTracks.errors.loadFailed'));
      }
    } catch (err) {
      console.error('Error loading related tracks:', err);
      setError(t('relatedTracks.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleFavoriteClick = async (audio: Audio, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onFavoriteToggle) {
      onFavoriteToggle(audio);
    }
  };

  const renderTrackList = (tracks: Audio[], title: string, icon: React.ReactNode, expanded: boolean, onToggle: () => void) => {
    if (tracks.length === 0) return null;

    return (
      <Box sx={{ mb: 2 }}>
        <ListItemButton onClick={onToggle} sx={{ px: 0, py: 1 }}>
          <ListItemAvatar>
            {icon}
          </ListItemAvatar>
          <ListItemText 
            primary={title}
            secondary={t('relatedTracks.trackCount', { count: tracks.length })}
            sx={{
              '& .MuiListItemText-primary': {
                fontSize: '0.95rem',
                fontWeight: 600
              },
              '& .MuiListItemText-secondary': {
                fontSize: '0.8rem'
              }
            }}
          />
          {expanded ? <ExpandLess /> : <ExpandMore />}
        </ListItemButton>
        
        <Collapse in={expanded}>
          <List dense disablePadding>
            {tracks.slice(0, compact ? 3 : 8).map((track) => (
              <ListItem key={track.id} disablePadding sx={{ gap: 0.5 }}>
                <ListItemButton
                  onClick={() => onTrackSelect(track)}
                  sx={{
                    py: 0.5,
                    flex: 1,
                    minWidth: 0,
                    '&:hover': {
                      bgcolor: 'rgba(255, 255, 255, 0.05)'
                    }
                  }}
                >
                  <ListItemAvatar>
                    <Avatar
                      src={track.thumbnail_url || undefined}
                      sx={{ width: 32, height: 32 }}
                    >
                      <MusicNote fontSize="small" />
                    </Avatar>
                  </ListItemAvatar>

                  <ListItemText
                    primary={track.title}
                    secondary={`${track.channel_name} • ${formatDuration(track.duration)}`}
                    sx={{
                      minWidth: 0,
                      '& .MuiListItemText-primary': {
                        fontSize: '0.85rem',
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      },
                      '& .MuiListItemText-secondary': {
                        fontSize: '0.75rem',
                        color: 'text.disabled'
                      }
                    }}
                  />
                </ListItemButton>

                {/* Action cluster as an in-flow sibling (replaces the absolutely-positioned
                    ListItemSecondaryAction) so it never overlaps the text and the buttons
                    are not nested inside the row button. */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0, pr: 1 }}>
                  {track.play_count > 0 && (
                    <Chip
                      label={track.play_count}
                      size="small"
                      sx={{
                        fontSize: '0.7rem',
                        height: 20,
                        bgcolor: 'rgba(25, 118, 210, 0.1)',
                        color: 'primary.main'
                      }}
                    />
                  )}

                  <Tooltip title={track.is_favorite ? t('relatedTracks.actions.removeFromFavorites') : t('relatedTracks.actions.addToFavorites')}>
                    <IconButton
                      size="small"
                      onClick={(e) => handleFavoriteClick(track, e)}
                      sx={{
                        color: track.is_favorite ? '#e91e63' : 'text.disabled',
                        '&:hover': { color: '#e91e63' }
                      }}
                    >
                      {track.is_favorite ?
                        <FavoriteIcon sx={{ fontSize: 16 }} /> :
                        <FavoriteBorderIcon sx={{ fontSize: 16 }} />
                      }
                    </IconButton>
                  </Tooltip>

                  <IconButton
                    size="small"
                    aria-label={t('relatedTracks.actions.play')}
                    onClick={(e) => {
                      e.stopPropagation();
                      onTrackSelect(track);
                    }}
                    sx={{ color: 'primary.main' }}
                  >
                    <PlayIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Box>
              </ListItem>
            ))}
          </List>
          
          {tracks.length > (compact ? 3 : 8) && (
            <Typography variant="caption" sx={{ px: 2, color: 'text.disabled' }}>
              {t('relatedTracks.moreTracks', { count: tracks.length - (compact ? 3 : 8) })}
            </Typography>
          )}
        </Collapse>
        
        {!expanded && <Divider sx={{ mt: 1 }} />}
      </Box>
    );
  };

  if (loading) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Recommend color="primary" />
          {t('relatedTracks.title')}
        </Typography>
        {Array.from({ length: 5 }).map((_, index) => (
          <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Skeleton variant="circular" width={32} height={32} />
            <Box sx={{ flex: 1 }}>
              <Skeleton variant="text" width="70%" />
              <Skeleton variant="text" width="40%" />
            </Box>
            <Skeleton variant="circular" width={24} height={24} />
          </Box>
        ))}
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Recommend color="primary" />
          {t('relatedTracks.title')}
        </Typography>
        <Alert severity="info" variant="outlined">
          {error}
        </Alert>
      </Box>
    );
  }

  if (recommendations.length === 0 && similarTracks.length === 0) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Recommend color="primary" />
          {t('relatedTracks.title')}
        </Typography>
        <Alert severity="info" variant="outlined">
          {t('relatedTracks.empty.description')}
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Recommend color="primary" />
        {t('relatedTracks.title')}
      </Typography>
      
      {algorithmInfo && !compact && (
        <Typography variant="caption" sx={{ color: 'text.secondary', mb: 2, display: 'block' }}>
          {t('relatedTracks.algorithmHint')}
        </Typography>
      )}
      
      {renderTrackList(
        recommendations,
        t('relatedTracks.sections.recommendedForYou'),
        <TrendingUp color="primary" sx={{ fontSize: 20 }} />,
        showRecommendations,
        () => setShowRecommendations(!showRecommendations)
      )}
      
      {renderTrackList(
        similarTracks,
        t('relatedTracks.sections.moreFrom', { channel: currentAudio.channel_name }),
        <History color="action" sx={{ fontSize: 20 }} />,
        showSimilar,
        () => setShowSimilar(!showSimilar)
      )}
    </Box>
  );
}