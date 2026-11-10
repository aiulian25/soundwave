import type { ReactNode } from 'react';
import { Box, Button, CircularProgress, Typography } from '@mui/material';
import MusicNoteIcon from '@mui/icons-material/MusicNote';
import SearchIcon from '@mui/icons-material/Search';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { useTranslation } from 'react-i18next';

interface InstrumentalLyricsProps {
  /** The close and details buttons, when the lyrics panel can be closed. */
  header: ReactNode;
  searching: boolean;
  uploading: boolean;
  /** Clears the "instrumental" mark and looks for lyrics again. */
  onSearch: () => void;
  onUpload: () => void;
  /** The hidden file input and upload notices the panel shares with its other states. */
  uploadControls: ReactNode;
}

/** What the lyrics panel shows for a track marked as having no words. */
export default function InstrumentalLyrics({ header, searching, uploading, onSearch, onUpload, uploadControls }: InstrumentalLyricsProps) {
  const { t } = useTranslation();

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {header}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 4 }}>
        <MusicNoteIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
        <Typography variant="h6" color="text.secondary" gutterBottom>
          {t('lyrics.instrumental.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3, textAlign: 'center' }}>
          {t('lyrics.instrumental.description')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={searching ? <CircularProgress size={16} /> : <SearchIcon />}
            onClick={onSearch}
            disabled={searching}
          >
            {searching ? t('lyrics.actions.clearing') : t('lyrics.actions.searchForLyrics')}
          </Button>
          <Button
            variant="outlined"
            size="small"
            startIcon={uploading ? <CircularProgress size={16} /> : <UploadFileIcon />}
            onClick={onUpload}
            disabled={uploading}
            color="secondary"
          >
            {uploading ? t('lyrics.actions.uploading') : t('lyrics.actions.uploadLrc')}
          </Button>
        </Box>
        {uploadControls}
      </Box>
    </Box>
  );
}
