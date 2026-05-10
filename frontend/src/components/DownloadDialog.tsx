import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Checkbox,
  Box,
  Typography,
  CircularProgress,
  Alert,
  Divider,
  Select,
  MenuItem,
  InputLabel,
  Avatar,
  Chip,
  Stack,
} from '@mui/material';
import MusicNoteIcon from '@mui/icons-material/MusicNote';
import DownloadIcon from '@mui/icons-material/Download';
import LyricsIcon from '@mui/icons-material/Lyrics';
import ImageIcon from '@mui/icons-material/Image';
import HighQualityIcon from '@mui/icons-material/HighQuality';
import { useTranslation } from 'react-i18next';
import api from '../api/client';

interface ArtworkSource {
  type: string;
  url: string;
  label: string;
  priority?: number;
}

interface ExportOptions {
  youtube_id: string;
  title: string;
  artist: string;
  album: string;
  current_format: string;
  available_formats: string[];
  has_lyrics: boolean;
  has_synced_lyrics: boolean;
  has_artwork: boolean;
  artwork_sources: ArtworkSource[];
  metadata: {
    title: string;
    artist: string;
    album: string | null;
    year: number | null;
    genre: string | null;
    track_number: number | null;
  };
}

interface DownloadDialogProps {
  open: boolean;
  onClose: () => void;
  youtubeId: string;
  title?: string;
}

