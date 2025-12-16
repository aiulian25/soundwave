import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  TextField,
  InputAdornment,
  Tabs,
  Tab,
  Card,
  CardContent,
  CardMedia,
  Grid,
  CircularProgress,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemAvatar,
  Avatar,
  ListItemText,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import MusicNoteIcon from '@mui/icons-material/MusicNote';
import PlaylistPlayIcon from '@mui/icons-material/PlaylistPlay';
import YouTubeIcon from '@mui/icons-material/YouTube';
import { audioAPI, playlistAPI, channelAPI } from '../api/client';
import type { Audio } from '../types';

interface SearchPageProps {
  setCurrentAudio: (audio: Audio) => void;
}

interface Playlist {
  id: number;
  playlist_id: string;
  title: string;
  channel_name: string;
  thumbnail_url: string;
  item_count: number;
  downloaded_count: number;
}

interface Channel {
  id: number;
  channel_id: string;
  channel_name: string;
  thumbnail_url: string;
  subscribed: boolean;
}

export default function SearchPage({ setCurrentAudio }: SearchPageProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(false);
  
  // Search results
  const [audioResults, setAudioResults] = useState<Audio[]>([]);
  const [playlistResults, setPlaylistResults] = useState<Playlist[]>([]);
  const [channelResults, setChannelResults] = useState<Channel[]>([]);
  
  // Debounce search
  useEffect(() => {
    if (!query.trim()) {
      setAudioResults([]);
      setPlaylistResults([]);
      setChannelResults([]);
      return;
    }

    const timer = setTimeout(() => {
      performSearch();
    }, 500);

    return () => clearTimeout(timer);
  }, [query]);

  const performSearch = async () => {
    if (!query.trim()) return;

    setLoading(true);
    try {
      const searchTerm = query.toLowerCase();

      // Search audio files
      const audioResponse = await audioAPI.list();
      const audioData = audioResponse.data?.data || audioResponse.data || [];
      const filteredAudio = (Array.isArray(audioData) ? audioData : []).filter((audio: Audio) =>
        audio.title?.toLowerCase().includes(searchTerm) ||
        audio.channel_name?.toLowerCase().includes(searchTerm)
      );
      setAudioResults(filteredAudio);

      // Search playlists
      const playlistResponse = await playlistAPI.list();
      const playlistData = playlistResponse.data?.data || playlistResponse.data || [];
      const filteredPlaylists = (Array.isArray(playlistData) ? playlistData : []).filter((playlist: Playlist) =>
        playlist.title?.toLowerCase().includes(searchTerm) ||
        playlist.channel_name?.toLowerCase().includes(searchTerm)
      );
      setPlaylistResults(filteredPlaylists);

      // Search channels
      const channelResponse = await channelAPI.list();
      const channelData = channelResponse.data?.data || channelResponse.data || [];
      const filteredChannels = (Array.isArray(channelData) ? channelData : []).filter((channel: Channel) =>
        channel.channel_name?.toLowerCase().includes(searchTerm)
      );
      setChannelResults(filteredChannels);

    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const totalResults = audioResults.length + playlistResults.length + channelResults.length;

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 3, fontWeight: 700, letterSpacing: '-0.02em' }}>
        Search
      </Typography>

      {/* Search Input */}
      <TextField
        fullWidth
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search for songs, artists, playlists, or channels..."
        variant="outlined"
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon />
            </InputAdornment>
          ),
        }}
        sx={{
          mb: 3,
          maxWidth: 800,
          '& .MuiOutlinedInput-root': {
            borderRadius: '9999px',
            bgcolor: 'rgba(255, 255, 255, 0.05)',
          },
        }}
      />

      {/* Results Tabs */}
      {query && (
        <>
          <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
            <Tabs value={activeTab} onChange={(_, val) => setActiveTab(val)}>
              <Tab
                label={`All (${totalResults})`}
                sx={{ textTransform: 'none', fontWeight: 600 }}
              />
              <Tab
                label={`Songs (${audioResults.length})`}
                sx={{ textTransform: 'none', fontWeight: 600 }}
              />
              <Tab
                label={`Playlists (${playlistResults.length})`}
                sx={{ textTransform: 'none', fontWeight: 600 }}
              />
              <Tab
                label={`Channels (${channelResults.length})`}
                sx={{ textTransform: 'none', fontWeight: 600 }}
              />
            </Tabs>
          </Box>

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
              <CircularProgress />
            </Box>
          ) : totalResults === 0 ? (
            <Box sx={{ textAlign: 'center', py: 8 }}>
              <SearchIcon sx={{ fontSize: 64, color: 'text.secondary', opacity: 0.3, mb: 2 }} />
              <Typography variant="h6" color="text.secondary">
                No results found
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Try searching with different keywords
              </Typography>
            </Box>
          ) : (
            <Box>
              {/* All Tab */}
              {activeTab === 0 && (
                <Box>
                  {audioResults.length > 0 && (
                    <Box sx={{ mb: 4 }}>
                      <Typography variant="h6" sx={{ mb: 2, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
                        <MusicNoteIcon /> Songs
                      </Typography>
                      <List>
                        {audioResults.slice(0, 5).map((audio) => (
                          <ListItem
                            key={audio.id}
                            disablePadding
                            secondaryAction={
                              <IconButton
                                edge="end"
                                onClick={() => setCurrentAudio(audio)}
                                disabled={!audio.file_path}
                                sx={{ color: 'primary.main' }}
                              >
                                <PlayArrowIcon />
                              </IconButton>
                            }
                          >
                            <ListItemButton
                              onClick={() => setCurrentAudio(audio)}
                              disabled={!audio.file_path}
                            >
                              <ListItemAvatar>
                                <Avatar
                                  src={audio.thumbnail_url}
                                  variant="rounded"
                                  sx={{ width: 56, height: 56 }}
                                >
                                  <MusicNoteIcon />
                                </Avatar>
                              </ListItemAvatar>
                              <ListItemText
                                primary={audio.title}
                                secondary={`${audio.channel_name} • ${formatDuration(audio.duration)}`}
                                primaryTypographyProps={{ fontWeight: 500 }}
                              />
                              {!audio.file_path && (
                                <Chip label="Not Downloaded" size="small" color="warning" sx={{ mr: 2 }} />
                              )}
                            </ListItemButton>
                          </ListItem>
                        ))}
                      </List>
                    </Box>
                  )}

                  {playlistResults.length > 0 && (
                    <Box sx={{ mb: 4 }}>
                      <Typography variant="h6" sx={{ mb: 2, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
                        <PlaylistPlayIcon /> Playlists
                      </Typography>
                      <Grid container spacing={2}>
                        {playlistResults.slice(0, 4).map((playlist) => (
                          <Grid item xs={12} sm={6} md={3} key={playlist.id}>
                            <Card
                              onClick={() => navigate(`/playlists/${playlist.playlist_id}`)}
                              sx={{
                                cursor: 'pointer',
                                transition: 'transform 0.2s',
                                '&:hover': { transform: 'translateY(-4px)' },
                              }}
                            >
                              <CardMedia
                                component="img"
                                height="160"
                                image={playlist.thumbnail_url}
                                alt={playlist.title}
                              />
                              <CardContent>
                                <Typography variant="body2" fontWeight={600} noWrap>
                                  {playlist.title}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" noWrap>
                                  {playlist.downloaded_count}/{playlist.item_count} tracks
                                </Typography>
                              </CardContent>
                            </Card>
                          </Grid>
                        ))}
                      </Grid>
                    </Box>
                  )}

                  {channelResults.length > 0 && (
                    <Box sx={{ mb: 4 }}>
                      <Typography variant="h6" sx={{ mb: 2, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
                        <YouTubeIcon /> Channels
                      </Typography>
                      <List>
                        {channelResults.slice(0, 5).map((channel) => (
                          <ListItem key={channel.id} disablePadding>
                            <ListItemButton onClick={() => navigate('/channels')}>
                              <ListItemAvatar>
                                <Avatar src={channel.thumbnail_url}>
                                  <YouTubeIcon />
                                </Avatar>
                              </ListItemAvatar>
                              <ListItemText
                                primary={channel.channel_name}
                                secondary={channel.subscribed ? 'Subscribed' : 'Not subscribed'}
                                primaryTypographyProps={{ fontWeight: 500 }}
                              />
                            </ListItemButton>
                          </ListItem>
                        ))}
                      </List>
                    </Box>
                  )}
                </Box>
              )}

              {/* Songs Tab */}
              {activeTab === 1 && (
                <List>
                  {audioResults.map((audio) => (
                    <ListItem
                      key={audio.id}
                      disablePadding
                      secondaryAction={
                        <IconButton
                          edge="end"
                          onClick={() => setCurrentAudio(audio)}
                          disabled={!audio.file_path}
                          sx={{ color: 'primary.main' }}
                        >
                          <PlayArrowIcon />
                        </IconButton>
                      }
                    >
                      <ListItemButton
                        onClick={() => setCurrentAudio(audio)}
                        disabled={!audio.file_path}
                      >
                        <ListItemAvatar>
                          <Avatar
                            src={audio.thumbnail_url}
                            variant="rounded"
                            sx={{ width: 56, height: 56 }}
                          >
                            <MusicNoteIcon />
                          </Avatar>
                        </ListItemAvatar>
                        <ListItemText
                          primary={audio.title}
                          secondary={`${audio.channel_name} • ${formatDuration(audio.duration)}`}
                          primaryTypographyProps={{ fontWeight: 500 }}
                        />
                        {!audio.file_path && (
                          <Chip label="Not Downloaded" size="small" color="warning" sx={{ mr: 2 }} />
                        )}
                      </ListItemButton>
                    </ListItem>
                  ))}
                </List>
              )}

              {/* Playlists Tab */}
              {activeTab === 2 && (
                <Grid container spacing={2}>
                  {playlistResults.map((playlist) => (
                    <Grid item xs={12} sm={6} md={3} key={playlist.id}>
                      <Card
                        onClick={() => navigate(`/playlists/${playlist.playlist_id}`)}
                        sx={{
                          cursor: 'pointer',
                          transition: 'transform 0.2s',
                          '&:hover': { transform: 'translateY(-4px)' },
                        }}
                      >
                        <CardMedia
                          component="img"
                          height="160"
                          image={playlist.thumbnail_url}
                          alt={playlist.title}
                        />
                        <CardContent>
                          <Typography variant="body2" fontWeight={600} noWrap>
                            {playlist.title}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {playlist.channel_name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" display="block">
                            {playlist.downloaded_count}/{playlist.item_count} tracks
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                  ))}
                </Grid>
              )}

              {/* Channels Tab */}
              {activeTab === 3 && (
                <List>
                  {channelResults.map((channel) => (
                    <ListItem key={channel.id} disablePadding>
                      <ListItemButton onClick={() => navigate('/channels')}>
                        <ListItemAvatar>
                          <Avatar src={channel.thumbnail_url} sx={{ width: 56, height: 56 }}>
                            <YouTubeIcon />
                          </Avatar>
                        </ListItemAvatar>
                        <ListItemText
                          primary={channel.channel_name}
                          secondary={channel.subscribed ? 'Subscribed' : 'Not subscribed'}
                          primaryTypographyProps={{ fontWeight: 500, fontSize: '1rem' }}
                        />
                        {channel.subscribed && (
                          <Chip label="Subscribed" size="small" color="success" />
                        )}
                      </ListItemButton>
                    </ListItem>
                  ))}
                </List>
              )}
            </Box>
          )}
        </>
      )}

      {/* Empty State */}
      {!query && (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <SearchIcon sx={{ fontSize: 80, color: 'text.secondary', opacity: 0.3, mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            Search Your Library
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Find songs, playlists, and channels in your collection
          </Typography>
        </Box>
      )}
    </Box>
  );
}
