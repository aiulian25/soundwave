import { useState } from 'react';
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
} from '@mui/material';
import MusicNoteIcon from '@mui/icons-material/MusicNote';
import FolderZipIcon from '@mui/icons-material/FolderZip';
import LyricsIcon from '@mui/icons-material/Lyrics';
import ImageIcon from '@mui/icons-material/Image';
import { useTranslation } from 'react-i18next';
import { playlistAPI } from '../api/client';

interface PlaylistExportDialogProps {
  open: boolean;
  onClose: () => void;
  playlistId: string;
  playlistTitle: string;
  trackCount: number;
  onExported?: () => void;
}

type ExportFormat = 'mp3' | 'flac';
type ExportQuality = 'high' | 'medium' | 'low';

export default function PlaylistExportDialog({
  open,
  onClose,
  playlistId,
  playlistTitle,
  trackCount,
  onExported,
}: PlaylistExportDialogProps) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<ExportFormat>('mp3');
  const [quality, setQuality] = useState<ExportQuality>('high');
  const [embedLyrics, setEmbedLyrics] = useState(true);
  const [embedArtwork, setEmbedArtwork] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const getQualityLabel = (value: ExportQuality) => t(`downloadDialog.quality.${value}`);

  const triggerBrowserDownload = (data: BlobPart, filename: string) => {
    const blob = new Blob([data], { type: 'application/zip' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const handleExport = async () => {
    try {
      setExporting(true);
      setError('');
      const response = await playlistAPI.export(playlistId, {
        format,
        quality,
        embed_lyrics: embedLyrics,
        embed_artwork: embedArtwork,
      });

      let filename = `${playlistTitle || 'playlist'}.zip`;
      const contentDisposition = response.headers['content-disposition'];
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="(.+)"/);
        if (match) {
          filename = match[1];
        }
      }

      triggerBrowserDownload(response.data, filename);
      onExported?.();
      onClose();
    } catch (err: any) {
      // With responseType 'blob', error bodies arrive as Blobs — read them so the
      // server's specific message (track limit, "already in progress", …) is shown.
      let message = t('playlistDetail.export.failed');
      const data = err?.response?.data;
      if (data instanceof Blob) {
        try {
          const parsed = JSON.parse(await data.text());
          if (parsed?.error) {
            message = parsed.error;
          }
        } catch {
          // keep the generic message
        }
      } else if (data?.error) {
        message = data.error;
      }
      setError(message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog open={open} onClose={exporting ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <FolderZipIcon />
        {t('playlistDetail.export.action')}
      </DialogTitle>

      <DialogContent dividers>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Typography variant="body2" color="text.secondary">
            {t('playlistDetail.export.summary', { count: trackCount })}
          </Typography>

          <FormControl component="fieldset">
            <FormLabel component="legend" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <MusicNoteIcon fontSize="small" />
              {t('downloadDialog.sections.outputFormat')}
            </FormLabel>
            <RadioGroup value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
              <FormControlLabel value="mp3" control={<Radio />} label="MP3" />
              <FormControlLabel value="flac" control={<Radio />} label="FLAC" />
            </RadioGroup>
          </FormControl>

          {format === 'mp3' && (
            <FormControl fullWidth size="small">
              <InputLabel>{t('downloadDialog.sections.quality')}</InputLabel>
              <Select
                value={quality}
                label={t('downloadDialog.sections.quality')}
                onChange={(e) => setQuality(e.target.value as ExportQuality)}
              >
                <MenuItem value="high">{getQualityLabel('high')}</MenuItem>
                <MenuItem value="medium">{getQualityLabel('medium')}</MenuItem>
                <MenuItem value="low">{getQualityLabel('low')}</MenuItem>
              </Select>
            </FormControl>
          )}

          <Divider />

          <Box>
            <FormControlLabel
              control={<Checkbox checked={embedArtwork} onChange={(e) => setEmbedArtwork(e.target.checked)} />}
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <ImageIcon fontSize="small" />
                  {t('downloadDialog.artwork.embed')}
                </Box>
              }
            />
            <FormControlLabel
              control={<Checkbox checked={embedLyrics} onChange={(e) => setEmbedLyrics(e.target.checked)} />}
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <LyricsIcon fontSize="small" />
                  {t('downloadDialog.lyrics.embed')}
                </Box>
              }
            />
          </Box>

          {exporting && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <CircularProgress size={20} />
              <Typography variant="body2" color="text.secondary">
                {t('playlistDetail.export.preparing')}
              </Typography>
            </Box>
          )}

          {error && <Alert severity="error">{error}</Alert>}
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={exporting}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={handleExport}
          disabled={exporting}
          startIcon={exporting ? <CircularProgress size={20} /> : <FolderZipIcon />}
        >
          {exporting ? t('playlistDetail.export.progress', { count: trackCount }) : t('playlistDetail.export.action')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
