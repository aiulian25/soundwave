import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  CardActionArea,
  Grid,
  CircularProgress,
  Chip,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Alert,
  Snackbar,
  Divider,
  Paper,
  Fade,
  RadioGroup,
  Radio,
  FormControlLabel,
} from '@mui/material';
import {
  Add as AddIcon,
  AutoAwesome as AutoAwesomeIcon,
  LocalFireDepartment as FireIcon,
  NewReleases as NewIcon,
  History as HistoryIcon,
  Explore as ExploreIcon,
  Bolt as BoltIcon,
  Album as AlbumIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  PlayArrow as PlayIcon,
  Shuffle as ShuffleIcon,
  Tune as TuneIcon,
  Remove as RemoveIcon,
} from '@mui/icons-material';
import { smartPlaylistAPI } from '../api/client';
import type { SmartPlaylist, SmartPlaylistChoices, Audio } from '../types';
import ScrollToTop from '../components/ScrollToTop';

// Rule preset templates for quick creation
const RULE_PRESETS = [
  { label: 'Most Played (Top 50)', rules: [{ field: 'play_count', operator: 'greater_than', value: '0' }], order_by: '-play_count', limit: 50 },
  { label: 'Recently Added (Last 30 days)', rules: [{ field: 'downloaded_date', operator: 'in_last_days', value: '30' }], order_by: '-downloaded_date', limit: null },
  { label: 'Favorites', rules: [{ field: 'is_favorite', operator: 'is_true', value: '' }], order_by: '-downloaded_date', limit: null },
  { label: 'By Genre...', rules: [{ field: 'genre', operator: 'contains', value: '' }], order_by: 'title', limit: null },
  { label: 'By Artist...', rules: [{ field: 'artist', operator: 'contains', value: '' }], order_by: 'title', limit: null },
  { label: 'Short Tracks (Under 3 min)', rules: [{ field: 'duration', operator: 'less_than', value: '180' }], order_by: 'duration', limit: null },
  { label: 'Custom Rules...', rules: [], order_by: '-downloaded_date', limit: null },
];

// Icon mapping for smart playlists
const ICON_MAP: Record<string, React.ReactNode> = {
  local_fire_department: <FireIcon />,
  new_releases: <NewIcon />,
  history: <HistoryIcon />,
  explore: <ExploreIcon />,
  bolt: <BoltIcon />,
  album: <AlbumIcon />,
  auto_awesome: <AutoAwesomeIcon />,
  tune: <TuneIcon />,
};

interface SmartPlaylistsPageProps {
  setCurrentAudio: (audio: Audio, queue?: Audio[]) => void;
}

