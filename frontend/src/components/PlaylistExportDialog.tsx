import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  LinearProgress,
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
import { exportJobAPI, playlistAPI } from '../api/client';
import { useExportJob } from '../hooks/useExportJob';
import { exportErrorMessage } from '../utils/exportErrors';

interface PlaylistExportDialogProps {
  open: boolean;
  onClose: () => void;
  playlistId: string;
  playlistTitle: string;
  trackCount: number;
  onExported?: () => void;
}

type ExportFormat = 'mp3' | 'flac';
type ExportQuality = 'high' | 'medium' | 'low' | 'original';

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
  const [partialResult, setPartialResult] = useState<{ omitted: number; warned: number } | null>(null);

  const { job, isActive: jobIsActive, follow: followJob, cancel: cancelJob } = useExportJob(playlistId, open);
  const jobIsReady = job?.status === 'ready';
  const jobOmitted = job?.summary?.omitted?.length ?? 0;
  const jobWarned = job?.summary?.warnings?.length ?? 0;

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
      setPartialResult(null);
      const response = await playlistAPI.export(playlistId, {
        format,
        quality,
        embed_lyrics: embedLyrics,
        embed_artwork: embedArtwork,
      });

      // Too big for one request: the server took it on as a background export.
      if (response.status === 202) {
        const { job_id: jobId } = JSON.parse(await (response.data as Blob).text());
        await followJob(jobId);
        return;
      }

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

      // The ZIP is delivered either way; stay open so what is missing from it gets read.
      const omitted = Number(response.headers['x-export-omitted'] ?? 0);
      const warned = Number(response.headers['x-export-warned'] ?? 0);
      if (omitted > 0 || warned > 0) {
        setPartialResult({ omitted, warned });
        return;
      }
      onClose();
    } catch (err: any) {
      setError((await exportErrorMessage(err)) || t('playlistDetail.export.failed'));
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
                <MenuItem value="original">{getQualityLabel('original')}</MenuItem>
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

          {jobIsActive && job && (
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {t('playlistDetail.export.jobProgress', { done: job.tracks_done, total: job.tracks_total })}
              </Typography>
              <LinearProgress
                variant="determinate"
                value={job.tracks_total ? (job.tracks_done / job.tracks_total) * 100 : 0}
              />
              <Typography variant="caption" color="text.secondary">
                {t('playlistDetail.export.jobContinues')}
              </Typography>
            </Box>
          )}
          {job?.status === 'failed' && <Alert severity="error">{job.error || t('playlistDetail.export.failed')}</Alert>}
          {jobIsReady && (jobOmitted > 0 || jobWarned > 0) && (
            <Alert severity="warning">{t('playlistDetail.export.partial', { omitted: jobOmitted, warned: jobWarned })}</Alert>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          {partialResult && (
            <Alert severity="warning">{t('playlistDetail.export.partial', partialResult)}</Alert>
          )}
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={exporting}>
          {t('common.close')}
        </Button>
        {jobIsActive && (
          <Button color="error" onClick={() => cancelJob().catch(console.error)}>
            {t('playlistDetail.export.cancelJob')}
          </Button>
        )}
        {jobIsReady && job && (
          <Button variant="contained" component="a" href={exportJobAPI.downloadUrl(job.id)} download>
            {t('playlistDetail.export.downloadReady')}
          </Button>
        )}
        <Button
          variant="contained"
          onClick={handleExport}
          disabled={exporting || jobIsActive}
          startIcon={exporting ? <CircularProgress size={20} /> : <FolderZipIcon />}
        >
          {exporting ? t('playlistDetail.export.progress', { count: trackCount }) : t('playlistDetail.export.action')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
