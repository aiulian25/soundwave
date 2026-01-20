import { Box, Typography, Grid, Card, CardMedia, CardContent, IconButton } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { audioAPI, playlistAPI } from '../api/client';
import type { Audio, Playlist } from '../types';

interface HomePageProps {
  setCurrentAudio: (audio: Audio) => void;
}

export default function HomePage({ setCurrentAudio }: HomePageProps) {
  const navigate = useNavigate();
  const [newAudio, setNewAudio] = useState<Audio[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);

  useEffect(() => {
    loadNewAudio();
    loadPlaylists();
  }, []);

  const loadNewAudio = async () => {
    try {
      // For recently added, we only need the first page sorted by download date
      const response = await audioAPI.list({ sort: 'downloaded', order: 'desc', page: 1 });
      const data = response.data?.data || response.data || [];
      setNewAudio(Array.isArray(data) ? data.slice(0, 3) : []);
    } catch (error) {
      console.error('Failed to load audio:', error);
      setNewAudio([]);
    }
  };

  const loadPlaylists = async () => {
    try {
      const response = await playlistAPI.list();
      const data = response.data?.data || response.data || [];
      setPlaylists(Array.isArray(data) ? data.slice(0, 3) : []);
    } catch (error) {
      console.error('Failed to load playlists:', error);
      setPlaylists([]);
    }
  };

  return (
    <Box>
      {/* Newly Added Songs */}
      <Box sx={{ mb: 6 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, px: 0.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
            Newly Added Songs
          </Typography>
          <Typography
            variant="body2"
            onClick={() => navigate('/library')}
            sx={{ color: 'primary.main', cursor: 'pointer', fontWeight: 500, '&:hover': { opacity: 0.8 } }}
          >
            See All
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', gap: 3, overflowX: 'auto', pb: 2, '&::-webkit-scrollbar': { height: 8 }, '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(255,255,255,0.1)', borderRadius: 1 } }}>
          {newAudio.map((audio) => (
            <Box
              key={audio.id}
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
              onClick={() => setCurrentAudio(audio)}
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
                    backgroundImage: `url(${audio.thumbnail_url || '/placeholder.jpg'})`,
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
              <Typography variant="body2" noWrap sx={{ fontWeight: 600, mb: 0.5 }}>
                {audio.title}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {audio.channel_name}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>

      {/* Your Playlists */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, px: 0.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
            Your Playlists
          </Typography>
          <Typography
            variant="body2"
            onClick={() => navigate('/playlists')}
            sx={{ color: 'primary.main', cursor: 'pointer', fontWeight: 500, '&:hover': { opacity: 0.8 } }}
          >
            See All
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {playlists.map((playlist) => (
            <Box
              key={playlist.id}
              onClick={() => navigate(`/playlists/${playlist.playlist_id}`)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                p: 1.5,
                borderRadius: 3,
                cursor: 'pointer',
                transition: 'background-color 0.3s ease',
                '&:hover': {
                  bgcolor: 'rgba(255, 255, 255, 0.05)',
                },
                '& .play-btn': {
                  opacity: 0,
                  transition: 'opacity 0.3s ease',
                },
                '&:hover .play-btn': {
                  opacity: 1,
                },
              }}
            >
              <Box
                sx={{
                  width: 56,
                  height: 56,
                  borderRadius: 2,
                  bgcolor: 'primary.main',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
                }}
              >
                <PlayArrowIcon sx={{ fontSize: 28, color: 'background.dark' }} />
              </Box>
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography variant="subtitle2" noWrap sx={{ fontWeight: 600, mb: 0.25 }}>
                  {playlist.title}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {playlist.item_count} Tracks
                </Typography>
              </Box>
              <IconButton
                className="play-btn"
                size="small"
                sx={{
                  width: 32,
                  height: 32,
                  border: '1px solid',
                  borderColor: 'rgba(255, 255, 255, 0.1)',
                }}
              >
                <PlayArrowIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
