import { useState, useEffect, useRef } from 'react';
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
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import EditIcon from '@mui/icons-material/Edit';
import CloseIcon from '@mui/icons-material/Close';
import MusicNoteIcon from '@mui/icons-material/MusicNote';
import api from '../api/client';

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

interface LyricsLine {
  time: number;
  text: string;
}

interface LyricsPlayerProps {
  youtubeId: string;
  currentTime: number;
  onClose?: () => void;
  embedded?: boolean;
}

export default function LyricsPlayer({ youtubeId, currentTime, onClose, embedded = false }: LyricsPlayerProps) {
  const [lyrics, setLyrics] = useState<LyricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [parsedLyrics, setParsedLyrics] = useState<LyricsLine[]>([]);
  const [currentLineIndex, setCurrentLineIndex] = useState(-1);
  const [autoScroll, setAutoScroll] = useState(true);
  const [tabValue, setTabValue] = useState(0);
  
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
      const response = await api.get(`/audio/${youtubeId}/lyrics/`);
      setLyrics(response.data);
      
      if (response.data.is_synced) {
        const parsed = parseSyncedLyrics(response.data.synced_lyrics);
        setParsedLyrics(parsed);
      }
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
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to fetch lyrics');
    } finally {
      setLoading(false);
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
    
    return lines.sort((a, b) => a.time - b.time);
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
        <Box sx={{ flex: 1, p: 2 }}>
          <Alert severity="info" sx={{ mb: 2 }}>
            No lyrics available for this track
            {lyrics.fetch_attempted && ` (Attempted ${lyrics.fetch_attempts} times)`}
          </Alert>
          <Button variant="contained" onClick={fetchLyrics} startIcon={<RefreshIcon />}>
            Fetch Lyrics
          </Button>
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
        
        <IconButton size="small" onClick={fetchLyrics} sx={{ mr: 1 }}>
          <RefreshIcon />
        </IconButton>
        
        {onClose && (
          <IconButton size="small" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        )}
      </Box>

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
          '&::-webkit-scrollbar': {
            width: '8px',
          },
          '&::-webkit-scrollbar-track': {
            backgroundColor: 'rgba(0,0,0,0.1)',
          },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: 'rgba(0,0,0,0.3)',
            borderRadius: '4px',
          },
        }}
      >
        {tabValue === 0 && lyrics.is_synced ? (
          // Synced lyrics display
          <Box>
            {parsedLyrics.map((line, index) => (
              <Box
                key={index}
                ref={index === currentLineIndex ? currentLineRef : null}
                sx={{
                  py: 1.5,
                  px: 2,
                  borderRadius: 1,
                  transition: 'all 0.3s ease',
                  backgroundColor: index === currentLineIndex ? 'primary.main' : 'transparent',
                  color: index === currentLineIndex ? 'primary.contrastText' : 'text.primary',
                  opacity: index === currentLineIndex ? 1 : 0.5,
                  transform: index === currentLineIndex ? 'scale(1.02)' : 'scale(1)',
                  fontWeight: index === currentLineIndex ? 600 : 400,
                }}
              >
                <Typography
                  variant="body1"
                  sx={{
                    fontSize: index === currentLineIndex ? '1.1rem' : '1rem',
                    lineHeight: 1.6,
                  }}
                >
                  {line.text}
                </Typography>
              </Box>
            ))}
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
