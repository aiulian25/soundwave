import { Component, ReactNode } from 'react';
import { Box, Typography, Button } from '@mui/material';
import { useTranslation } from 'react-i18next';

// Localized fallback shown when a lazy chunk genuinely can't load (e.g. offline).
function LazyLoadFallback() {
  const { t } = useTranslation();
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '50vh',
        gap: 2,
        p: 3,
        textAlign: 'center',
      }}
    >
      <Typography variant="h6">{t('common.lazyLoadError.title')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 360 }}>
        {t('common.lazyLoadError.description')}
      </Typography>
      <Button variant="contained" onClick={() => window.location.reload()}>
        {t('common.lazyLoadError.retry')}
      </Button>
    </Box>
  );
}

interface Props {
  children: ReactNode;
}
interface State {
  failed: boolean;
}

/**
 * Catches errors from code-split route chunks. A failed dynamic import happens when:
 *  - the deployed chunk hashes changed (stale index) → a one-time reload pulls fresh assets;
 *  - the user is offline and the chunk was never cached → show a localized retry instead
 *    of a white screen.
 */
export default class LazyRouteBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(error: unknown): State {
    const msg = error instanceof Error ? error.message : String(error);
    const isChunkError =
      /ChunkLoadError|Loading chunk|dynamically imported module|Importing a module|Failed to fetch/i.test(msg);
    if (isChunkError && !sessionStorage.getItem('sw_chunk_reloaded')) {
      // Likely a stale chunk after a deploy — reload once to get the fresh manifest.
      sessionStorage.setItem('sw_chunk_reloaded', '1');
      window.location.reload();
    }
    return { failed: true };
  }

  render() {
    return this.state.failed ? <LazyLoadFallback /> : this.props.children;
  }
}
