import { Tabs, Tab } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

// The four pages about what was listened to. They keep their own addresses and share this bar,
// so the sidebar needs one entry for them instead of four.
export const STATS_TABS = [
  { path: '/analytics', labelKey: 'sidebar.analytics' },
  { path: '/history', labelKey: 'sidebar.history' },
  { path: '/achievements', labelKey: 'sidebar.achievements' },
  { path: '/wrapped', labelKey: 'sidebar.yearlyWrapped' },
];
export const STATS_HOME_PATH = STATS_TABS[0].path;
export const isStatsPath = (pathname: string) => STATS_TABS.some((tab) => tab.path === pathname);

export default function StatsTabs() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <Tabs
      value={location.pathname}
      onChange={(_event, path: string) => navigate(path)}
      variant="scrollable"
      scrollButtons="auto"
      aria-label={t('sidebar.stats')}
      data-testid="stats-tabs"
      sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
    >
      {STATS_TABS.map((tab) => (
        <Tab key={tab.path} value={tab.path} label={t(tab.labelKey)} />
      ))}
    </Tabs>
  );
}
