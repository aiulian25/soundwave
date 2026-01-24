import { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Typography,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  CircularProgress,
  Chip,
  Alert,
  Divider,
  Tooltip,
  LinearProgress,
} from '@mui/material';
import {
  Search as SearchIcon,
  AutoAwesome as AutoIcon,
  Check as CheckIcon,
  Edit as EditIcon,
  Album as AlbumIcon,
  Person as PersonIcon,
  CalendarMonth as CalendarIcon,
  MusicNote as MusicIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { audioAPI } from '../api/client';
import type { Audio } from '../types';

interface MetadataResult {
  title: string | null;
  artist: string | null;
  album: string | null;
  year: number | null;
  genre: string | null;
  track_number: number | null;
  cover_art_url: string | null;
  musicbrainz_id: string | null;
  source: string;
  confidence: number;
}

interface MetadataEditorProps {
  audio: Audio;
  open: boolean;
  onClose: () => void;
  onUpdate?: (updatedAudio: Audio) => void;
}

export default function MetadataEditor({ audio, open, onClose, onUpdate }: MetadataEditorProps) {
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<MetadataResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Manual edit fields
  const [editMode, setEditMode] = useState(false);
  const [artist, setArtist] = useState(audio.artist || '');
  const [album, setAlbum] = useState(audio.album || '');
  const [year, setYear] = useState<string>(audio.year?.toString() || '');
  const [genre, setGenre] = useState(audio.genre || '');
  
  // Search parameters
  const [searchTitle, setSearchTitle] = useState(audio.title);
  const [searchArtist, setSearchArtist] = useState(audio.artist || audio.channel_name || '');

  useEffect(() => {
    if (open) {
      setArtist(audio.artist || '');
      setAlbum(audio.album || '');
      setYear(audio.year?.toString() || '');
      setGenre(audio.genre || '');
      setSearchTitle(audio.title);
      setSearchArtist(audio.artist || audio.channel_name || '');
      setResults([]);
      setError(null);
      setSuccess(null);
      setEditMode(false);
    }
  }, [open, audio]);

  const handleSearch = async () => {
    if (!audio.youtube_id) return;
    
    setSearching(true);
    setError(null);
    setResults([]);
    
    try {
      const response = await audioAPI.searchMetadata(audio.youtube_id, {
        title: searchTitle,
        artist: searchArtist,
      });
      setResults(response.data.results || []);
      if (response.data.results.length === 0) {
        setError('No matches found. Try adjusting the search terms.');
      }
    } catch (err) {
      setError('Failed to search metadata');
      console.error('Metadata search error:', err);
    } finally {
      setSearching(false);
    }
  };

  const handleAutoFetch = async () => {
    if (!audio.youtube_id) return;
    
    setLoading(true);
    setError(null);
    setSuccess(null);
    
    try {
      const response = await audioAPI.autoFetchMetadata(audio.youtube_id);
      console.log('[MetadataEditor] Auto-fetch response:', response.data);
      if (response.data.audio) {
        const updated = response.data.audio;
        setSuccess(`✓ Found: ${updated.artist || 'Unknown'} - ${updated.album || 'Unknown'} (${updated.year || '?'})`);
        onUpdate?.(updated);
        // Update local state
        setArtist(updated.artist || '');
        setAlbum(updated.album || '');
        setYear(updated.year?.toString() || '');
        setGenre(updated.genre || '');
      } else {
        setError(response.data.message || 'No metadata found');
      }
    } catch (err) {
      setError('Failed to auto-fetch metadata');
      console.error('Auto-fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyResult = async (result: MetadataResult) => {
    if (!audio.youtube_id || !result.musicbrainz_id) return;
    
    setLoading(true);
    setError(null);
    setSuccess(null);
    
    try {
      console.log('[MetadataEditor] Applying result:', result);
      const response = await audioAPI.applyMetadata(audio.youtube_id, {
        musicbrainz_id: result.musicbrainz_id,
      });
      console.log('[MetadataEditor] Apply response:', response.data);
      if (response.data.audio) {
        const updated = response.data.audio;
        setSuccess(`✓ Applied: ${updated.artist || 'Unknown'} - ${updated.album || 'Unknown'} (${updated.year || '?'})`);
        onUpdate?.(updated);
        setArtist(updated.artist || '');
        setAlbum(updated.album || '');
        setYear(updated.year?.toString() || '');
        setGenre(updated.genre || '');
      }
    } catch (err) {
      setError('Failed to apply metadata');
      console.error('Apply metadata error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveManual = async () => {
    if (!audio.youtube_id) return;
    
    setLoading(true);
    setError(null);
    setSuccess(null);
    
    try {
      const response = await audioAPI.applyMetadata(audio.youtube_id, {
        artist,
        album,
        year: year ? parseInt(year) : null,
        genre,
        source: 'manual',
      });
      if (response.data.audio) {
        setSuccess('Metadata saved');
        onUpdate?.(response.data.audio);
        setEditMode(false);
      }
    } catch (err) {
      setError('Failed to save metadata');
      console.error('Save metadata error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <MusicIcon color="primary" />
          <Typography variant="h6">Edit Metadata</Typography>
        </Box>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      
      <DialogContent dividers>
        {loading && <LinearProgress sx={{ mb: 2 }} />}
        
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        
        {success && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
            {success}
          </Alert>
        )}
        
        {/* Current Track Info */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Track
          </Typography>
          <Typography variant="body1" fontWeight={500} noWrap>
            {audio.title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {audio.channel_name}
          </Typography>
        </Box>
        
        {/* Current Metadata */}
        <Box sx={{ mb: 3, p: 2, bgcolor: 'background.default', borderRadius: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="subtitle2" color="text.secondary">
              Current Metadata
            </Typography>
            <Button
              size="small"
              startIcon={<EditIcon />}
              onClick={() => setEditMode(!editMode)}
            >
              {editMode ? 'Cancel Edit' : 'Edit Manually'}
            </Button>
          </Box>
          
          {editMode ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
              <TextField
                label="Artist"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                size="small"
                fullWidth
              />
              <TextField
                label="Album"
                value={album}
                onChange={(e) => setAlbum(e.target.value)}
                size="small"
                fullWidth
              />
              <Box sx={{ display: 'flex', gap: 2 }}>
                <TextField
                  label="Year"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  size="small"
                  type="number"
                  sx={{ width: 120 }}
                />
                <TextField
                  label="Genre"
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  size="small"
                  fullWidth
                />
              </Box>
              <Button
                variant="contained"
                onClick={handleSaveManual}
                disabled={loading}
              >
                Save Changes
              </Button>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {audio.artist && (
                <Chip icon={<PersonIcon />} label={audio.artist} size="small" />
              )}
              {audio.album && (
                <Chip icon={<AlbumIcon />} label={audio.album} size="small" />
              )}
              {audio.year && (
                <Chip icon={<CalendarIcon />} label={audio.year} size="small" />
              )}
              {audio.genre && (
                <Chip icon={<MusicIcon />} label={audio.genre} size="small" />
              )}
              {!audio.artist && !audio.album && !audio.year && !audio.genre && (
                <Typography variant="body2" color="text.secondary">
                  No metadata available
                </Typography>
              )}
              {audio.metadata_source && (
                <Typography variant="caption" color="text.secondary" sx={{ width: '100%', mt: 1 }}>
                  Source: {audio.metadata_source}
                </Typography>
              )}
            </Box>
          )}
        </Box>
        
        <Divider sx={{ my: 2 }} />
        
        {/* Auto-fetch button */}
        <Box sx={{ mb: 3 }}>
          <Button
            variant="contained"
            color="primary"
            startIcon={<AutoIcon />}
            onClick={handleAutoFetch}
            disabled={loading || !audio.youtube_id}
            fullWidth
          >
            Auto-Fetch Best Match
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, textAlign: 'center' }}>
            Automatically finds and applies the best matching metadata from MusicBrainz
          </Typography>
        </Box>
        
        <Divider sx={{ my: 2 }} />
        
        {/* Search Section */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Search MusicBrainz
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            <TextField
              label="Title"
              value={searchTitle}
              onChange={(e) => setSearchTitle(e.target.value)}
              size="small"
              fullWidth
            />
            <TextField
              label="Artist"
              value={searchArtist}
              onChange={(e) => setSearchArtist(e.target.value)}
              size="small"
              fullWidth
            />
          </Box>
          <Button
            variant="outlined"
            startIcon={searching ? <CircularProgress size={16} /> : <SearchIcon />}
            onClick={handleSearch}
            disabled={searching || !audio.youtube_id}
            fullWidth
          >
            {searching ? 'Searching...' : 'Search'}
          </Button>
        </Box>
        
        {/* Search Results */}
        {results.length > 0 && (
          <List dense sx={{ bgcolor: 'background.default', borderRadius: 1, maxHeight: 300, overflow: 'auto' }}>
            {results.map((result, index) => (
              <ListItem
                key={index}
                sx={{
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  '&:last-child': { borderBottom: 'none' },
                }}
              >
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Typography variant="body2" fontWeight={500}>
                        {result.title || 'Unknown Title'}
                      </Typography>
                      <Chip
                        label={`${Math.round(result.confidence * 100)}%`}
                        size="small"
                        color={result.confidence >= 0.8 ? 'success' : result.confidence >= 0.5 ? 'warning' : 'default'}
                        sx={{ height: 20 }}
                      />
                    </Box>
                  }
                  secondary={
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 0.5 }}>
                      {result.artist && (
                        <Typography variant="caption" color="text.secondary">
                          Artist: {result.artist}
                        </Typography>
                      )}
                      {result.album && (
                        <Typography variant="caption" color="text.secondary">
                          Album: {result.album} {result.year && `(${result.year})`}
                        </Typography>
                      )}
                    </Box>
                  }
                />
                <ListItemSecondaryAction>
                  <Tooltip title="Apply this metadata">
                    <IconButton
                      edge="end"
                      onClick={() => handleApplyResult(result)}
                      disabled={loading || !result.musicbrainz_id}
                      color="primary"
                    >
                      <CheckIcon />
                    </IconButton>
                  </Tooltip>
                </ListItemSecondaryAction>
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
