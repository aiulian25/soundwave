import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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
  Paper,
  Popper,
  Fade,
  ClickAwayListener,
  Divider,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import MusicNoteIcon from '@mui/icons-material/MusicNote';
import PlaylistPlayIcon from '@mui/icons-material/PlaylistPlay';
import YouTubeIcon from '@mui/icons-material/YouTube';
import HistoryIcon from '@mui/icons-material/History';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import ClearIcon from '@mui/icons-material/Clear';
import PersonIcon from '@mui/icons-material/Person';
import AlbumIcon from '@mui/icons-material/Album';
import { audioAPI, playlistAPI, channelAPI } from '../api/client';
import { fetchAllAudio, fetchAllPlaylists, fetchAllChannels } from '../utils/fetchAll';
import ScrollToTop from '../components/ScrollToTop';
import TrackActionsMenu from '../components/TrackActionsMenu';
import type { Audio } from '../types';

interface SearchPageProps {
  setCurrentAudio: (audio: Audio, queue?: Audio[]) => void;
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

interface QuickSuggestion {
  type: 'artist' | 'song' | 'recent' | 'popular';
  text: string;
  icon: React.ReactNode;
  audio?: Audio;
}

export default function SearchPage({ setCurrentAudio }: SearchPageProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [allAudio, setAllAudio] = useState<Audio[]>([]);
  const [popularSearches] = useState<string[]>([
    'hip hop', 'rock music', 'jazz', 'classical', 'electronic', 'blues'
  ]);
  
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  
  // Search results
  const [audioResults, setAudioResults] = useState<Audio[]>([]);
  const [playlistResults, setPlaylistResults] = useState<Playlist[]>([]);
  const [channelResults, setChannelResults] = useState<Channel[]>([]);
  
  // Load all audio for suggestions on mount
  useEffect(() => {
    const loadAudioForSuggestions = async () => {
      try {
        const allAudioData = await fetchAllAudio();
        setAllAudio(allAudioData);
      } catch (err) {
        console.error('Failed to load audio for suggestions:', err);
      }
    };
    loadAudioForSuggestions();
  }, []);
  
  // Load recent searches on component mount
  useEffect(() => {
    const stored = localStorage.getItem('soundwave_recent_searches');
    if (stored) {
      setRecentSearches(JSON.parse(stored));
    }
  }, []);
  
  // Save recent search
  const saveRecentSearch = (searchQuery: string) => {
    if (!searchQuery.trim()) return;
    
    const updated = [searchQuery, ...recentSearches.filter(s => s !== searchQuery)].slice(0, 10);
    setRecentSearches(updated);
    localStorage.setItem('soundwave_recent_searches', JSON.stringify(updated));
  };
  
  // Clear all recent searches
  const clearRecentSearches = () => {
    setRecentSearches([]);
    localStorage.removeItem('soundwave_recent_searches');
  };
  
  // Generate smart search suggestions
  const suggestions = useMemo((): QuickSuggestion[] => {
    const result: QuickSuggestion[] = [];
    const queryLower = query.toLowerCase().trim();
    
    if (!queryLower) {
      // Show recent searches when empty
      recentSearches.slice(0, 5).forEach(search => {
        result.push({
          type: 'recent',
          text: search,
          icon: <HistoryIcon fontSize="small" color="action" />
        });
      });
      
      // Add popular searches
      popularSearches.slice(0, 3).forEach(search => {
        result.push({
          type: 'popular',
          text: search,
          icon: <TrendingUpIcon fontSize="small" color="action" />
        });
      });
      
      return result;
    }
    
    // Get unique artists from audio library
    const artists = new Set<string>();
    const matchingSongs: Audio[] = [];
    
    allAudio.forEach(audio => {
      if (audio.channel_name) {
        artists.add(audio.channel_name);
      }
      // Check if song title matches
      if (audio.title?.toLowerCase().includes(queryLower)) {
        matchingSongs.push(audio);
      }
    });
    
    // Add matching artists (up to 3)
    const matchingArtists = Array.from(artists)
      .filter(artist => artist.toLowerCase().includes(queryLower))
      .slice(0, 3);
    
    matchingArtists.forEach(artist => {
      result.push({
        type: 'artist',
        text: artist,
        icon: <PersonIcon fontSize="small" color="primary" />
      });
    });
    
    // Add matching songs (up to 3)
    matchingSongs.slice(0, 3).forEach(audio => {
      result.push({
        type: 'song',
        text: audio.title,
        icon: <MusicNoteIcon fontSize="small" color="secondary" />,
        audio
      });
    });
    
    // Add matching recent searches
    recentSearches
      .filter(search => search.toLowerCase().includes(queryLower) && search.toLowerCase() !== queryLower)
      .slice(0, 2)
      .forEach(search => {
        result.push({
          type: 'recent',
          text: search,
          icon: <HistoryIcon fontSize="small" color="action" />
        });
      });
    
    // Add matching popular searches
    popularSearches
      .filter(search => search.toLowerCase().includes(queryLower) && search.toLowerCase() !== queryLower)
      .slice(0, 2)
      .forEach(search => {
        result.push({
          type: 'popular',
          text: search,
          icon: <TrendingUpIcon fontSize="small" color="action" />
        });
      });
    
    return result;
  }, [query, recentSearches, popularSearches, allAudio]);
  
  // Reset selection when suggestions change
  useEffect(() => {
    setSelectedSuggestionIndex(-1);
  }, [suggestions]);
  
  // Highlight matching text in suggestions
  const highlightMatch = (text: string, query: string) => {
    if (!query.trim()) return text;
    
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const index = lowerText.indexOf(lowerQuery);
    
    if (index === -1) return text;
    
    return (
      <>
        {text.slice(0, index)}
        <Box component="span" sx={{ fontWeight: 700, color: 'primary.main' }}>
          {text.slice(index, index + query.length)}
        </Box>
        {text.slice(index + query.length)}
      </>
    );
  };
  
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

  const performSearch = async (searchQuery: string = query) => {
    if (!searchQuery.trim()) return;

    // Save to recent searches
    saveRecentSearch(searchQuery.trim());
    setShowSuggestions(false);
    
    setLoading(true);
    try {
      const searchTerm = searchQuery.toLowerCase();

      // Search audio files - fetch all
      const allAudioData = await fetchAllAudio();
      
      const filteredAudio = allAudioData.filter((audio: Audio) =>
        audio.title?.toLowerCase().includes(searchTerm) ||
        audio.channel_name?.toLowerCase().includes(searchTerm)
      );
      setAudioResults(filteredAudio);
      
      // Also update allAudio for suggestions
      setAllAudio(allAudioData);

      // Search playlists - fetch all
      const allPlaylistData = await fetchAllPlaylists();
      const filteredPlaylists = allPlaylistData.filter((playlist: Playlist) =>
        playlist.title?.toLowerCase().includes(searchTerm) ||
        playlist.channel_name?.toLowerCase().includes(searchTerm)
      );
      setPlaylistResults(filteredPlaylists);

      // Search channels - fetch all
      const allChannelData = await fetchAllChannels();
      const filteredChannels = allChannelData.filter((channel: Channel) =>
        channel.channel_name?.toLowerCase().includes(searchTerm)
      );
      setChannelResults(filteredChannels);

    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setLoading(false);
    }
  };
  
  const handleSearchSubmit = (searchQuery: string) => {
    setQuery(searchQuery);
    performSearch(searchQuery);
  };
  
  const handleSuggestionClick = (suggestion: QuickSuggestion) => {
    if (suggestion.type === 'song' && suggestion.audio) {
      // Play the song directly with search results as queue
      setCurrentAudio(suggestion.audio, audioResults.length > 0 ? audioResults : [suggestion.audio]);
      setShowSuggestions(false);
      saveRecentSearch(suggestion.text);
    } else {
      // Search for the text
      handleSearchSubmit(suggestion.text);
    }
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) {
      if (e.key === 'Enter') {
        performSearch();
      }
      return;
    }
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedSuggestionIndex(prev => 
          prev < suggestions.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedSuggestionIndex(prev => prev > 0 ? prev - 1 : -1);
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedSuggestionIndex >= 0 && selectedSuggestionIndex < suggestions.length) {
          handleSuggestionClick(suggestions[selectedSuggestionIndex]);
        } else {
          performSearch();
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        setSelectedSuggestionIndex(-1);
        break;
    }
  };
  