export default function SmartPlaylistsPage({ setCurrentAudio }: SmartPlaylistsPageProps) {
  const navigate = useNavigate();
  const [playlists, setPlaylists] = useState<SmartPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDescription, setNewPlaylistDescription] = useState('');
  const [selectedPreset, setSelectedPreset] = useState(0);
  const [customRuleValue, setCustomRuleValue] = useState('');
  const [choices, setChoices] = useState<SmartPlaylistChoices | null>(null);
  const [customRules, setCustomRules] = useState<Array<{ field: string; operator: string; value: string; value_2?: string }>>([]);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({
    open: false,
    message: '',
    severity: 'info',
  });

  const loadPlaylists = useCallback(async () => {
    try {
      setLoading(true);
      const response = await smartPlaylistAPI.list();
      setPlaylists(response.data.data || []);
    } catch (err) {
      console.error('Failed to load smart playlists:', err);
      setSnackbar({ open: true, message: 'Failed to load smart playlists', severity: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadChoices = useCallback(async () => {
    try {
      const response = await smartPlaylistAPI.getChoices();
      setChoices(response.data);
    } catch (err) {
      console.error('Failed to load choices:', err);
    }
  }, []);

  useEffect(() => {
    loadPlaylists();
    loadChoices();
  }, [loadPlaylists, loadChoices]);

  const resetCreateDialog = () => {
    setNewPlaylistName('');
    setNewPlaylistDescription('');
    setSelectedPreset(0);
    setCustomRuleValue('');
    setCustomRules([{ field: 'genre', operator: 'contains', value: '' }]);
  };

  const handleOpenCreateDialog = () => {
    resetCreateDialog();
    setCreateDialogOpen(true);
  };

  const handleCreatePlaylist = async () => {
    if (!newPlaylistName.trim()) {
      setSnackbar({ open: true, message: 'Please enter a name', severity: 'error' });
      return;
    }

    const preset = RULE_PRESETS[selectedPreset];
    let rules = [...preset.rules];
    
    // For presets that need a value (genre, artist)
    if (preset.label.includes('...') && customRuleValue.trim()) {
      rules = rules.map(r => ({ ...r, value: customRuleValue.trim() }));
    }
    
    // For custom rules mode
    if (selectedPreset === RULE_PRESETS.length - 1) {
      rules = customRules.filter(r => r.value.trim() || r.operator === 'is_true' || r.operator === 'is_false');
    }

    // Warn if no rules (will match all tracks)
    if (rules.length === 0) {
      setSnackbar({ 
        open: true, 
        message: 'No rules set - playlist will include all tracks. Add rules after creation to filter.', 
        severity: 'info' 
      });
    }

    try {
      const response = await smartPlaylistAPI.create({
        name: newPlaylistName,
        description: newPlaylistDescription,
        order_by: preset.order_by,
        limit: preset.limit,
        rules: rules,
      });
      resetCreateDialog();
      setCreateDialogOpen(false);
      setSnackbar({ open: true, message: 'Smart playlist created!', severity: 'success' });
      loadPlaylists();
      
      // Navigate to the new playlist to let user refine rules
      if (response.data?.id) {
        navigate(`/smart-playlist/${response.data.id}`);
      }
    } catch (err: any) {
      console.error('Failed to create smart playlist:', err);
      setSnackbar({
        open: true,
        message: err.response?.data?.name?.[0] || 'Failed to create smart playlist',
        severity: 'error',
      });
    }
  };

  const handleDeletePlaylist = async (playlist: SmartPlaylist, event: React.MouseEvent) => {
    event.stopPropagation();
    
    if (playlist.is_system) {
      setSnackbar({ open: true, message: 'Cannot delete system playlists', severity: 'error' });
      return;
    }

    if (!confirm(`Delete "${playlist.name}"?`)) return;

    try {
      await smartPlaylistAPI.delete(playlist.id);
      setSnackbar({ open: true, message: 'Smart playlist deleted', severity: 'success' });
      loadPlaylists();
    } catch (err) {
      console.error('Failed to delete smart playlist:', err);
      setSnackbar({ open: true, message: 'Failed to delete smart playlist', severity: 'error' });
    }
  };

  const handlePlayPlaylist = async (playlist: SmartPlaylist, shuffle: boolean, event: React.MouseEvent) => {
    event.stopPropagation();
    
    try {
      const response = await smartPlaylistAPI.getTracks(playlist.id, { page_size: 100 });
      const tracks = response.data.data as Audio[];
      
      if (tracks.length === 0) {
        setSnackbar({ open: true, message: 'No tracks in this playlist', severity: 'info' });
        return;
      }

      let queue = [...tracks];
      if (shuffle) {
        // Fisher-Yates shuffle
        for (let i = queue.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [queue[i], queue[j]] = [queue[j], queue[i]];
        }
      }

      setCurrentAudio(queue[0], queue);
      setSnackbar({
        open: true,
        message: `Playing ${tracks.length} tracks${shuffle ? ' (shuffled)' : ''}`,
        severity: 'success',
      });
    } catch (err) {
      console.error('Failed to play playlist:', err);
      setSnackbar({ open: true, message: 'Failed to load tracks', severity: 'error' });
    }
  };

  const getIcon = (iconName: string) => {
    return ICON_MAP[iconName] || <AutoAwesomeIcon />;
  };

  // Separate system and custom playlists
  const systemPlaylists = playlists.filter(p => p.is_system);
  const customPlaylists = playlists.filter(p => !p.is_system);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <ScrollToTop />
      
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AutoAwesomeIcon sx={{ fontSize: 32, color: 'primary.main' }} />
          <Typography variant="h4" fontWeight="bold">
            Smart Playlists
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={handleOpenCreateDialog}
        >
          Create
        </Button>
      </Box>

      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        Dynamic playlists that automatically update based on rules. Your library changes, they update instantly.
      </Typography>

      {/* System Playlists */}
      {systemPlaylists.length > 0 && (
        <>
          <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <BoltIcon sx={{ color: 'warning.main' }} />
            Auto Playlists
          </Typography>
          <Grid container spacing={2} sx={{ mb: 4 }}>
            {systemPlaylists.map((playlist) => (
              <Grid item xs={12} sm={6} md={4} lg={3} key={playlist.id}>
                <Fade in timeout={300}>
                  <Card
                    sx={{
                      height: '100%',
                      background: `linear-gradient(135deg, ${playlist.color}22 0%, transparent 50%)`,
                      borderLeft: `4px solid ${playlist.color}`,
                      transition: 'transform 0.2s, box-shadow 0.2s',
                      '&:hover': {
                        transform: 'translateY(-4px)',
                        boxShadow: 4,
                      },
                    }}
                  >
                    <CardActionArea onClick={() => navigate(`/smart-playlist/${playlist.id}`)}>
                      <CardContent>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                          <Box sx={{ color: playlist.color }}>
                            {getIcon(playlist.icon)}
                          </Box>
                          <Typography variant="h6" noWrap sx={{ flex: 1 }}>
                            {playlist.name}
                          </Typography>
                        </Box>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1, minHeight: 40 }}>
                          {playlist.description}
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Chip
                            label={`${playlist.track_count} tracks`}
                            size="small"
                            sx={{ bgcolor: `${playlist.color}22`, color: playlist.color }}
                          />
                          <Box sx={{ display: 'flex', gap: 0.5 }}>
                            <Tooltip title="Play">
                              <IconButton
                                size="small"
                                onClick={(e) => handlePlayPlaylist(playlist, false, e)}
                                sx={{ color: playlist.color }}
                              >
                                <PlayIcon />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Shuffle">
                              <IconButton
                                size="small"
                                onClick={(e) => handlePlayPlaylist(playlist, true, e)}
                                sx={{ color: playlist.color }}
                              >
                                <ShuffleIcon />
                              </IconButton>
                            </Tooltip>
                          </Box>
                        </Box>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                </Fade>
              </Grid>
            ))}
          </Grid>
        </>
      )}

      {/* Custom Playlists */}
      <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
        <TuneIcon sx={{ color: 'primary.main' }} />
        Custom Smart Playlists
      </Typography>
      
      {customPlaylists.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center', bgcolor: 'background.default' }}>
          <AutoAwesomeIcon sx={{ fontSize: 64, color: 'text.secondary', opacity: 0.5, mb: 2 }} />
          <Typography variant="h6" color="text.secondary">
            No custom smart playlists yet
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Create your own rules-based playlists
          </Typography>
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={handleOpenCreateDialog}
          >
            Create Smart Playlist
          </Button>
        </Paper>
      ) : (
        <Grid container spacing={2}>
          {customPlaylists.map((playlist) => (
            <Grid item xs={12} sm={6} md={4} lg={3} key={playlist.id}>
              <Fade in timeout={300}>
                <Card
                  sx={{
                    height: '100%',
                    background: `linear-gradient(135deg, ${playlist.color}22 0%, transparent 50%)`,
                    borderLeft: `4px solid ${playlist.color}`,
                    transition: 'transform 0.2s, box-shadow 0.2s',
                    '&:hover': {
                      transform: 'translateY(-4px)',
                      boxShadow: 4,
                    },
                  }}
                >
                  <CardActionArea onClick={() => navigate(`/smart-playlist/${playlist.id}`)}>
                    <CardContent>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Box sx={{ color: playlist.color }}>
                          {getIcon(playlist.icon)}
                        </Box>
                        <Typography variant="h6" noWrap sx={{ flex: 1 }}>
                          {playlist.name}
                        </Typography>
                      </Box>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1, minHeight: 40 }}>
                        {playlist.description || 'No description'}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Chip
                          label={`${playlist.track_count} tracks`}
                          size="small"
                          sx={{ bgcolor: `${playlist.color}22`, color: playlist.color }}
                        />
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          <Tooltip title="Play">
                            <IconButton
                              size="small"
                              onClick={(e) => handlePlayPlaylist(playlist, false, e)}
                              sx={{ color: playlist.color }}
                            >
                              <PlayIcon />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Shuffle">
                            <IconButton
                              size="small"
                              onClick={(e) => handlePlayPlaylist(playlist, true, e)}
                              sx={{ color: playlist.color }}
                            >
                              <ShuffleIcon />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Delete">
                            <IconButton
                              size="small"
                              onClick={(e) => handleDeletePlaylist(playlist, e)}
                              sx={{ color: 'error.main' }}
                            >
                              <DeleteIcon />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </Box>
                    </CardContent>
                  </CardActionArea>
                </Card>
              </Fade>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Create Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AutoAwesomeIcon color="primary" />
            Create Smart Playlist
          </Box>
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Name"
            fullWidth
            value={newPlaylistName}
            onChange={(e) => setNewPlaylistName(e.target.value)}
            sx={{ mb: 2 }}
          />
          <TextField
            margin="dense"
            label="Description (optional)"
            fullWidth
            multiline
            rows={2}
            value={newPlaylistDescription}
            onChange={(e) => setNewPlaylistDescription(e.target.value)}
            sx={{ mb: 3 }}
          />
          
          <Divider sx={{ mb: 2 }} />
          
          <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
            <TuneIcon fontSize="small" />
            Choose what tracks to include:
          </Typography>
          
          <RadioGroup
            value={selectedPreset}
            onChange={(e) => {
              setSelectedPreset(Number(e.target.value));
              setCustomRuleValue('');
            }}
          >
            {RULE_PRESETS.map((preset, index) => (
              <Box key={index}>
                <FormControlLabel
                  value={index}
                  control={<Radio size="small" />}
                  label={preset.label}
                  sx={{ ml: 0 }}
                />
                {/* Show value input for presets that need it */}
                {selectedPreset === index && preset.label.includes('...') && (
                  <TextField
                    size="small"
                    placeholder={preset.label.includes('Genre') ? 'e.g., Rock, Pop, Jazz' : 'e.g., Artist name'}
                    value={customRuleValue}
                    onChange={(e) => setCustomRuleValue(e.target.value)}
                    sx={{ ml: 4, mb: 1, width: 'calc(100% - 32px)' }}
                  />
                )}
              </Box>
            ))}
          </RadioGroup>
          
          {/* Custom rules editor */}
          {selectedPreset === RULE_PRESETS.length - 1 && choices && (
            <Box sx={{ ml: 4, mt: 1 }}>
              {customRules.map((rule, index) => (
                <Box key={index} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center' }}>
                  <FormControl size="small" sx={{ minWidth: 120 }}>
                    <InputLabel>Field</InputLabel>
                    <Select
                      value={rule.field}
                      label="Field"
                      onChange={(e) => {
                        const updated = [...customRules];
                        updated[index].field = e.target.value;
                        setCustomRules(updated);
                      }}
                    >
                      {choices.fields.map((field) => (
                        <MenuItem key={field.value} value={field.value}>{field.label}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl size="small" sx={{ minWidth: 130 }}>
                    <InputLabel>Operator</InputLabel>
                    <Select
                      value={rule.operator}
                      label="Operator"
                      onChange={(e) => {
                        const updated = [...customRules];
                        updated[index].operator = e.target.value;
                        setCustomRules(updated);
                      }}
                    >
                      {choices.operators.map((op) => (
                        <MenuItem key={op.value} value={op.value}>{op.label}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  {!['is_true', 'is_false', 'is_set', 'is_not_set'].includes(rule.operator) && (
                    <TextField
                      size="small"
                      placeholder="Value"
                      value={rule.value}
                      onChange={(e) => {
                        const updated = [...customRules];
                        updated[index].value = e.target.value;
                        setCustomRules(updated);
                      }}
                      sx={{ flex: 1 }}
                    />
                  )}
                  <IconButton
                    size="small"
                    onClick={() => {
                      const updated = customRules.filter((_, i) => i !== index);
                      setCustomRules(updated.length ? updated : [{ field: 'genre', operator: 'contains', value: '' }]);
                    }}
                    disabled={customRules.length === 1}
                  >
                    <RemoveIcon />
                  </IconButton>
                </Box>
              ))}
              <Button
                size="small"
                startIcon={<AddIcon />}
                onClick={() => setCustomRules([...customRules, { field: 'genre', operator: 'contains', value: '' }])}
              >
                Add Rule
              </Button>
            </Box>
          )}
          
          <Alert severity="info" sx={{ mt: 2 }}>
            Smart playlists automatically update when your library changes. You can refine rules after creation.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleCreatePlaylist} variant="contained">
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar({ ...snackbar, open: false })}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
