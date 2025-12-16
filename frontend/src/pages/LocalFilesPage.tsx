import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  CardMedia,
  Button,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Chip,
  Menu,
  MenuItem,
  LinearProgress,
  Alert,
  Tab,
  Tabs,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  InputAdornment,
  FormControl,
  InputLabel,
  Select,
  Divider,
} from '@mui/material';
import {
  CloudUpload as UploadIcon,
  PlayArrow as PlayIcon,
  Pause as PauseIcon,
  Favorite as FavoriteIcon,
  FavoriteBorder as FavoriteOutlineIcon,
  MoreVert as MoreIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Search as SearchIcon,
  Album as AlbumIcon,
  Person as PersonIcon,
  MusicNote as MusicIcon,
  QueueMusic as PlaylistIcon,
  CloudDownload as DownloadIcon,
} from '@mui/icons-material';
import api from '../api/client';

interface LocalAudio {
  id: number;
  title: string;
  artist: string;
  album: string;
  year?: number;
  genre: string;
  duration: number;
  duration_formatted: string;
  file_url: string;
  cover_art_url?: string;
  file_size_mb: number;
  audio_format: string;
  bitrate?: number;
  play_count: number;
  is_favorite: boolean;
  uploaded_date: string;
  tags: string[];
  notes: string;
}

interface LocalPlaylist {
  id: number;
  title: string;
  description: string;
  cover_image_url?: string;
  items_count: number;
  created_date: string;
}

interface LocalFilesPageProps {
  currentAudio?: any;
  onPlay: (audio: any) => void;
  isPlaying: boolean;
}