  const handleInputFocus = () => {
    setShowSuggestions(true);
  };
  
  const handleClickAway = () => {
    setShowSuggestions(false);
    setSelectedSuggestionIndex(-1);
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

      {/* Search Input with Auto-complete */}
      <ClickAwayListener onClickAway={handleClickAway}>
        <Box sx={{ position: 'relative', maxWidth: 800, mb: 3 }}>
          <TextField
            ref={searchRef}
            inputRef={inputRef}
            fullWidth
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={handleInputFocus}
            onKeyDown={handleKeyDown}
            placeholder="Search for songs, artists, playlists, or channels..."
            variant="outlined"
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
              endAdornment: query && (
                <InputAdornment position="end">
                  <IconButton
                    onClick={() => {
                      setQuery('');
                      setAudioResults([]);
                      setPlaylistResults([]);
                      setChannelResults([]);
                    }}
                    size="small"
                  >
                    <ClearIcon />
                  </IconButton>
                </InputAdornment>
              ),
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: '9999px',
                bgcolor: 'rgba(255, 255, 255, 0.05)',
              },
            }}
          />
          
          {/* Auto-complete Dropdown */}
          <Popper
            open={showSuggestions && suggestions.length > 0}
            anchorEl={searchRef.current}
            placement="bottom-start"
            style={{ width: searchRef.current?.offsetWidth, zIndex: 1300 }}
            transition
          >
            {({ TransitionProps }) => (
              <Fade {...TransitionProps} timeout={200}>
                <Paper
                  elevation={8}
                  sx={{
                    mt: 1,
                    maxHeight: 400,
                    overflowY: 'auto',
                    bgcolor: 'background.paper',
                    border: '1px solid',
                    borderColor: 'divider',
                  }}
                >
                  {/* Clear button for recent searches */}
                  {!query.trim() && recentSearches.length > 0 && (
                    <Box sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <HistoryIcon fontSize="small" />
                        Recent searches
                      </Typography>
                      <Typography
                        variant="caption"
                        color="primary"
                        sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                        onClick={(e) => {
                          e.stopPropagation();
                          clearRecentSearches();
                        }}
                      >
                        Clear all
                      </Typography>
                    </Box>
                  )}
                  
                  {/* Grouped suggestions by type */}
                  {query.trim() && suggestions.some(s => s.type === 'artist') && (
                    <Box sx={{ px: 2, py: 0.5 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <PersonIcon fontSize="small" />
                        Artists
                      </Typography>
                    </Box>
                  )}
                  
                  {suggestions.map((suggestion, index) => {
                    // Add section headers when type changes
                    const prevSuggestion = index > 0 ? suggestions[index - 1] : null;
                    const showSongHeader = query.trim() && suggestion.type === 'song' && prevSuggestion?.type !== 'song';
                    const showRecentHeader = query.trim() && suggestion.type === 'recent' && prevSuggestion?.type !== 'recent';
                    const showPopularHeader = suggestion.type === 'popular' && prevSuggestion?.type !== 'popular';
                    
                    return (
                      <Box key={`suggestion-${index}`}>
                        {showSongHeader && (
                          <>
                            <Divider sx={{ my: 0.5 }} />
                            <Box sx={{ px: 2, py: 0.5 }}>
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <MusicNoteIcon fontSize="small" />
                                Songs
                              </Typography>
                            </Box>
                          </>
                        )}
                        {showRecentHeader && (
                          <>
                            <Divider sx={{ my: 0.5 }} />
                            <Box sx={{ px: 2, py: 0.5 }}>
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <HistoryIcon fontSize="small" />
                                Recent
                              </Typography>
                            </Box>
                          </>
                        )}
                        {showPopularHeader && (
                          <>
                            <Divider sx={{ my: 0.5 }} />
                            <Box sx={{ px: 2, py: 0.5 }}>
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <TrendingUpIcon fontSize="small" />
                                Popular
                              </Typography>
                            </Box>
                          </>
                        )}
                        <ListItemButton
                          onClick={() => handleSuggestionClick(suggestion)}
                          selected={index === selectedSuggestionIndex}
                          sx={{ 
                            py: 1,
                            '&.Mui-selected': {
                              bgcolor: 'action.selected',
                            },
                          }}
                        >
                          <ListItemAvatar sx={{ minWidth: 40 }}>
                            {suggestion.icon}
                          </ListItemAvatar>
                          <ListItemText 
                            primary={highlightMatch(suggestion.text, query)}
                            secondary={suggestion.type === 'song' && suggestion.audio?.channel_name}
                            primaryTypographyProps={{
                              sx: { 
                                fontWeight: index === selectedSuggestionIndex ? 600 : 400,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }
                            }}
                          />
                          {suggestion.type === 'song' && (
                            <PlayArrowIcon fontSize="small" color="action" sx={{ opacity: 0.5 }} />
                          )}
                        </ListItemButton>
                      </Box>
                    );
                  })}
                  
                  {suggestions.length === 0 && !query.trim() && (
                    <Box sx={{ p: 2, textAlign: 'center' }}>
                      <Typography variant="body2" color="text.secondary">
                        Start typing to search
                      </Typography>
                    </Box>
                  )}
                </Paper>
              </Fade>
            )}
          </Popper>
        </Box>
      </ClickAwayListener>

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
                              <Box sx={{ display: 'flex', gap: 0.5 }}>
                                <IconButton
                                  edge="end"
                                  onClick={() => setCurrentAudio(audio, audioResults)}
                                  disabled={!audio.file_path}
                                  sx={{ color: 'primary.main' }}
                                >
                                  <PlayArrowIcon />
                                </IconButton>
                                <TrackActionsMenu 
                                  track={audio}
                                  onTrackUpdate={(updatedTrack) => {
                                    setAudioResults(prev => prev.map(a => a.id === updatedTrack.id ? updatedTrack : a));
                                    setAllAudio(prev => prev.map(a => a.id === updatedTrack.id ? updatedTrack : a));
                                  }}
                                />
                              </Box>
                            }
                          >
                            <ListItemButton
                              onClick={() => setCurrentAudio(audio, audioResults)}
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
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          <IconButton
                            edge="end"
                            onClick={() => setCurrentAudio(audio, audioResults)}
                            disabled={!audio.file_path}
                            sx={{ color: 'primary.main' }}
                          >
                            <PlayArrowIcon />
                          </IconButton>
                          <TrackActionsMenu 
                            track={audio}
                            onTrackUpdate={(updatedTrack) => {
                              setAudioResults(prev => prev.map(a => a.id === updatedTrack.id ? updatedTrack : a));
                              setAllAudio(prev => prev.map(a => a.id === updatedTrack.id ? updatedTrack : a));
                            }}
                          />
                        </Box>
                      }
                    >
                      <ListItemButton
                        onClick={() => setCurrentAudio(audio, audioResults)}
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
      
      <ScrollToTop />
    </Box>
  );
}
