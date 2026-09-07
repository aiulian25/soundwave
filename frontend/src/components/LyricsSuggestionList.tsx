import {
  Box,
  Button,
  Chip,
  CircularProgress,
  List,
  ListItem,
  ListItemText,
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useTranslation } from 'react-i18next';

const SECONDS_PER_MINUTE = 60;
const APPLY_BUTTON_MIN_WIDTH = 70;
const TAG_CHIP_HEIGHT = 20;

export interface LyricsSuggestion {
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

interface LyricsSuggestionListProps {
  suggestions: LyricsSuggestion[];
  applyingId: number | null;
  onApply: (suggestion: LyricsSuggestion) => void;
}

const formatDuration = (seconds: number) => {
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const remainingSeconds = seconds % SECONDS_PER_MINUTE;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

/** The rows of a LRCLIB suggestion list. The caller owns the surrounding scroll container and
 * heading, which differ between the empty-lyrics screen and the "find different lyrics" panel. */
export default function LyricsSuggestionList({ suggestions, applyingId, onApply }: LyricsSuggestionListProps) {
  const { t } = useTranslation();

  return (
    <List dense sx={{ bgcolor: 'background.paper', borderRadius: 1 }}>
      {suggestions.map((suggestion) => {
        const isApplying = applyingId === suggestion.id;
        return (
          <ListItem
            key={suggestion.id}
            sx={{
              borderBottom: '1px solid',
              borderColor: 'divider',
              '&:last-child': { borderBottom: 'none' },
              display: 'flex',
              alignItems: 'center',
              pr: 1,
            }}
            secondaryAction={
              <Button
                size="small"
                variant="contained"
                color="primary"
                onClick={() => onApply(suggestion)}
                disabled={isApplying}
                startIcon={isApplying ? <CircularProgress size={16} /> : <CheckCircleIcon />}
                sx={{ minWidth: APPLY_BUTTON_MIN_WIDTH }}
              >
                {isApplying ? t('lyrics.actions.applying') : t('lyrics.actions.use')}
              </Button>
            }
          >
            <ListItemText
              sx={{ pr: 8 }}
              primary={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography variant="body2" sx={{ fontWeight: 500, wordBreak: 'break-word' }}>
                    "{suggestion.track_name}"
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
                    {t('lyrics.search.byArtist', { artist: suggestion.artist_name })}
                  </Typography>
                </Box>
              }
              secondary={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
                  {suggestion.has_synced && (
                    <Chip label={t('lyrics.tags.synced')} size="small" color="success" sx={{ height: TAG_CHIP_HEIGHT }} />
                  )}
                  {suggestion.has_plain && !suggestion.has_synced && (
                    <Chip label={t('lyrics.tags.plain')} size="small" sx={{ height: TAG_CHIP_HEIGHT }} />
                  )}
                  {suggestion.instrumental && (
                    <Chip label={t('lyrics.tags.instrumental')} size="small" color="info" sx={{ height: TAG_CHIP_HEIGHT }} />
                  )}
                  <Typography variant="caption" color="text.secondary">
                    {formatDuration(suggestion.duration)}
                  </Typography>
                  {suggestion.album_name && (
                    <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
                      • {suggestion.album_name}
                    </Typography>
                  )}
                </Box>
              }
            />
          </ListItem>
        );
      })}
    </List>
  );
}
