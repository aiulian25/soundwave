import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  IconButton,
  CircularProgress,
  Alert,
  Button,
  Switch,
  FormControlLabel,
  Tabs,
  Tab,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Chip,
  TextField,
  InputAdornment,
  Collapse,
  Menu,
  MenuItem,
  ListItemIcon,
  useTheme,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import EditIcon from '@mui/icons-material/Edit';
import CloseIcon from '@mui/icons-material/Close';
import MusicNoteIcon from '@mui/icons-material/MusicNote';
import SearchIcon from '@mui/icons-material/Search';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import DownloadIcon from '@mui/icons-material/Download';
import TextSnippetIcon from '@mui/icons-material/TextSnippet';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import api from '../api/client';
import { offlineStorage } from '../utils/offlineStorage';
import { getLyricsColors, LyricsThemeColors, DEFAULT_VISUALIZER_THEME } from '../config/visualizerThemes';
import { useSettings } from '../context/SettingsContext';

interface LyricsData {
  audio_id: string;
  audio_title: string;
  synced_lyrics: string;
  plain_lyrics: string;
  is_instrumental: boolean;
  source: string;
  language: string;
  has_lyrics: boolean;
  is_synced: boolean;
  display_lyrics: string;
  fetch_attempted: boolean;
  fetch_attempts: number;
  last_error: string;
}

interface LyricsSuggestion {
  id: number;
  track_name: string;
  artist_name: string;
  album_name: string;
  duration: number;
  has_synced: boolean;
  has_plain: boolean;
  synced_lyrics: string;
  plain_lyrics: string;
  instrumental: boolean;
  language: string;
}

interface LyricsLine {
  time: number;
  text: string;
  endTime?: number; // When this line ends (next line starts)
}

interface LyricsPlayerProps {
  youtubeId: string;
  currentTime: number;
  onClose?: () => void;
  embedded?: boolean;
  onSeek?: (time: number) => void; // Optional callback to seek to a specific time
  visualizerTheme?: string; // Theme ID for lyrics colors (optional, falls back to settings)
  isLightMode?: boolean; // Whether the app is in light mode (optional, auto-detected)
}