const LocalFilesPage: React.FC<LocalFilesPageProps> = ({ currentAudio, onPlay, isPlaying }) => {
  const [tab, setTab] = useState(0);
  const [audioFiles, setAudioFiles] = useState<LocalAudio[]>([]);
  const [playlists, setPlaylists] = useState<LocalPlaylist[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  // Upload metadata will be extracted from ID3 tags automatically
  const [searchQuery, setSearchQuery] = useState('');
  const [filterArtist, setFilterArtist] = useState('');
  const [filterAlbum, setFilterAlbum] = useState('');
  const [filterGenre, setFilterGenre] = useState('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [artists, setArtists] = useState<string[]>([]);
  const [albums, setAlbums] = useState<any[]>([]);
  const [genres, setGenres] = useState<string[]>([]);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedAudio, setSelectedAudio] = useState<LocalAudio | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [stats, setStats] = useState<any>({});
  const [alert, setAlert] = useState<{ message: string; severity: 'success' | 'error' | 'info' } | null>(null);

  useEffect(() => {
    // Get CSRF token on page load
    api.get('/audio/local-audio/', { params: { limit: 1 } }).catch(() => {});
    loadAudioFiles();
    loadFilters();
    loadStats();
  }, [searchQuery, filterArtist, filterAlbum, filterGenre, showFavoritesOnly]);

  useEffect(() => {
    if (tab === 1) {
      loadPlaylists();
    }
  }, [tab]);

  const loadAudioFiles = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (searchQuery) params.search = searchQuery;
      if (filterArtist) params.artist = filterArtist;
      if (filterAlbum) params.album = filterAlbum;
      if (filterGenre) params.genre = filterGenre;
      if (showFavoritesOnly) params.favorites = 'true';

      const response = await api.get('/audio/local-audio/', { params });
      const data = response.data || [];
      setAudioFiles(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error loading audio files:', error);
      setAudioFiles([]);
      setAlert({ message: 'Failed to load audio files', severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const loadPlaylists = async () => {
    try {
      const response = await api.get('/audio/local-playlists/');
      const data = response.data || [];
      setPlaylists(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error loading playlists:', error);
      setPlaylists([]);
    }
  };

  const loadFilters = async () => {
    try {
      const [artistsRes, albumsRes, genresRes] = await Promise.all([
        api.get('/audio/local-audio/artists/').catch(() => ({ data: [] })),
        api.get('/audio/local-audio/albums/').catch(() => ({ data: [] })),
        api.get('/audio/local-audio/genres/').catch(() => ({ data: [] })),
      ]);
      setArtists(artistsRes.data);
      setAlbums(albumsRes.data);
      setGenres(genresRes.data);
    } catch (error) {
      console.error('Error loading filters:', error);
    }
  };

  const loadStats = async () => {
    try {
      const response = await api.get('/audio/local-audio/stats/');
      setStats(response.data);
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);

    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      await api.post('/audio/local-audio/', formData, {
        headers: { 
          'Content-Type': 'multipart/form-data',
          'X-CSRFToken': getCookie('csrftoken') || ''
        },
        withCredentials: true,
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / (progressEvent.total || 1));
          setUploadProgress(percentCompleted);
        },
      });

      setAlert({ message: 'File uploaded! Metadata extracted from ID3 tags.', severity: 'success' });
      setUploadDialogOpen(false);
      setSelectedFile(null);
      loadAudioFiles();
      loadStats();
    } catch (error: any) {
      console.error('Upload error:', error);
      setAlert({
        message: error.response?.data?.error || error.response?.data?.detail || 'Failed to upload file',
        severity: 'error',
      });
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  // Helper function to get CSRF token from cookies
  const getCookie = (name: string) => {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop()?.split(';').shift();
    return null;
  };

  const handlePlay = (audio: LocalAudio) => {
    // Convert to format expected by player
    const audioForPlayer = {
      youtube_id: `local-${audio.id}`,
      title: audio.title,
      artist: audio.artist || 'Unknown Artist',
      album: audio.album,
      duration: audio.duration,
      file_url: audio.file_url,
      cover_art_url: audio.cover_art_url,
      is_local: true,
    };
    onPlay(audioForPlayer);
  };

  const handleToggleFavorite = async (audio: LocalAudio) => {
    try {
      await api.post(`/audio/local-audio/${audio.id}/toggle_favorite/`);
      loadAudioFiles();
    } catch (error) {
      console.error('Error toggling favorite:', error);
    }
  };

  const handleDelete = async (audio: LocalAudio) => {
    if (!confirm(`Delete "${audio.title}"?`)) return;

    try {
      await api.delete(`/audio/local-audio/${audio.id}/`);
      setAlert({ message: 'File deleted successfully', severity: 'success' });
      loadAudioFiles();
      loadStats();
    } catch (error) {
      console.error('Error deleting file:', error);
      setAlert({ message: 'Failed to delete file', severity: 'error' });
    }
    setAnchorEl(null);
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, audio: LocalAudio) => {
    setAnchorEl(event.currentTarget);
    setSelectedAudio(audio);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setSelectedAudio(null);
  };

  const clearFilters = () => {
    setSearchQuery('');
    setFilterArtist('');
    setFilterAlbum('');
    setFilterGenre('');
    setShowFavoritesOnly(false);
  };

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 600 }}>
          My Local Files
        </Typography>
        <Button
          variant="contained"
          startIcon={<UploadIcon />}
          onClick={() => setUploadDialogOpen(true)}
        >
          Upload Audio
        </Button>
      </Box>

      {/* Alert */}
      {alert && (
        <Alert severity={alert.severity} onClose={() => setAlert(null)} sx={{ mb: 2 }}>
          {alert.message}
        </Alert>
      )}

      {/* Stats Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Total Files
              </Typography>
              <Typography variant="h4">{stats.total_files || 0}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Artists
              </Typography>
              <Typography variant="h4">{stats.total_artists || 0}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Total Size
              </Typography>
              <Typography variant="h4">{(stats.total_size_mb || 0).toFixed(0)} MB</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Favorites
              </Typography>
              <Typography variant="h4">{stats.favorites || 0}</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Tabs */}
      <Tabs value={tab} onChange={(_, newValue) => setTab(newValue)} sx={{ mb: 2 }}>
        <Tab label="Audio Files" />
        <Tab label="Playlists" />
      </Tabs>

      {/* Tab Content */}
      {tab === 0 && (
        <>
          {/* Filters */}
          <Box sx={{ mb: 3, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon />
                  </InputAdornment>
                ),
              }}
              sx={{ minWidth: 250 }}
            />
            <FormControl sx={{ minWidth: 150 }}>
              <InputLabel>Artist</InputLabel>
              <Select
                value={filterArtist}
                onChange={(e) => setFilterArtist(e.target.value)}
                label="Artist"
              >
                <MenuItem value="">All Artists</MenuItem>
                {artists.map((artist) => (
                  <MenuItem key={artist} value={artist}>
                    {artist}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl sx={{ minWidth: 150 }}>
              <InputLabel>Album</InputLabel>
              <Select
                value={filterAlbum}
                onChange={(e) => setFilterAlbum(e.target.value)}
                label="Album"
              >
                <MenuItem value="">All Albums</MenuItem>
                {albums.map((album) => (
                  <MenuItem key={album.album} value={album.album}>
                    {album.album}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl sx={{ minWidth: 150 }}>
              <InputLabel>Genre</InputLabel>
              <Select
                value={filterGenre}
                onChange={(e) => setFilterGenre(e.target.value)}
                label="Genre"
              >
                <MenuItem value="">All Genres</MenuItem>
                {genres.map((genre) => (
                  <MenuItem key={genre} value={genre}>
                    {genre}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button
              variant={showFavoritesOnly ? 'contained' : 'outlined'}
              startIcon={<FavoriteIcon />}
              onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
            >
              Favorites
            </Button>
            <Button onClick={clearFilters}>Clear Filters</Button>
          </Box>

          {/* Audio Grid */}
          {loading ? (
            <LinearProgress />
          ) : audioFiles.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 8 }}>
              <MusicIcon sx={{ fontSize: 80, color: 'text.secondary', mb: 2 }} />
              <Typography variant="h6" color="textSecondary" gutterBottom>
                No audio files yet
              </Typography>
              <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                Upload your local audio files to start listening
              </Typography>
              <Button
                variant="contained"
                startIcon={<UploadIcon />}
                onClick={() => setUploadDialogOpen(true)}
              >
                Upload Your First File
              </Button>
            </Box>
          ) : (
            <Grid container spacing={2}>
              {audioFiles.map((audio) => {
                const isCurrentlyPlaying =
                  currentAudio?.youtube_id === `local-${audio.id}` && isPlaying;

                return (
                  <Grid item xs={12} sm={6} md={4} lg={3} key={audio.id}>
                    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                      <CardMedia
                        sx={{
                          height: 200,
                          bgcolor: 'grey.200',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {audio.cover_art_url ? (
                          <img
                            src={audio.cover_art_url}
                            alt={audio.title}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          <AlbumIcon sx={{ fontSize: 80, color: 'grey.400' }} />
                        )}
                      </CardMedia>
                      <CardContent sx={{ flexGrow: 1 }}>
                        <Typography variant="h6" noWrap title={audio.title}>
                          {audio.title}
                        </Typography>
                        <Typography variant="body2" color="textSecondary" noWrap>
                          {audio.artist || 'Unknown Artist'}
                        </Typography>
                        {audio.album && (
                          <Typography variant="caption" color="textSecondary" noWrap>
                            {audio.album}
                          </Typography>
                        )}
                        <Box sx={{ mt: 1, display: 'flex', justifyContent: 'space-between' }}>
                          <Typography variant="caption" color="textSecondary">
                            {audio.duration_formatted}
                          </Typography>
                          <Typography variant="caption" color="textSecondary">
                            {audio.audio_format.toUpperCase()}
                          </Typography>
                        </Box>
                        {audio.tags && audio.tags.length > 0 && (
                          <Box sx={{ mt: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                            {audio.tags.slice(0, 2).map((tag, idx) => (
                              <Chip key={idx} label={tag} size="small" />
                            ))}
                          </Box>
                        )}
                      </CardContent>
                      <Box sx={{ p: 1, display: 'flex', justifyContent: 'space-between' }}>
                        <Box>
                          <IconButton
                            color="primary"
                            onClick={() => handlePlay(audio)}
                          >
                            {isCurrentlyPlaying ? <PauseIcon /> : <PlayIcon />}
                          </IconButton>
                          <IconButton
                            color={audio.is_favorite ? 'error' : 'default'}
                            onClick={() => handleToggleFavorite(audio)}
                          >
                            {audio.is_favorite ? <FavoriteIcon /> : <FavoriteOutlineIcon />}
                          </IconButton>
                        </Box>
                        <IconButton onClick={(e) => handleMenuOpen(e, audio)}>
                          <MoreIcon />
                        </IconButton>
                      </Box>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>
          )}
        </>
      )}

      {tab === 1 && (
        <Box>
          <Typography variant="body1" color="textSecondary">
            Playlists feature coming soon...
          </Typography>
        </Box>
      )}

      {/* Context Menu */}
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleMenuClose}>
        <MenuItem
          onClick={() => {
            if (selectedAudio) {
              const link = document.createElement('a');
              link.href = selectedAudio.file_url;
              link.download = selectedAudio.title;
              link.click();
            }
            handleMenuClose();
          }}
        >
          <DownloadIcon sx={{ mr: 1 }} /> Download
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (selectedAudio) handleDelete(selectedAudio);
          }}
        >
          <DeleteIcon sx={{ mr: 1 }} /> Delete
        </MenuItem>
      </Menu>

      {/* Upload Dialog */}
      <Dialog
        open={uploadDialogOpen}
        onClose={() => !uploading && setUploadDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Upload Audio File</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            <input
              accept="audio/*"
              style={{ display: 'none' }}
              id="upload-file"
              type="file"
              onChange={handleFileSelect}
            />
            <label htmlFor="upload-file">
              <Button
                variant="outlined"
                component="span"
                startIcon={<UploadIcon />}
                fullWidth
                sx={{ mb: 2 }}
              >
                Choose File
              </Button>
            </label>
            {selectedFile && (
              <Box sx={{ mt: 2, p: 2, bgcolor: 'rgba(19, 236, 106, 0.1)', borderRadius: 2 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                  {selectedFile.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • Metadata will be read from ID3 tags
                </Typography>
              </Box>
            )}
            {uploading && (
              <Box sx={{ mt: 2 }}>
                <LinearProgress variant="determinate" value={uploadProgress} />
                <Typography variant="body2" color="textSecondary" sx={{ mt: 1, textAlign: 'center' }}>
                  Uploading... {uploadProgress}%
                </Typography>
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUploadDialogOpen(false)} disabled={uploading}>
            Cancel
          </Button>
          <Button
            onClick={handleUpload}
            variant="contained"
            disabled={!selectedFile || uploading}
          >
            Upload
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default LocalFilesPage;
