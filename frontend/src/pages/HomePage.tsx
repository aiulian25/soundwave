import { Box, Typography, IconButton, LinearProgress, Chip, alpha, Tooltip, CircularProgress } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { statsAPI } from '../api/client';
import type { Audio } from '../types';

// Types for homepage data
interface ContinueListeningItem {
  id: number;
  youtube_id: string;
  title: string;
  artist: string;
  channel_name: string;
  duration: number;
  thumbnail_url: string;
  position: number;
  time_left: number;
  progress_percent: number;
  last_played: string;
}

interface RecommendationItem {
  id: number;
  youtube_id: string;
  title: string;
  artist: string;
  channel_name: string;
  duration: number;
  thumbnail_url: string;
  tag: 'FOR_YOU' | 'DISCOVER' | 'OTHER' | 'THROWBACK';
  reason: string;
}

interface RecentlyPlayedItem {
  id: number;
  youtube_id: string;
  title: string;
  artist: string;
  channel_name: string;
  duration: number;
  thumbnail_url: string;
  played_at: string;
}

interface RecentlyAddedItem {
  id: number;
  youtube_id: string;
  title: string;
  artist: string;
  channel_name: string;
  duration: number;
  thumbnail_url: string;
  downloaded_date: string;
}

interface HomepageData {
  continue_listening: ContinueListeningItem[];
  made_for_you: RecommendationItem[];
  recently_played: RecentlyPlayedItem[];
  recently_added: RecentlyAddedItem[];
}

interface HomePageProps {
  setCurrentAudio: (audio: Audio, queue?: Audio[]) => void;
}

// Tag color mapping
const tagColors: Record<string, { bg: string; text: string }> = {
  FOR_YOU: { bg: 'primary.main', text: 'background.paper' },
  DISCOVER: { bg: '#00C853', text: '#fff' },
  OTHER: { bg: '#2196F3', text: '#fff' },
  THROWBACK: { bg: '#FF5722', text: '#fff' },
};

// Tag display names
const tagLabels: Record<string, string> = {
  FOR_YOU: 'FOR YOU',
  DISCOVER: 'DISCOVER',
  OTHER: 'OTHER',
  THROWBACK: 'THROWBACK',
};

