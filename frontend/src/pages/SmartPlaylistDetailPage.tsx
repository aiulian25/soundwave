import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Alert,
  Chip,
  Button,
  Snackbar,
  Tooltip,
  Card,
  CardContent,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Paper,
  Divider,
  Grid,
  Switch,
  FormControlLabel,
} from '@mui/material';
import {
  PlayArrow as PlayIcon,
  Pause as PauseIcon,
  ArrowBack as BackIcon,
  Shuffle as ShuffleIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Add as AddIcon,
  AutoAwesome as AutoAwesomeIcon,
  Tune as TuneIcon,
  Remove as RemoveIcon,
  Preview as PreviewIcon,
} from '@mui/icons-material';
import { smartPlaylistAPI, audioAPI } from '../api/client';
import TrackActionsMenu from '../components/TrackActionsMenu';
import { useHighlightTrack } from '../hooks/useHighlightTrack';
import type { Audio, SmartPlaylist, SmartPlaylistRule, SmartPlaylistChoices } from '../types';

interface SmartPlaylistDetailPageProps {
  setCurrentAudio: (audio: Audio, queue?: Audio[]) => void;
}

export default function SmartPlaylistDetailPage({ setCurrentAudio }: SmartPlaylistDetailPageProps) {
  const { playlistId } = useParams<{ playlistId: string }>();
  const navigate = useNavigate();
  const { getTrackRef, shouldHighlight } = useHighlightTrack();
  const [playlist, setPlaylist] = useState<SmartPlaylist | null>(null);
  const [tracks, setTracks] = useState<Audio[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  
  // Rule editor state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [choices, setChoices] = useState<SmartPlaylistChoices | null>(null);
  const [editingRules, setEditingRules] = useState<SmartPlaylistRule[]>([]);
  const [editingMatchMode, setEditingMatchMode] = useState<'all' | 'any'>('all');
  const [editingOrderBy, setEditingOrderBy] = useState('-downloaded_date');
  const [editingLimit, setEditingLimit] = useState<number | ''>('');
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (playlistId) {
      loadPlaylist();
      loadChoices();
    }
  }, [playlistId]);

  const loadPlaylist = async () => {
    try {
      setLoading(true);
      const response = await smartPlaylistAPI.getTracks(parseInt(playlistId!));
      setPlaylist(response.data.playlist);
      setTracks(response.data.data || []);
      setError('');
    } catch (err: any) {
      console.error('Failed to load smart playlist:', err);
      setError(err.response?.data?.detail || 'Failed to load playlist');
    } finally {
      setLoading(false);
    }
  };

  const loadChoices = async () => {
    try {
      const response = await smartPlaylistAPI.getChoices();
      setChoices(response.data);
    } catch (err) {
      console.error('Failed to load choices:', err);
    }
  };

  const handlePlay = (startIndex: number = 0, shuffle: boolean = false) => {
    if (tracks.length === 0) return;
    
    let queue = [...tracks];
    if (shuffle) {
      // Fisher-Yates shuffle
      for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
      }
      startIndex = 0;
    }
    
    setCurrentAudio(queue[startIndex], queue);
  };

  const handleTrackUpdate = (updatedTrack: Audio) => {
    // Update the track in the list when updated (e.g., favorite toggled)
    setTracks(prev =>
      prev.map(t =>
        t.youtube_id === updatedTrack.youtube_id ? updatedTrack : t
      )
    );
  };

  const openEditDialog = async () => {
    if (!playlist) return;
    
    try {
      const response = await smartPlaylistAPI.get(playlist.id);
      const fullPlaylist = response.data as SmartPlaylist;
      setEditingRules(fullPlaylist.rules || []);
      setEditingMatchMode(fullPlaylist.match_mode);
      setEditingOrderBy(fullPlaylist.order_by);
      setEditingLimit(fullPlaylist.limit || '');
      setEditDialogOpen(true);
    } catch (err) {
      console.error('Failed to load playlist details:', err);
    }
  };

  const handleAddRule = () => {
    setEditingRules([
      ...editingRules,
      { field: 'genre', operator: 'contains', value: '', order: editingRules.length },
    ]);
  };

  const handleRemoveRule = (index: number) => {
    setEditingRules(editingRules.filter((_, i) => i !== index));
  };

  const handleRuleChange = (index: number, field: keyof SmartPlaylistRule, value: string) => {
    setEditingRules(
      editingRules.map((rule, i) =>
        i === index ? { ...rule, [field]: value } : rule
      )
    );
  };

  const handlePreview = async () => {
    setPreviewLoading(true);
    try {
      const response = await smartPlaylistAPI.preview({
        rules: editingRules.map(r => ({
          field: r.field,
          operator: r.operator,
          value: r.value,
          value_2: r.value_2,
        })),
        match_mode: editingMatchMode,
        order_by: editingOrderBy,
        limit: editingLimit ? parseInt(editingLimit.toString()) : null,
      });
      setPreviewCount(response.data.total_count);
    } catch (err) {
      console.error('Failed to preview:', err);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSaveRules = async () => {
    if (!playlist) return;

    try {
      await smartPlaylistAPI.update(playlist.id, {
        rules: editingRules.map(r => ({
          field: r.field,
          operator: r.operator,
          value: r.value,
          value_2: r.value_2,
        })),
        match_mode: editingMatchMode,
        order_by: editingOrderBy,
        limit: editingLimit ? parseInt(editingLimit.toString()) : null,
      });
      setEditDialogOpen(false);
      setSnackbarMessage('Rules updated!');
      setSnackbarOpen(true);
      loadPlaylist(); // Reload to get updated tracks
    } catch (err: any) {
      console.error('Failed to save rules:', err);
      setSnackbarMessage(err.response?.data?.error || 'Failed to save rules');
      setSnackbarOpen(true);
    }
  };

  const getApplicableOperators = (fieldName: string): string[] => {
    if (!choices) return [];
    const fieldType = choices.field_types[fieldName];
    return choices.operator_groups[fieldType] || [];
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
        <Button startIcon={<BackIcon />} onClick={() => navigate('/smart-playlists')} sx={{ mt: 2 }}>
          Back to Smart Playlists
        </Button>
      </Box>
    );
  }

  if (!playlist) return null;

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Button
          startIcon={<BackIcon />}
          onClick={() => navigate('/smart-playlists')}
          sx={{ mb: 2 }}
        >
          Back to Smart Playlists
        </Button>

        <Card
          sx={{
            background: `linear-gradient(135deg, ${playlist.color}33 0%, transparent 50%)`,
            borderLeft: `4px solid ${playlist.color}`,
          }}
        >
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <AutoAwesomeIcon sx={{ color: playlist.color, fontSize: 32 }} />
                  <Typography variant="h4" fontWeight="bold">
                    {playlist.name}
                  </Typography>
                  {playlist.is_system && (
                    <Chip label="Auto" size="small" color="warning" />
                  )}
                </Box>
                <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
                  {playlist.description}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Chip
                    label={`${tracks.length} tracks`}
                    sx={{ bgcolor: `${playlist.color}22`, color: playlist.color }}
                  />
                </Box>
              </Box>

              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button
                  variant="contained"
                  startIcon={<PlayIcon />}
                  onClick={() => handlePlay(0, false)}
                  disabled={tracks.length === 0}
                  sx={{ bgcolor: playlist.color, '&:hover': { bgcolor: playlist.color, filter: 'brightness(0.9)' } }}
                >
                  Play All
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<ShuffleIcon />}
                  onClick={() => handlePlay(0, true)}
                  disabled={tracks.length === 0}
                  sx={{ borderColor: playlist.color, color: playlist.color }}
                >
                  Shuffle
                </Button>
                {!playlist.is_system && (
                  <Button
                    variant="outlined"
                    startIcon={<TuneIcon />}
                    onClick={openEditDialog}
                  >
                    Edit Rules
                  </Button>
                )}
              </Box>
            </Box>
          </CardContent>
        </Card>
      </Box>

      {/* Track List */}
      {tracks.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <AutoAwesomeIcon sx={{ fontSize: 64, color: 'text.secondary', opacity: 0.5, mb: 2 }} />
          <Typography variant="h6" color="text.secondary">
            No tracks match the rules
          </Typography>
          {!playlist.is_system && (
            <Button
              variant="outlined"
              startIcon={<TuneIcon />}
              onClick={openEditDialog}
              sx={{ mt: 2 }}
            >
              Edit Rules
            </Button>
          )}
        </Paper>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell width={50}>#</TableCell>
                <TableCell>Title</TableCell>
                <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Artist</TableCell>
                <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Channel</TableCell>
                <TableCell align="right" sx={{ display: { xs: 'none', lg: 'table-cell' } }}>Plays</TableCell>
                <TableCell align="right" width={100}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tracks.map((track, index) => (
                <TableRow
                  key={track.id}
                  ref={getTrackRef(track.youtube_id)}
                  hover
                  sx={{ 
                    cursor: 'pointer',
                    ...(shouldHighlight(track.youtube_id) && {
                      bgcolor: 'rgba(19, 236, 106, 0.1)',
                    }),
                  }}
                  onClick={() => handlePlay(index, false)}
                >
                  <TableCell>{index + 1}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {track.thumbnail_url && (
                        <Box
                          component="img"
                          src={track.thumbnail_url}
                          alt={track.title}
                          sx={{ width: 40, height: 40, borderRadius: 1, objectFit: 'cover' }}
                        />
                      )}
                      <Box sx={{ overflow: 'hidden' }}>
                        <Typography variant="body2" noWrap>
                          {track.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: { sm: 'none' } }}>
                          {track.artist || track.channel_name}
                        </Typography>
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                    <Typography variant="body2" noWrap>
                      {track.artist || '-'}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                    <Typography variant="body2" noWrap>
                      {track.channel_name}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ display: { xs: 'none', lg: 'table-cell' } }}>
                    {track.play_count}
                  </TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    <TrackActionsMenu 
                      track={track}
                      onTrackUpdate={handleTrackUpdate}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Edit Rules Dialog */}
      <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TuneIcon />
            Edit Smart Playlist Rules
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          {/* Match Mode */}
          <Box sx={{ mb: 3 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Match Mode</InputLabel>
              <Select
                value={editingMatchMode}
                onChange={(e) => setEditingMatchMode(e.target.value as 'all' | 'any')}
                label="Match Mode"
              >
                <MenuItem value="all">Match ALL rules (AND)</MenuItem>
                <MenuItem value="any">Match ANY rule (OR)</MenuItem>
              </Select>
            </FormControl>
          </Box>

          {/* Rules */}
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Rules</Typography>
          {editingRules.length === 0 ? (
            <Alert severity="info" sx={{ mb: 2 }}>
              No rules defined. All tracks will be included.
            </Alert>
          ) : (
            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
              {editingRules.map((rule, index) => (
                <Box key={index} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                  <FormControl size="small" sx={{ minWidth: 140 }}>
                    <InputLabel>Field</InputLabel>
                    <Select
                      value={rule.field}
                      onChange={(e) => handleRuleChange(index, 'field', e.target.value)}
                      label="Field"
                    >
                      {choices?.fields.map((f) => (
                        <MenuItem key={f.value} value={f.value}>{f.label}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <FormControl size="small" sx={{ minWidth: 160 }}>
                    <InputLabel>Operator</InputLabel>
                    <Select
                      value={rule.operator}
                      onChange={(e) => handleRuleChange(index, 'operator', e.target.value)}
                      label="Operator"
                    >
                      {choices?.operators
                        .filter((op) => getApplicableOperators(rule.field).includes(op.value))
                        .map((op) => (
                          <MenuItem key={op.value} value={op.value}>{op.label}</MenuItem>
                        ))}
                    </Select>
                  </FormControl>

                  {!['is_true', 'is_false', 'is_set', 'is_not_set'].includes(rule.operator) && (
                    <TextField
                      size="small"
                      label="Value"
                      value={rule.value}
                      onChange={(e) => handleRuleChange(index, 'value', e.target.value)}
                      sx={{ minWidth: 120 }}
                    />
                  )}

                  {rule.operator === 'between' && (
                    <TextField
                      size="small"
                      label="To"
                      value={rule.value_2 || ''}
                      onChange={(e) => handleRuleChange(index, 'value_2', e.target.value)}
                      sx={{ width: 80 }}
                    />
                  )}

                  <IconButton size="small" onClick={() => handleRemoveRule(index)} color="error">
                    <RemoveIcon />
                  </IconButton>
                </Box>
              ))}
            </Paper>
          )}

          <Button startIcon={<AddIcon />} onClick={handleAddRule} size="small">
            Add Rule
          </Button>

          <Divider sx={{ my: 3 }} />

          {/* Order By and Limit */}
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth size="small">
                <InputLabel>Order By</InputLabel>
                <Select
                  value={editingOrderBy}
                  onChange={(e) => setEditingOrderBy(e.target.value)}
                  label="Order By"
                >
                  {choices?.order_by_options.map((opt) => (
                    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                size="small"
                label="Limit (empty = unlimited)"
                type="number"
                value={editingLimit}
                onChange={(e) => setEditingLimit(e.target.value ? parseInt(e.target.value) : '')}
                InputProps={{ inputProps: { min: 1 } }}
              />
            </Grid>
          </Grid>

          {/* Preview */}
          <Box sx={{ mt: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
            <Button
              variant="outlined"
              startIcon={previewLoading ? <CircularProgress size={16} /> : <PreviewIcon />}
              onClick={handlePreview}
              disabled={previewLoading}
            >
              Preview
            </Button>
            {previewCount !== null && (
              <Typography variant="body2" color="text.secondary">
                {previewCount} tracks would match
              </Typography>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleSaveRules} variant="contained">
            Save Rules
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={4000}
        onClose={() => setSnackbarOpen(false)}
      >
        <Alert severity="success" onClose={() => setSnackbarOpen(false)}>
          {snackbarMessage}
        </Alert>
      </Snackbar>
    </Box>
  );
}