export default function LyricsPlayer({ youtubeId, currentTime, onClose, embedded = false, onSeek, visualizerTheme, isLightMode }: LyricsPlayerProps) {
  // Get settings and theme for automatic detection
  const { settings } = useSettings();
  const muiTheme = useTheme();
  
  // Use passed props or fall back to settings/auto-detection
  const effectiveTheme = visualizerTheme || settings.visualizer_theme || DEFAULT_VISUALIZER_THEME;
  const effectiveLightMode = isLightMode !== undefined ? isLightMode : muiTheme.palette.mode === 'light';
  // Get the MUI theme's primary color to pass to getLyricsColors for 'theme' colorScheme
  const muiPrimaryColor = muiTheme.palette.primary.main;
  
  const [lyrics, setLyrics] = useState<LyricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [parsedLyrics, setParsedLyrics] = useState<LyricsLine[]>([]);
  const [currentLineIndex, setCurrentLineIndex] = useState(-1);
  const [lineProgress, setLineProgress] = useState(0); // Progress through current line (0-1)
  const [autoScroll, setAutoScroll] = useState(true);
  const [tabValue, setTabValue] = useState(0);
  
  // Get theme colors for lyrics (adapts to light/dark mode, visualizer theme, and app color theme)
  const themeColors = useMemo(() => {
    console.log('[LyricsPlayer] Getting colors - theme:', effectiveTheme, 'lightMode:', effectiveLightMode, 'muiColor:', muiPrimaryColor);
    return getLyricsColors(effectiveTheme, effectiveLightMode, muiPrimaryColor);
  }, [effectiveTheme, effectiveLightMode, muiPrimaryColor]);
  
  // Suggestions state
  const [suggestions, setSuggestions] = useState<LyricsSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [applyingId, setApplyingId] = useState<number | null>(null);
  
  // Edit mode - for finding different lyrics when already have some
  const [editMode, setEditMode] = useState(false);
  const [deleting, setDeleting] = useState(false);
  
  // Download menu state
  const [downloadMenuAnchor, setDownloadMenuAnchor] = useState<null | HTMLElement>(null);
  
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const currentLineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadLyrics();
  }, [youtubeId]);

  useEffect(() => {
    if (lyrics?.is_synced && parsedLyrics.length > 0) {
      updateCurrentLine();
    }
  }, [currentTime, parsedLyrics]);

  useEffect(() => {
    if (autoScroll && currentLineRef.current && lyricsContainerRef.current) {
      const container = lyricsContainerRef.current;
      const line = currentLineRef.current;
      const containerHeight = container.clientHeight;
      const lineTop = line.offsetTop;
      
      container.scrollTo({
        top: lineTop - containerHeight / 2 + line.clientHeight / 2,
        behavior: 'smooth',
      });
    }
  }, [currentLineIndex, autoScroll]);

  const loadLyrics = async () => {
    try {
      setLoading(true);
      setError('');
      
      // Check IndexedDB cache first (for offline mode) - with timeout to prevent hanging
      let cachedLyrics = null;
      try {
        const cachePromise = offlineStorage.getLyrics(youtubeId);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Cache timeout')), 2000)
        );
        cachedLyrics = await Promise.race([cachePromise, timeoutPromise]);
      } catch (cacheErr) {
        console.log('[Lyrics] Cache check failed or timed out:', cacheErr);
      }
      
      if (cachedLyrics) {
        console.log('[Lyrics] Loading from offline cache');
        setLyrics(cachedLyrics);
        if (cachedLyrics.is_synced) {
          const parsed = parseSyncedLyrics(cachedLyrics.synced_lyrics);
          setParsedLyrics(parsed);
        }
        setLoading(false);
        
        // If online, try to refresh in background (non-blocking)
        if (navigator.onLine) {
          api.get(`/audio/${youtubeId}/lyrics/`).then(response => {
            setLyrics(response.data);
            if (response.data.is_synced) {
              const parsed = parseSyncedLyrics(response.data.synced_lyrics);
              setParsedLyrics(parsed);
            }
            // Update cache (fire and forget)
            offlineStorage.saveLyrics(youtubeId, response.data).catch(() => {});
          }).catch(() => {});
        }
        return;
      }
      
      // No cache - fetch from API (requires online)
      if (!navigator.onLine) {
        setError('Lyrics not available offline');
        setLoading(false);
        return;
      }
      
      const response = await api.get(`/audio/${youtubeId}/lyrics/`);
      setLyrics(response.data);
      
      if (response.data.is_synced) {
        const parsed = parseSyncedLyrics(response.data.synced_lyrics);
        setParsedLyrics(parsed);
      }
      
      // Cache for offline use (fire and forget)
      offlineStorage.saveLyrics(youtubeId, response.data).catch(() => {});
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load lyrics');
    } finally {
      setLoading(false);
    }
  };

  const fetchLyrics = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await api.post(`/audio/${youtubeId}/lyrics/fetch/`, {
        force: true,
      });
      setLyrics(response.data);
      
      if (response.data.is_synced) {
        const parsed = parseSyncedLyrics(response.data.synced_lyrics);
        setParsedLyrics(parsed);
      }
      
      // If no lyrics found, auto-load suggestions
      if (!response.data.has_lyrics && !response.data.is_instrumental) {
        loadSuggestions();
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to fetch lyrics');
    } finally {
      setLoading(false);
    }
  };

  const loadSuggestions = async (query?: string) => {
    try {
      setSuggestionsLoading(true);
      const params = query ? `?q=${encodeURIComponent(query)}` : '';
      const response = await api.get(`/audio/${youtubeId}/lyrics/suggestions/${params}`);
      setSuggestions(response.data.suggestions || []);
      setShowSuggestions(true);
    } catch (err: any) {
      console.error('Failed to load suggestions:', err);
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const applySuggestion = async (suggestion: LyricsSuggestion) => {
    try {
      setApplyingId(suggestion.id);
      const response = await api.post(`/audio/${youtubeId}/lyrics/apply/`, {
        synced_lyrics: suggestion.synced_lyrics,
        plain_lyrics: suggestion.plain_lyrics,
        instrumental: suggestion.instrumental,
        language: suggestion.language,
        track_name: suggestion.track_name,
        artist_name: suggestion.artist_name,
      });
      setLyrics(response.data);
      
      if (response.data.is_synced) {
        const parsed = parseSyncedLyrics(response.data.synced_lyrics);
        setParsedLyrics(parsed);
      }
      
      setShowSuggestions(false);
      setSuggestions([]);
      setEditMode(false);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to apply lyrics');
    } finally {
      setApplyingId(null);
    }
  };

  const deleteLyrics = async () => {
    try {
      setDeleting(true);
      await api.delete(`/audio/${youtubeId}/lyrics/delete/`);
      // Reset to empty lyrics state
      setLyrics({
        audio_id: youtubeId,
        audio_title: lyrics?.audio_title || '',
        synced_lyrics: '',
        plain_lyrics: '',
        is_instrumental: false,
        source: '',
        language: '',
        has_lyrics: false,
        is_synced: false,
        display_lyrics: '',
        fetch_attempted: true,
        fetch_attempts: 0,
        last_error: '',
      });
      setParsedLyrics([]);
      setEditMode(false);
      // Auto-load suggestions after delete
      loadSuggestions();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete lyrics');
    } finally {
      setDeleting(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      loadSuggestions(searchQuery.trim());
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleDownload = async (format: 'lrc' | 'txt') => {
    setDownloadMenuAnchor(null);
    try {
      // Use axios to get the file with auth headers
      // Note: use 'type' param instead of 'format' to avoid DRF content negotiation conflict
      const response = await api.get(`/audio/${youtubeId}/lyrics/download/?type=${format}`, {
        responseType: 'blob',
      });
      
      // Create download link
      const blob = new Blob([response.data], { type: 'text/plain;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      // Get filename from Content-Disposition header or generate one
      const contentDisposition = response.headers['content-disposition'];
      let filename = `lyrics.${format}`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="(.+)"/);
        if (match) {
          filename = match[1];
        }
      }
      
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('Download failed:', err);
      setError(err.response?.data?.error || 'Failed to download lyrics');
    }
  };

  const parseSyncedLyrics = (syncedText: string): LyricsLine[] => {
    const lines: LyricsLine[] = [];
    const lrcLines = syncedText.split('\n');
    
    for (const line of lrcLines) {
      // Match timestamp format [mm:ss.xx]
      const match = line.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/);
      if (match) {
        const minutes = parseInt(match[1]);
        const seconds = parseInt(match[2]);
        const centiseconds = parseInt(match[3].padEnd(2, '0').substring(0, 2));
        const time = minutes * 60 + seconds + centiseconds / 100;
        const text = match[4].trim();
        
        if (text) {
          lines.push({ time, text });
        }
      }
    }
    
    // Sort and calculate end times
    const sorted = lines.sort((a, b) => a.time - b.time);
    for (let i = 0; i < sorted.length; i++) {
      if (i < sorted.length - 1) {
        sorted[i].endTime = sorted[i + 1].time;
      } else {
        // Last line - assume it lasts 5 seconds or until track ends
        sorted[i].endTime = sorted[i].time + 5;
      }
    }
    
    return sorted;
  };

  const updateCurrentLine = () => {
    let index = -1;
    for (let i = parsedLyrics.length - 1; i >= 0; i--) {
      if (currentTime >= parsedLyrics[i].time) {
        index = i;
        break;
      }
    }
    setCurrentLineIndex(index);
    
    // Calculate progress through current line for karaoke effect
    if (index >= 0 && index < parsedLyrics.length) {
      const line = parsedLyrics[index];
      const lineStart = line.time;
      const lineEnd = line.endTime || (index < parsedLyrics.length - 1 ? parsedLyrics[index + 1].time : lineStart + 5);
      const lineDuration = lineEnd - lineStart;
      
      if (lineDuration > 0) {
        const progress = Math.min(1, Math.max(0, (currentTime - lineStart) / lineDuration));
        setLineProgress(progress);
      } else {
        setLineProgress(1);
      }
    } else {
      setLineProgress(0);
    }
  };

  if (loading) {
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {onClose && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 1 }}>
            <IconButton size="small" onClick={onClose}>
              <CloseIcon />
            </IconButton>
          </Box>
        )}
        <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <CircularProgress />
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {onClose && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 1 }}>
            <IconButton size="small" onClick={onClose}>
              <CloseIcon />
            </IconButton>
          </Box>
        )}
        <Box sx={{ flex: 1, p: 2 }}>
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
          <Button variant="contained" onClick={fetchLyrics} startIcon={<RefreshIcon />}>
            Try Fetch Lyrics
          </Button>
        </Box>
      </Box>
    );
  }

  if (!lyrics) {
    return null;
  }

  if (lyrics.is_instrumental) {
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {onClose && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 1 }}>
            <IconButton size="small" onClick={onClose}>
              <CloseIcon />
            </IconButton>
          </Box>
        )}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 4 }}>
          <MusicNoteIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary">
            Instrumental Track
          </Typography>
        </Box>
      </Box>
    );
  }

  if (!lyrics.has_lyrics) {
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {onClose && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 1 }}>
            <IconButton size="small" onClick={onClose}>
              <CloseIcon />
            </IconButton>
          </Box>
        )}
        <Box sx={{ flex: 1, p: 2, overflow: 'auto' }}>
          <Alert severity="info" sx={{ mb: 2 }}>
            No lyrics found for this track
            {lyrics.fetch_attempted && ` (Attempted ${lyrics.fetch_attempts} times)`}
          </Alert>
          
          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            <Button variant="contained" onClick={fetchLyrics} startIcon={<RefreshIcon />} size="small">
              Retry Fetch
            </Button>
            <Button 
              variant="outlined" 
              onClick={() => loadSuggestions()} 
              startIcon={<SearchIcon />}
              size="small"
              disabled={suggestionsLoading}
            >
              {suggestionsLoading ? 'Searching...' : 'Find Suggestions'}
            </Button>
          </Box>

          {/* Search form */}
          <Box component="form" onSubmit={handleSearchSubmit} sx={{ mb: 2 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="Search by song title or artist..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: 'text.secondary' }} />
                  </InputAdornment>
                ),
                endAdornment: searchQuery && (
                  <InputAdornment position="end">
                    <Button type="submit" size="small" disabled={suggestionsLoading}>
                      Search
                    </Button>
                  </InputAdornment>
                ),
              }}
            />
          </Box>

          {/* Suggestions list */}
          {suggestions.length > 0 && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>
                Found {suggestions.length} suggestions:
              </Typography>
              <List dense sx={{ bgcolor: 'background.paper', borderRadius: 1 }}>
                {suggestions.map((suggestion) => (
                  <ListItem
                    key={suggestion.id}
                    sx={{
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                      '&:last-child': { borderBottom: 'none' },
                    }}
                  >
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            "{suggestion.track_name}"
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            by {suggestion.artist_name}
                          </Typography>
                        </Box>
                      }
                      secondary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                          {suggestion.has_synced && (
                            <Chip label="Synced" size="small" color="success" sx={{ height: 20 }} />
                          )}
                          {suggestion.has_plain && !suggestion.has_synced && (
                            <Chip label="Plain" size="small" sx={{ height: 20 }} />
                          )}
                          {suggestion.instrumental && (
                            <Chip label="Instrumental" size="small" color="info" sx={{ height: 20 }} />
                          )}
                          <Typography variant="caption" color="text.secondary">
                            {formatDuration(suggestion.duration)}
                          </Typography>
                          {suggestion.album_name && (
                            <Typography variant="caption" color="text.secondary">
                              • {suggestion.album_name}
                            </Typography>
                          )}
                        </Box>
                      }
                    />
                    <ListItemSecondaryAction>
                      <Button
                        size="small"
                        variant="contained"
                        color="primary"
                        onClick={() => applySuggestion(suggestion)}
                        disabled={applyingId === suggestion.id}
                        startIcon={applyingId === suggestion.id ? <CircularProgress size={16} /> : <CheckCircleIcon />}
                      >
                        {applyingId === suggestion.id ? 'Applying...' : 'Use'}
                      </Button>
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
            </Box>
          )}

          {suggestionsLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={32} />
            </Box>
          )}
        </Box>
      </Box>
    );
  }

  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.paper' }}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', px: 2, pt: 1 }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          Lyrics
        </Typography>
        
        {/* Find Different Lyrics button */}
        <IconButton 
          size="small" 
          onClick={() => {
            setEditMode(!editMode);
            if (!editMode && suggestions.length === 0) {
              loadSuggestions();
            }
          }}
          sx={{ mr: 1 }}
          title="Find different lyrics"
          color={editMode ? 'primary' : 'default'}
        >
          <SwapHorizIcon />
        </IconButton>
        
        {/* Download button */}
        <IconButton 
          size="small" 
          onClick={(e) => setDownloadMenuAnchor(e.currentTarget)}
          sx={{ mr: 1 }}
          title="Download lyrics"
        >
          <DownloadIcon />
        </IconButton>
        <Menu
          anchorEl={downloadMenuAnchor}
          open={Boolean(downloadMenuAnchor)}
          onClose={() => setDownloadMenuAnchor(null)}
        >
          {lyrics.is_synced && (
            <MenuItem onClick={() => handleDownload('lrc')}>
              <ListItemIcon>
                <MusicNoteIcon fontSize="small" />
              </ListItemIcon>
              Download .LRC (synced)
            </MenuItem>
          )}
          <MenuItem onClick={() => handleDownload('txt')}>
            <ListItemIcon>
              <TextSnippetIcon fontSize="small" />
            </ListItemIcon>
            Download .TXT (plain)
          </MenuItem>
        </Menu>
        
        <IconButton size="small" onClick={fetchLyrics} sx={{ mr: 1 }} title="Refresh lyrics">
          <RefreshIcon />
        </IconButton>
        
        {onClose && (
          <IconButton size="small" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        )}
      </Box>
      
      {/* Edit mode panel - Find different lyrics */}
      <Collapse in={editMode}>
        <Box sx={{ p: 2, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Typography variant="subtitle2" color="primary">
              Find Different Lyrics
            </Typography>
            <Button
              size="small"
              color="error"
              variant="outlined"
              startIcon={deleting ? <CircularProgress size={16} /> : <DeleteOutlineIcon />}
              onClick={deleteLyrics}
              disabled={deleting}
            >
              {deleting ? 'Clearing...' : 'Clear & Search'}
            </Button>
          </Box>
          
          {/* Search form */}
          <Box component="form" onSubmit={handleSearchSubmit} sx={{ mb: 2 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="Search by song title or artist..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: 'text.secondary' }} />
                  </InputAdornment>
                ),
                endAdornment: (
                  <InputAdornment position="end">
                    <Button type="submit" size="small" disabled={suggestionsLoading}>
                      {suggestionsLoading ? 'Searching...' : 'Search'}
                    </Button>
                  </InputAdornment>
                ),
              }}
            />
          </Box>
          
          {/* Suggestions list */}
          {suggestionsLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress size={24} />
            </Box>
          )}
          
          {!suggestionsLoading && suggestions.length > 0 && (
            <Box sx={{ maxHeight: 250, overflow: 'auto' }}>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                {suggestions.length} suggestions found - select one to replace current lyrics:
              </Typography>
              <List dense sx={{ bgcolor: 'background.paper', borderRadius: 1 }}>
                {suggestions.map((suggestion) => (
                  <ListItem
                    key={suggestion.id}
                    sx={{
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                      '&:last-child': { borderBottom: 'none' },
                    }}
                  >
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            "{suggestion.track_name}"
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            by {suggestion.artist_name}
                          </Typography>
                        </Box>
                      }
                      secondary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                          {suggestion.has_synced && (
                            <Chip label="Synced" size="small" color="success" sx={{ height: 20 }} />
                          )}
                          {suggestion.has_plain && !suggestion.has_synced && (
                            <Chip label="Plain" size="small" sx={{ height: 20 }} />
                          )}
                          {suggestion.instrumental && (
                            <Chip label="Instrumental" size="small" color="info" sx={{ height: 20 }} />
                          )}
                          <Typography variant="caption" color="text.secondary">
                            {formatDuration(suggestion.duration)}
                          </Typography>
                        </Box>
                      }
                    />
                    <ListItemSecondaryAction>
                      <Button
                        size="small"
                        variant="contained"
                        color="primary"
                        onClick={() => applySuggestion(suggestion)}
                        disabled={applyingId === suggestion.id}
                        startIcon={applyingId === suggestion.id ? <CircularProgress size={16} /> : <CheckCircleIcon />}
                      >
                        {applyingId === suggestion.id ? 'Applying...' : 'Use'}
                      </Button>
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
            </Box>
          )}
          
          {!suggestionsLoading && suggestions.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
              No suggestions loaded yet. Enter a search term or click Search to find lyrics.
            </Typography>
          )}
        </Box>
      </Collapse>

      {lyrics.is_synced && (
        <Box sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="caption" color="text.secondary">
            Source: {lyrics.source} {lyrics.language && `• ${lyrics.language}`}
          </Typography>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
              />
            }
            label={<Typography variant="caption">Auto-scroll</Typography>}
          />
        </Box>
      )}

      {lyrics.is_synced && lyrics.plain_lyrics && (
        <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)} sx={{ px: 2, minHeight: 40 }}>
          <Tab label="Synced" sx={{ minHeight: 40, py: 0.5 }} />
          <Tab label="Plain Text" sx={{ minHeight: 40, py: 0.5 }} />
        </Tabs>
      )}

      <CardContent
        ref={lyricsContainerRef}
        sx={{
          flexGrow: 1,
          overflow: 'auto',
          background: `linear-gradient(180deg, transparent 0%, ${themeColors.background} 50%, transparent 100%)`,
          '&::-webkit-scrollbar': {
            width: '6px',
          },
          '&::-webkit-scrollbar-track': {
            backgroundColor: 'rgba(255,255,255,0.05)',
            borderRadius: '3px',
          },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: themeColors.glow,
            borderRadius: '3px',
            '&:hover': {
              backgroundColor: themeColors.primary,
            },
          },
        }}
      >
        {tabValue === 0 && lyrics.is_synced ? (
          // Synced lyrics display with karaoke highlighting
          <Box sx={{ py: 2 }}>
            {parsedLyrics.map((line, index) => {
              const isCurrentLine = index === currentLineIndex;
              const isPastLine = index < currentLineIndex;
              const isNextLine = index === currentLineIndex + 1;
              const isUpcoming = index > currentLineIndex && index <= currentLineIndex + 2;
              
              return (
                <Box
                  key={index}
                  ref={isCurrentLine ? currentLineRef : null}
                  onClick={() => onSeek?.(line.time)}
                  sx={{
                    py: 1.5,
                    px: 2,
                    my: 0.5,
                    borderRadius: 2,
                    cursor: onSeek ? 'pointer' : 'default',
                    transition: 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
                    backgroundColor: isCurrentLine 
                      ? themeColors.background 
                      : 'transparent',
                    transform: isCurrentLine ? 'scale(1.03)' : 'scale(1)',
                    boxShadow: isCurrentLine 
                      ? `0 4px 20px ${themeColors.glow}, inset 0 0 20px ${themeColors.glow}` 
                      : 'none',
                    borderLeft: isCurrentLine 
                      ? `3px solid ${themeColors.primary}` 
                      : '3px solid transparent',
                    '&:hover': onSeek ? {
                      backgroundColor: isCurrentLine 
                        ? themeColors.backgroundHover 
                        : themeColors.hoverBackground,
                      transform: isCurrentLine ? 'scale(1.03)' : 'scale(1.01)',
                    } : {},
                  }}
                >
                  {isCurrentLine ? (
                    // Full line highlighting for current line with theme-colored gradient
                    <Box sx={{ position: 'relative', overflow: 'hidden' }}>
                      {/* Fully highlighted current line */}
                      <Typography
                        variant="body1"
                        sx={{
                          fontSize: '1.3rem',
                          fontWeight: 700,
                          lineHeight: 1.6,
                          letterSpacing: '0.02em',
                          background: `linear-gradient(135deg, ${themeColors.gradientStart} 0%, ${themeColors.gradientMid} 50%, ${themeColors.gradientEnd} 100%)`,
                          backgroundClip: 'text',
                          WebkitBackgroundClip: 'text',
                          WebkitTextFillColor: 'transparent',
                          filter: `drop-shadow(0 0 8px ${themeColors.glow})`,
                          animation: 'lyricsPulse 2s ease-in-out infinite',
                          '@keyframes lyricsPulse': {
                            '0%, 100%': { filter: `drop-shadow(0 0 8px ${themeColors.glow})` },
                            '50%': { filter: `drop-shadow(0 0 15px ${themeColors.glow})` },
                          },
                        }}
                      >
                        {line.text}
                      </Typography>
                      
                      {/* Progress bar under the line */}
                      <Box
                        sx={{
                          position: 'absolute',
                          bottom: -6,
                          left: 0,
                          height: 3,
                          borderRadius: 1.5,
                          background: `linear-gradient(90deg, ${themeColors.gradientStart}, ${themeColors.gradientMid}, ${themeColors.gradientEnd})`,
                          width: `${lineProgress * 100}%`,
                          transition: 'width 0.1s linear',
                          boxShadow: `0 0 12px ${themeColors.glow}, 0 0 4px ${themeColors.primary}`,
                        }}
                      />
                    </Box>
                  ) : (
                    // Non-current lines - use theme-aware colors with smooth transitions
                    <Typography
                      variant="body1"
                      sx={{
                        fontSize: isNextLine ? '1.15rem' : '1rem',
                        fontWeight: isPastLine ? 400 : isNextLine ? 500 : 400,
                        lineHeight: 1.6,
                        color: isPastLine 
                          ? themeColors.pastTextColor 
                          : isUpcoming 
                            ? themeColors.upcomingTextColor 
                            : themeColors.textColor,
                        transition: 'all 0.35s ease',
                        // Subtle theme color tint for next line
                        ...(isNextLine && {
                          textShadow: `0 0 20px ${themeColors.glow}`,
                        }),
                      }}
                    >
                      {line.text}
                    </Typography>
                  )}
                </Box>
              );
            })}
          </Box>
        ) : (
          // Plain text lyrics display
          <Box sx={{ px: 1 }}>
            {lyrics.plain_lyrics.split('\n').map((line, index) => (
              <Typography
                key={index}
                variant="body1"
                sx={{
                  py: 0.5,
                  lineHeight: 1.8,
                  color: 'text.primary',
                }}
              >
                {line || '\u00A0'}
              </Typography>
            ))}
          </Box>
        )}
      </CardContent>

      {lyrics.last_error && (
        <Alert severity="warning" sx={{ m: 2, mt: 0 }}>
          Last fetch error: {lyrics.last_error}
        </Alert>
      )}
    </Card>
  );
}
