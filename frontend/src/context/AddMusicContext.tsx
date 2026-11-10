import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Snackbar } from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AddMusicDialog from '../components/AddMusicDialog';
import { notifyActivityChanged } from '../hooks/useActivityCenter';
import type { AddMusicOutcome } from '../utils/addMusic';
import { firstLinkIn } from '../utils/musicLink';

const OUTCOME_VISIBLE_MS = 6000;
// What another app's share sheet fills in; where the link lands varies by app.
const SHARED_FIELDS = ['url', 'text', 'title'];

type OpenAddMusic = (link?: string) => void;

const AddMusicContext = createContext<OpenAddMusic>(() => {});

/** Opens the one place where anything is added: a track, a playlist or a channel. */
export const useAddMusic = () => useContext(AddMusicContext);

export function AddMusicProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [link, setLink] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<AddMusicOutcome | null>(null);

  const openAddMusic = useCallback<OpenAddMusic>((initialLink = '') => setLink(initialLink), []);
  const close = () => setLink(null);
  const reportOutcome = (result: AddMusicOutcome) => {
    close();
    setOutcome(result);
    notifyActivityChanged();
  };

  return (
    <AddMusicContext.Provider value={openAddMusic}>
      {children}
      <AddMusicDialog open={link !== null} initialLink={link ?? ''} onClose={close} onAdded={reportOutcome} />
      <Snackbar
        open={outcome !== null}
        autoHideDuration={OUTCOME_VISIBLE_MS}
        onClose={() => setOutcome(null)}
        message={outcome ? t(`addMusic.outcome.${outcome}`) : ''}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        data-testid="add-music-outcome"
      />
    </AddMusicContext.Provider>
  );
}

/** Where the installed app lands when a link is shared to it: opens the dialog with the link. */
export function SharedLinkRoute() {
  const [shared] = useSearchParams();
  const openAddMusic = useAddMusic();
  const navigate = useNavigate();

  useEffect(() => {
    const sharedText = SHARED_FIELDS.map((field) => shared.get(field) ?? '').join(' ');
    openAddMusic(firstLinkIn(sharedText));
    navigate('/', { replace: true });
  }, [shared, openAddMusic, navigate]);

  return null;
}
