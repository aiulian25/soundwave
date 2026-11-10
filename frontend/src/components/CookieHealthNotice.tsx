import { Alert, AlertTitle } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { CookieHealth } from '../hooks/useCookieHealth';

interface CookieHealthNoticeProps {
  state: CookieHealth | null;
  /** Settings shows the state whatever it is; the activity panel speaks up only when downloads are failing. */
  showWhenFine?: boolean;
}

const SEVERITY_BY_STATE = {
  working: 'success',
  unknown: 'info',
  needs_new_cookies: 'warning',
  file_not_accessible: 'warning',
} as const;
const NEEDS_ATTENTION: CookieHealth[] = ['needs_new_cookies', 'file_not_accessible'];

/** Says whether YouTube still accepts the server's sign-in, and what to do when it does not. */
export default function CookieHealthNotice({ state, showWhenFine = false }: CookieHealthNoticeProps) {
  const { t } = useTranslation();

  if (state === null) return null;
  if (!showWhenFine && !NEEDS_ATTENTION.includes(state)) return null;

  return (
    <Alert severity={SEVERITY_BY_STATE[state]} data-testid="cookie-health" data-state={state} sx={{ alignItems: 'flex-start' }}>
      <AlertTitle>{t(`cookieHealth.title.${state}`)}</AlertTitle>
      {t(`cookieHealth.detail.${state}`)}
    </Alert>
  );
}
