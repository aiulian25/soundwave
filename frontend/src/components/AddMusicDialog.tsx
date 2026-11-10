import { useEffect, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { addMusic, serverExplanation, type AddMusicOutcome, type AddMusicRequest } from '../utils/addMusic';
import { classifyMusicLink, type MusicLink } from '../utils/musicLink';

interface AddMusicDialogProps {
  open: boolean;
  initialLink: string;
  onClose: () => void;
  onAdded: (outcome: AddMusicOutcome) => void;
}

/** What the main button does for this link, or nothing while there is no usable link. */
function mainRequest(link: MusicLink): AddMusicRequest | null {
  if (link.kind === 'track' || link.kind === 'playlist' || link.kind === 'channel') {
    return { kind: link.kind, url: link.url };
  }
  if (link.kind === 'trackInPlaylist') return { kind: 'track', url: link.trackUrl };
  return null;
}

export default function AddMusicDialog({ open, initialLink, onClose, onAdded }: AddMusicDialogProps) {
  const { t } = useTranslation();
  const [text, setText] = useState(initialLink);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setText(initialLink);
    setError('');
  }, [open, initialLink]);

  const link = classifyMusicLink(text);
  const request = mainRequest(link);
  const subscribes = request !== null && request.kind !== 'track';

  const submit = async (chosen: AddMusicRequest) => {
    setError('');
    setSubmitting(true);
    try {
      onAdded(await addMusic(chosen));
    } catch (failure) {
      setError(serverExplanation(failure) || t('addMusic.errors.refused'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth data-testid="add-music-dialog">
      <DialogTitle>{t('addMusic.title')}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <TextField
          autoFocus
          fullWidth
          margin="dense"
          label={t('addMusic.linkLabel')}
          placeholder="https://www.youtube.com/watch?v=…"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && request && !submitting) submit(request);
          }}
          error={link.kind === 'invalid'}
          helperText={t(`addMusic.hint.${link.kind}`)}
          inputProps={{ 'data-testid': 'add-music-link', inputMode: 'url' }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          {t('common.cancel')}
        </Button>
        {link.kind === 'trackInPlaylist' && (
          <Button
            onClick={() => submit({ kind: 'playlist', url: link.playlistUrl })}
            disabled={submitting}
            data-testid="add-music-subscribe-playlist"
          >
            {t('addMusic.actions.subscribeToPlaylist')}
          </Button>
        )}
        <Button
          variant="contained"
          onClick={() => request && submit(request)}
          disabled={!request || submitting}
          data-testid="add-music-submit"
        >
          {t(subscribes ? 'addMusic.actions.subscribe' : 'addMusic.actions.download')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