export default function DownloadDialog({ open, onClose, youtubeId, title }: DownloadDialogProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [options, setOptions] = useState<ExportOptions | null>(null);
  
  // Export settings
  const [format, setFormat] = useState<'mp3' | 'flac'>('mp3');
  const [quality, setQuality] = useState<'high' | 'medium' | 'low'>('high');
  const [embedLyrics, setEmbedLyrics] = useState(true);
  const [embedArtwork, setEmbedArtwork] = useState(true);
  const [selectedArtwork, setSelectedArtwork] = useState('');

  useEffect(() => {
    if (open && youtubeId) {
      loadExportOptions();
    }
  }, [open, youtubeId]);

  const loadExportOptions = async () => {
    try {
      setLoading(true);
      setError('');
      console.log(`[Export] Loading options for ${youtubeId}`);
      const response = await api.get(`/audio/${youtubeId}/export/`);
      console.log('[Export] Response:', response.data);
      console.log(`[Export] has_lyrics=${response.data.has_lyrics}, has_synced=${response.data.has_synced_lyrics}`);
      setOptions(response.data);
      
      // Set default artwork source
      if (response.data.artwork_sources?.length > 0) {
        setSelectedArtwork(response.data.artwork_sources[0].url);
      }
    } catch (err: any) {
      console.error('[Export] Error:', err);
      setError(err.response?.data?.error || t('downloadDialog.errors.loadOptionsFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      setExporting(true);
      setError('');
      
      const response = await api.post(
        `/audio/${youtubeId}/export/`,
        {
          format,
          quality,
          embed_lyrics: embedLyrics,
          embed_artwork: embedArtwork,
          artwork_url: embedArtwork ? selectedArtwork : '',
        },
        {
          responseType: 'blob',
        }
      );
      
      // Get filename from Content-Disposition header
      const contentDisposition = response.headers['content-disposition'];
      let filename = `${options?.title || t('downloadDialog.fallback.audioFilename')}.${format}`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="(.+)"/);
        if (match) {
          filename = match[1];
        }
      }
      
      // Create download link
      const blob = new Blob([response.data], { 
        type: format === 'mp3' ? 'audio/mpeg' : 'audio/flac' 
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      onClose();
    } catch (err: any) {
      console.error('Export failed:', err);
      setError(err.response?.data?.error || t('downloadDialog.errors.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  const getFormatLabel = (fmt: string) => {
    switch (fmt) {
      case 'mp3':
        return t('downloadDialog.format.mp3');
      case 'flac':
        return t('downloadDialog.format.flac');
      default:
        return fmt.toUpperCase();
    }
  };

  const getQualityLabel = (q: string) => {
    switch (q) {
      case 'high':
        return t('downloadDialog.quality.high');
      case 'medium':
        return t('downloadDialog.quality.medium');
      case 'low':
        return t('downloadDialog.quality.low');
      default:
        return q;
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <DownloadIcon />
        {t('downloadDialog.title')}
      </DialogTitle>
      
      <DialogContent dividers>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : error && !options ? (
          <Alert severity="error">{error}</Alert>
        ) : options ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* Track Info */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Avatar
                src={options.artwork_sources?.[0]?.url}
                variant="rounded"
                sx={{ width: 64, height: 64 }}
              >
                <MusicNoteIcon />
              </Avatar>
              <Box>
                <Typography variant="subtitle1" fontWeight={600}>
                  {options.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {options.artist}
                </Typography>
                {options.album && (
                  <Typography variant="caption" color="text.secondary">
                    {options.album}
                  </Typography>
                )}
              </Box>
            </Box>

            <Divider />

            {/* Format Selection */}
            <FormControl component="fieldset">
              <FormLabel component="legend" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <MusicNoteIcon fontSize="small" />
                {t('downloadDialog.sections.outputFormat')}
              </FormLabel>
              <RadioGroup
                value={format}
                onChange={(e) => setFormat(e.target.value as 'mp3' | 'flac')}
              >
                <FormControlLabel
                  value="mp3"
                  control={<Radio />}
                  label={
                    <Box>
                      <Typography variant="body2">MP3</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t('downloadDialog.format.mp3Description')}
                      </Typography>
                    </Box>
                  }
                />
                <FormControlLabel
                  value="flac"
                  control={<Radio />}
                  label={
                    <Box>
                      <Typography variant="body2">FLAC</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t('downloadDialog.format.flacDescription')}
                      </Typography>
                    </Box>
                  }
                />
              </RadioGroup>
            </FormControl>

            {/* Quality (MP3 only) */}
            {format === 'mp3' && (
              <FormControl fullWidth size="small">
                <InputLabel>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <HighQualityIcon fontSize="small" />
                    {t('downloadDialog.sections.quality')}
                  </Box>
                </InputLabel>
                <Select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value as 'high' | 'medium' | 'low')}
                  label={t('downloadDialog.sections.quality')}
                >
                  <MenuItem value="high">{getQualityLabel('high')}</MenuItem>
                  <MenuItem value="medium">{getQualityLabel('medium')}</MenuItem>
                  <MenuItem value="low">{getQualityLabel('low')}</MenuItem>
                </Select>
              </FormControl>
            )}

            <Divider />

            {/* Embed Options */}
            <Box>
              <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <LyricsIcon fontSize="small" />
                {t('downloadDialog.sections.lyrics')}
              </Typography>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={embedLyrics}
                    onChange={(e) => setEmbedLyrics(e.target.checked)}
                    disabled={!options.has_lyrics}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2">
                      {t('downloadDialog.lyrics.embed')}
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                      {options.has_synced_lyrics ? (
                        <Chip 
                          label={t('downloadDialog.lyrics.syncedEmbedded', { tag: format === 'mp3' ? 'SYLT' : 'LRC' })} 
                          size="small" 
                          color="success" 
                        />
                      ) : options.has_lyrics ? (
                        <Chip 
                          label={t('downloadDialog.lyrics.plainEmbedded')} 
                          size="small" 
                          color="info" 
                        />
                      ) : (
                        <Chip 
                          label={t('downloadDialog.lyrics.none')} 
                          size="small" 
                          color="default" 
                          variant="outlined"
                        />
                      )}
                    </Stack>
                  </Box>
                }
              />
            </Box>

            <Box>
              <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <ImageIcon fontSize="small" />
                {t('downloadDialog.sections.artwork')}
              </Typography>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={embedArtwork}
                    onChange={(e) => setEmbedArtwork(e.target.checked)}
                    disabled={!options.has_artwork}
                  />
                }
                label={t('downloadDialog.artwork.embed')}
              />
              
              {embedArtwork && options.artwork_sources && options.artwork_sources.length > 0 && (
                <FormControl fullWidth size="small" sx={{ mt: 1 }}>
                  <InputLabel>{t('downloadDialog.artwork.source')}</InputLabel>
                  <Select
                    value={selectedArtwork}
                    onChange={(e) => setSelectedArtwork(e.target.value)}
                    label={t('downloadDialog.artwork.source')}
                  >
                    {options.artwork_sources.map((art, idx) => (
                      <MenuItem key={idx} value={art.url}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Avatar
                            src={art.url}
                            variant="rounded"
                            sx={{ width: 32, height: 32 }}
                          />
                          {art.label}
                        </Box>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
            </Box>

            {error && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {error}
              </Alert>
            )}
          </Box>
        ) : null}
      </DialogContent>
      
      <DialogActions>
        <Button onClick={onClose} disabled={exporting}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={handleExport}
          disabled={loading || exporting || !options}
          startIcon={exporting ? <CircularProgress size={20} /> : <DownloadIcon />}
        >
          {exporting ? t('downloadDialog.actions.exporting') : t('downloadDialog.actions.exportAs', { format: format.toUpperCase() })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