// Format time remaining
const formatTimeLeft = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${secs}s left`;
};

export default function HomePage({ setCurrentAudio }: HomePageProps) {
  const navigate = useNavigate();
  const [data, setData] = useState<HomepageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      
      const response = await statsAPI.homepage();
      setData(response.data);
    } catch (error) {
      console.error('Failed to load homepage data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleClearContinueListening = async () => {
    try {
      await statsAPI.clearContinueListening();
      loadData();
    } catch (error) {
      console.error('Failed to clear continue listening:', error);
    }
  };

  const handleRefreshRecommendations = () => {
    loadData(true);
  };

  // Play a Continue Listening track with resume position (5 seconds before saved position)
  const playContinueListening = (item: ContinueListeningItem, queue?: ContinueListeningItem[]) => {
    // Resume 5 seconds before where user stopped, but not less than 0
    const resumePosition = Math.max(0, item.position - 5);
    
    const audio: Audio & { _initialSeek?: number } = {
      id: item.id,
      youtube_id: item.youtube_id,
      title: item.title,
      artist: item.artist,
      channel_name: item.channel_name,
      duration: item.duration,
      thumbnail_url: item.thumbnail_url,
      file_size: 0,
      play_count: 0,
      _initialSeek: resumePosition,
    };
    
    const queueAudios = queue?.map(q => ({
      id: q.id,
      youtube_id: q.youtube_id,
      title: q.title,
      artist: q.artist,
      channel_name: q.channel_name,
      duration: q.duration,
      thumbnail_url: q.thumbnail_url,
      file_size: 0,
      play_count: 0,
    }));
    
    setCurrentAudio(audio as Audio, queueAudios);
  };

  const playTrack = (item: ContinueListeningItem | RecommendationItem | RecentlyPlayedItem | RecentlyAddedItem, queue?: any[]) => {
    const audio: Audio = {
      id: item.id,
      youtube_id: item.youtube_id,
      title: item.title,
      artist: item.artist,
      channel_name: item.channel_name,
      duration: item.duration,
      thumbnail_url: item.thumbnail_url,
      file_size: 0,
      play_count: 0,
    };
    setCurrentAudio(audio, queue?.map(q => ({
      id: q.id,
      youtube_id: q.youtube_id,
      title: q.title,
      artist: q.artist,
      channel_name: q.channel_name,
      duration: q.duration,
      thumbnail_url: q.thumbnail_url,
      file_size: 0,
      play_count: 0,
    })));
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ pb: 4 }}>
      {/* Continue Listening Section */}
      {data?.continue_listening && data.continue_listening.length > 0 && (
        <Box sx={{ mb: 5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, px: 0.5 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
              Continue Listening
            </Typography>
            <Typography
              variant="body2"
              onClick={handleClearContinueListening}
              sx={{ color: 'primary.main', cursor: 'pointer', fontWeight: 500, '&:hover': { opacity: 0.8 } }}
            >
              Clear
            </Typography>
          </Box>

          <Box sx={{ 
            display: 'flex', 
            gap: 2, 
            overflowX: 'auto', 
            pb: 2, 
            '&::-webkit-scrollbar': { height: 8 }, 
            '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(255,255,255,0.1)', borderRadius: 1 } 
          }}>
            {data.continue_listening.map((item) => (
              <Box
                key={item.youtube_id}
                onClick={() => playContinueListening(item, data.continue_listening)}
                sx={{
                  minWidth: 240,
                  maxWidth: 240,
                  p: 1.5,
                  borderRadius: 3,
                  bgcolor: (theme) => alpha(theme.palette.primary.main, 0.08),
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  transition: 'all 0.2s ease',
                  '&:hover': {
                    bgcolor: (theme) => alpha(theme.palette.primary.main, 0.15),
                    transform: 'translateY(-2px)',
                  },
                  '& .play-button': {
                    opacity: 0,
                    transition: 'opacity 0.2s ease',
                  },
                  '&:hover .play-button': {
                    opacity: 1,
                  },
                }}
              >
                <Box sx={{ position: 'relative', flexShrink: 0 }}>
                  <Box
                    sx={{
                      width: 56,
                      height: 56,
                      borderRadius: 2,
                      backgroundImage: `url(${item.thumbnail_url || '/placeholder.jpg'})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  />
                  <IconButton
                    className="play-button"
                    size="small"
                    sx={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                      bgcolor: 'primary.main',
                      color: 'background.paper',
                      width: 32,
                      height: 32,
                      '&:hover': { bgcolor: 'primary.dark' },
                    }}
                  >
                    <PlayArrowIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </Box>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap sx={{ fontWeight: 600, mb: 0.25 }}>
                    {item.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', mb: 0.5 }}>
                    {item.artist || item.channel_name}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <LinearProgress
                      variant="determinate"
                      value={item.progress_percent}
                      sx={{
                        flexGrow: 1,
                        height: 3,
                        borderRadius: 1,
                        bgcolor: 'rgba(255,255,255,0.1)',
                        '& .MuiLinearProgress-bar': {
                          bgcolor: 'primary.main',
                        },
                      }}
                    />
                    <Typography variant="caption" color="primary.main" sx={{ fontWeight: 500, whiteSpace: 'nowrap' }}>
                      {formatTimeLeft(item.time_left)}
                    </Typography>
                  </Box>
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Made For You Section */}
      {data?.made_for_you && data.made_for_you.length > 0 && (
        <Box sx={{ mb: 5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, px: 0.5 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
              Made For You
            </Typography>
            <Tooltip title="Refresh recommendations">
              <IconButton
                size="small"
                onClick={handleRefreshRecommendations}
                disabled={refreshing}
                sx={{ color: 'primary.main' }}
              >
                <RefreshIcon sx={{ fontSize: 20, animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
              </IconButton>
            </Tooltip>
          </Box>

          <Box sx={{ 
            display: 'flex', 
            gap: 3, 
            overflowX: 'auto', 
            pb: 2, 
            '&::-webkit-scrollbar': { height: 8 }, 
            '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(255,255,255,0.1)', borderRadius: 1 }
          }}>
            {data.made_for_you.map((item) => (
              <Box
                key={item.youtube_id}
                onClick={() => playTrack(item)}
                sx={{
                  minWidth: 160,
                  width: 160,
                  cursor: 'pointer',
                  '& .play-button': {
                    opacity: 0,
                    transform: 'translateY(8px)',
                  },
                  '&:hover .play-button': {
                    opacity: 1,
                    transform: 'translateY(0)',
                  },
                  '&:hover .card-image': {
                    transform: 'scale(1.05)',
                  },
                }}
              >
                <Box
                  sx={{
                    position: 'relative',
                    aspectRatio: '1',
                    borderRadius: 3,
                    overflow: 'hidden',
                    mb: 1.5,
                  }}
                >
                  {/* Tag Badge */}
                  <Chip
                    label={tagLabels[item.tag]}
                    size="small"
                    sx={{
                      position: 'absolute',
                      top: 8,
                      left: 8,
                      zIndex: 2,
                      height: 20,
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      bgcolor: tagColors[item.tag]?.bg || 'primary.main',
                      color: tagColors[item.tag]?.text || '#fff',
                      '& .MuiChip-label': { px: 1 },
                    }}
                  />
                  <Box
                    className="card-image"
                    sx={{
                      width: '100%',
                      height: '100%',
                      backgroundImage: `url(${item.thumbnail_url || '/placeholder.jpg'})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      transition: 'transform 0.5s ease',
                    }}
                  />
                  <Box
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      bgcolor: 'rgba(0, 0, 0, 0.2)',
                      transition: 'background-color 0.3s ease',
                      '&:hover': {
                        bgcolor: 'rgba(0, 0, 0, 0.4)',
                      },
                    }}
                  />
                  <IconButton
                    className="play-button"
                    sx={{
                      position: 'absolute',
                      bottom: 12,
                      right: 12,
                      width: 40,
                      height: 40,
                      bgcolor: 'primary.main',
                      color: 'background.dark',
                      transition: 'all 0.3s ease',
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                      '&:hover': {
                        bgcolor: 'primary.main',
                        transform: 'scale(1.1)',
                      },
                    }}
                  >
                    <PlayArrowIcon />
                  </IconButton>
                </Box>
                <Typography variant="body2" noWrap sx={{ fontWeight: 600, mb: 0.25 }}>
                  {item.title}
                </Typography>
                <Typography variant="caption" color="primary.main" noWrap sx={{ fontWeight: 500 }}>
                  {item.reason}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Recently Played Section */}
      {data?.recently_played && data.recently_played.length > 0 && (
        <Box sx={{ mb: 5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, px: 0.5 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
              Recently Played
            </Typography>
            <Typography
              variant="body2"
              onClick={() => navigate('/history')}
              sx={{ color: 'primary.main', cursor: 'pointer', fontWeight: 500, '&:hover': { opacity: 0.8 } }}
            >
              See All
            </Typography>
          </Box>

          <Box sx={{ 
            display: 'flex', 
            gap: 3, 
            overflowX: 'auto', 
            pb: 2, 
            '&::-webkit-scrollbar': { height: 8 }, 
            '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(255,255,255,0.1)', borderRadius: 1 }
          }}>
            {data.recently_played.map((item) => (
              <Box
                key={`${item.youtube_id}-${item.played_at}`}
                onClick={() => playTrack(item, data.recently_played)}
                sx={{
                  minWidth: 160,
                  width: 160,
                  cursor: 'pointer',
                  '& .play-button': {
                    opacity: 0,
                    transform: 'translateY(8px)',
                  },
                  '&:hover .play-button': {
                    opacity: 1,
                    transform: 'translateY(0)',
                  },
                  '&:hover .card-image': {
                    transform: 'scale(1.05)',
                  },
                }}
              >
                <Box
                  sx={{
                    position: 'relative',
                    aspectRatio: '1',
                    borderRadius: 3,
                    overflow: 'hidden',
                    mb: 1.5,
                  }}
                >
                  <Box
                    className="card-image"
                    sx={{
                      width: '100%',
                      height: '100%',
                      backgroundImage: `url(${item.thumbnail_url || '/placeholder.jpg'})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      transition: 'transform 0.5s ease',
                    }}
                  />
                  <Box
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      bgcolor: 'rgba(0, 0, 0, 0.2)',
                      transition: 'background-color 0.3s ease',
                    }}
                  />
                  <IconButton
                    className="play-button"
                    sx={{
                      position: 'absolute',
                      bottom: 12,
                      right: 12,
                      width: 40,
                      height: 40,
                      bgcolor: 'primary.main',
                      color: 'background.dark',
                      transition: 'all 0.3s ease',
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                      '&:hover': {
                        bgcolor: 'primary.main',
                        transform: 'scale(1.1)',
                      },
                    }}
                  >
                    <PlayArrowIcon />
                  </IconButton>
                </Box>
                <Typography variant="body2" noWrap sx={{ fontWeight: 600, mb: 0.5 }}>
                  {item.title}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {item.artist || item.channel_name}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Recently Added Section */}
      {data?.recently_added && data.recently_added.length > 0 && (
        <Box sx={{ mb: 5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, px: 0.5 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
              Recently Added
            </Typography>
            <Typography
              variant="body2"
              onClick={() => navigate('/library')}
              sx={{ color: 'primary.main', cursor: 'pointer', fontWeight: 500, '&:hover': { opacity: 0.8 } }}
            >
              See All
            </Typography>
          </Box>

          <Box sx={{ 
            display: 'flex', 
            gap: 3, 
            overflowX: 'auto', 
            pb: 2, 
            '&::-webkit-scrollbar': { height: 8 }, 
            '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(255,255,255,0.1)', borderRadius: 1 }
          }}>
            {data.recently_added.map((item) => (
              <Box
                key={item.youtube_id}
                onClick={() => playTrack(item, data.recently_added)}
                sx={{
                  minWidth: 160,
                  width: 160,
                  cursor: 'pointer',
                  '& .play-button': {
                    opacity: 0,
                    transform: 'translateY(8px)',
                  },
                  '&:hover .play-button': {
                    opacity: 1,
                    transform: 'translateY(0)',
                  },
                  '&:hover .card-image': {
                    transform: 'scale(1.05)',
                  },
                }}
              >
                <Box
                  sx={{
                    position: 'relative',
                    aspectRatio: '1',
                    borderRadius: 3,
                    overflow: 'hidden',
                    mb: 1.5,
                  }}
                >
                  <Box
                    className="card-image"
                    sx={{
                      width: '100%',
                      height: '100%',
                      backgroundImage: `url(${item.thumbnail_url || '/placeholder.jpg'})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      transition: 'transform 0.5s ease',
                    }}
                  />
                  <Box
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      bgcolor: 'rgba(0, 0, 0, 0.2)',
                      transition: 'background-color 0.3s ease',
                    }}
                  />
                  <IconButton
                    className="play-button"
                    sx={{
                      position: 'absolute',
                      bottom: 12,
                      right: 12,
                      width: 40,
                      height: 40,
                      bgcolor: 'primary.main',
                      color: 'background.dark',
                      transition: 'all 0.3s ease',
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                      '&:hover': {
                        bgcolor: 'primary.main',
                        transform: 'scale(1.1)',
                      },
                    }}
                  >
                    <PlayArrowIcon />
                  </IconButton>
                </Box>
                <Typography variant="body2" noWrap sx={{ fontWeight: 600, mb: 0.5 }}>
                  {item.title}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {item.artist || item.channel_name}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Empty State */}
      {!loading && data && 
        !data.continue_listening?.length && 
        !data.made_for_you?.length && 
        !data.recently_played?.length && 
        !data.recently_added?.length && (
        <Box sx={{ 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          justifyContent: 'center',
          py: 10,
          color: 'text.secondary'
        }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Welcome to Soundwave!
          </Typography>
          <Typography variant="body2">
            Start by downloading some music or exploring your library.
          </Typography>
        </Box>
      )}

      {/* CSS for refresh animation */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </Box>
  );
}
