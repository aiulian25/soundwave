import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  CircularProgress,
  Alert,
  Tabs,
  Tab,
  LinearProgress,
  Chip,
  Tooltip,
  Button,
  Snackbar,
} from '@mui/material';
import {
  EmojiEvents as TrophyIcon,
  LocalFireDepartment as FireIcon,
  MusicNote as MusicIcon,
  AccessTime as TimeIcon,
  TrendingUp as TrendingIcon,
  CheckCircle as CheckIcon,
  Lock as LockIcon,
  Celebration as CelebrationIcon,
  Refresh as RefreshIcon,
  AutoAwesome as SpecialIcon,
} from '@mui/icons-material';
import { statsAPI } from '../api/client';
import type { Achievement, AchievementProgress, StreakInfo } from '../types';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div hidden={value !== index} {...other}>
      {value === index && <Box sx={{ py: 3 }}>{children}</Box>}
    </div>
  );
}

export default function AchievementsPage() {
  const [tabValue, setTabValue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [achievements, setAchievements] = useState<AchievementProgress[]>([]);
  const [streak, setStreak] = useState<StreakInfo | null>(null);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [achievementsRes, streakRes] = await Promise.all([
        statsAPI.achievements({ progress: true }),
        statsAPI.streak(),
      ]);
      setAchievements(achievementsRes.data);
      setStreak(streakRes.data);
      setError('');
    } catch (err: any) {
      console.error('Failed to load achievements:', err);
      setError('Failed to load achievements data');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckAchievements = async () => {
    try {
      const response = await statsAPI.checkAchievements();
      if (response.data.new_achievements?.length > 0) {
        setSnackbarMessage(`🎉 ${response.data.total_new} new achievement(s) unlocked!`);
        setSnackbarOpen(true);
        // Reload achievements to show updated state
        loadData();
      } else {
        setSnackbarMessage('No new achievements yet. Keep listening!');
        setSnackbarOpen(true);
      }
    } catch (err) {
      console.error('Failed to check achievements:', err);
      setSnackbarMessage('Failed to check achievements');
      setSnackbarOpen(true);
    }
  };

  // Group achievements by category
  const groupedAchievements = {
    tracks: achievements.filter(a => a.type.startsWith('tracks_')),
    time: achievements.filter(a => a.type.startsWith('hours_')),
    streaks: achievements.filter(a => a.type.startsWith('streak_')),
    variety: achievements.filter(a => a.type.startsWith('artists_') || a.type.startsWith('channels_')),
    special: achievements.filter(a => 
      !a.type.startsWith('tracks_') && 
      !a.type.startsWith('hours_') && 
      !a.type.startsWith('streak_') && 
      !a.type.startsWith('artists_') && 
      !a.type.startsWith('channels_')
    ),
  };

  const totalUnlocked = achievements.filter(a => a.unlocked).length;
  const totalAchievements = achievements.length;
  const overallProgress = totalAchievements > 0 ? Math.round((totalUnlocked / totalAchievements) * 100) : 0;

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
            🏆 Achievements
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Track your listening milestones and earn badges
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={handleCheckAchievements}
        >
          Check for New
        </Button>
      </Box>

      {/* Streak Card */}
      {streak && (
        <Card 
          sx={{ 
            mb: 3, 
            bgcolor: streak.streak_at_risk 
              ? 'rgba(255, 152, 0, 0.1)' 
              : streak.current_streak > 0 
                ? 'rgba(19, 236, 106, 0.1)' 
                : 'background.paper',
            border: '1px solid',
            borderColor: streak.streak_at_risk 
              ? 'warning.main' 
              : streak.current_streak > 0 
                ? 'primary.main' 
                : 'divider',
          }}
        >
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
              <FireIcon 
                sx={{ 
                  fontSize: 48, 
                  color: streak.current_streak > 0 ? 'warning.main' : 'text.secondary',
                  animation: streak.current_streak >= 7 ? 'pulse 2s infinite' : 'none',
                  '@keyframes pulse': {
                    '0%, 100%': { transform: 'scale(1)' },
                    '50%': { transform: 'scale(1.1)' },
                  },
                }} 
              />
              <Box sx={{ flex: 1, minWidth: 200 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography variant="h4" sx={{ fontWeight: 700 }}>
                    {streak.current_streak} Day Streak
                  </Typography>
                  {streak.streak_at_risk && (
                    <Chip 
                      label="⚠️ At Risk!" 
                      color="warning" 
                      size="small" 
                    />
                  )}
                  {streak.current_streak >= 7 && (
                    <Chip 
                      label="🔥 On Fire!" 
                      color="error" 
                      size="small" 
                    />
                  )}
                </Box>
                <Typography variant="body2" color="text.secondary">
                  {streak.listened_today 
                    ? "Great job! You've listened today. Keep it up!" 
                    : "Listen to a track today to maintain your streak!"}
                </Typography>
              </Box>
              <Box sx={{ textAlign: 'center', px: 2, borderLeft: '1px solid', borderColor: 'divider' }}>
                <Typography variant="caption" color="text.secondary">
                  Best Streak
                </Typography>
                <Typography variant="h5" sx={{ fontWeight: 700, color: 'success.main' }}>
                  {streak.longest_streak}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  days
                </Typography>
              </Box>
            </Box>

            {/* Weekly Activity Grid */}
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              This Week
            </Typography>
            <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'space-between' }}>
              {streak.recent_days.map((day) => (
                <Tooltip 
                  key={day.date} 
                  title={`${day.day_name}: ${day.tracks_played} tracks played`}
                  arrow
                >
                  <Box sx={{ textAlign: 'center', flex: 1 }}>
                    <Typography 
                      variant="caption" 
                      sx={{ 
                        color: day.has_activity ? 'primary.main' : 'text.secondary',
                        fontWeight: day.has_activity ? 600 : 400,
                      }}
                    >
                      {day.day_name}
                    </Typography>
                    <Box
                      sx={{
                        width: '100%',
                        aspectRatio: '1',
                        maxWidth: 48,
                        borderRadius: 1.5,
                        mx: 'auto',
                        mt: 0.5,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        bgcolor: day.has_activity 
                          ? 'primary.main' 
                          : 'rgba(255, 255, 255, 0.05)',
                        color: day.has_activity ? 'background.dark' : 'text.secondary',
                        fontWeight: 700,
                        fontSize: '0.875rem',
                        transition: 'all 0.3s ease',
                        border: '2px solid',
                        borderColor: day.has_activity ? 'primary.main' : 'transparent',
                      }}
                    >
                      {day.has_activity ? day.tracks_played : '–'}
                    </Box>
                  </Box>
                </Tooltip>
              ))}
            </Box>

            {/* Next Milestone Progress */}
            {streak.next_milestone && streak.current_streak > 0 && (
              <Box sx={{ mt: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="body2" color="text.secondary">
                    Next milestone: <strong>{streak.next_milestone}-day streak</strong>
                  </Typography>
                  <Typography variant="body2" color="primary.main" fontWeight={600}>
                    {streak.days_to_milestone} days to go
                  </Typography>
                </Box>
                <LinearProgress 
                  variant="determinate" 
                  value={(streak.current_streak / streak.next_milestone) * 100}
                  sx={{ height: 8, borderRadius: 1 }}
                />
              </Box>
            )}
          </CardContent>
        </Card>
      )}

      {/* Overall Progress */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <TrophyIcon sx={{ fontSize: 48, color: 'warning.main' }} />
            <Box sx={{ flex: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>
                {totalUnlocked} of {totalAchievements} Achievements Unlocked
              </Typography>
              <LinearProgress 
                variant="determinate" 
                value={overallProgress}
                sx={{ height: 10, borderRadius: 1 }}
              />
            </Box>
            <Typography variant="h3" sx={{ fontWeight: 700, color: 'primary.main', minWidth: 80, textAlign: 'right' }}>
              {overallProgress}%
            </Typography>
          </Box>
        </CardContent>
      </Card>

      {/* Category Tabs */}
      <Tabs 
        value={tabValue} 
        onChange={(_, v) => setTabValue(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ 
          mb: 2, 
          borderBottom: 1, 
          borderColor: 'divider',
          '& .MuiTab-root': {
            minHeight: 48,
            textTransform: 'none',
            fontWeight: 500,
          },
        }}
      >
        <Tab 
          label={`All (${totalUnlocked}/${totalAchievements})`} 
          icon={<TrophyIcon sx={{ fontSize: 20 }} />} 
          iconPosition="start" 
        />
        <Tab 
          label={`Tracks (${groupedAchievements.tracks.filter(a => a.unlocked).length})`} 
          icon={<MusicIcon sx={{ fontSize: 20 }} />} 
          iconPosition="start" 
        />
        <Tab 
          label={`Time (${groupedAchievements.time.filter(a => a.unlocked).length})`} 
          icon={<TimeIcon sx={{ fontSize: 20 }} />} 
          iconPosition="start" 
        />
        <Tab 
          label={`Streaks (${groupedAchievements.streaks.filter(a => a.unlocked).length})`} 
          icon={<FireIcon sx={{ fontSize: 20 }} />} 
          iconPosition="start" 
        />
        <Tab 
          label={`Variety (${groupedAchievements.variety.filter(a => a.unlocked).length})`} 
          icon={<TrendingIcon sx={{ fontSize: 20 }} />} 
          iconPosition="start" 
        />
        <Tab 
          label={`Special (${groupedAchievements.special.filter(a => a.unlocked).length})`} 
          icon={<SpecialIcon sx={{ fontSize: 20 }} />} 
          iconPosition="start" 
        />
      </Tabs>

      {/* Tab Panels */}
      <TabPanel value={tabValue} index={0}>
        <AchievementGrid achievements={achievements} />
      </TabPanel>
      <TabPanel value={tabValue} index={1}>
        <AchievementGrid achievements={groupedAchievements.tracks} />
      </TabPanel>
      <TabPanel value={tabValue} index={2}>
        <AchievementGrid achievements={groupedAchievements.time} />
      </TabPanel>
      <TabPanel value={tabValue} index={3}>
        <AchievementGrid achievements={groupedAchievements.streaks} />
      </TabPanel>
      <TabPanel value={tabValue} index={4}>
        <AchievementGrid achievements={groupedAchievements.variety} />
      </TabPanel>
      <TabPanel value={tabValue} index={5}>
        <AchievementGrid achievements={groupedAchievements.special} />
      </TabPanel>

      <Snackbar
        open={snackbarOpen}
        autoHideDuration={4000}
        onClose={() => setSnackbarOpen(false)}
        message={snackbarMessage}
      />
    </Box>
  );
}

// Achievement Grid Component
function AchievementGrid({ achievements }: { achievements: AchievementProgress[] }) {
  // Sort: unlocked first, then by progress descending
  const sorted = [...achievements].sort((a, b) => {
    if (a.unlocked && !b.unlocked) return -1;
    if (!a.unlocked && b.unlocked) return 1;
    return b.progress - a.progress;
  });

  if (sorted.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 4 }}>
        <Typography color="text.secondary">No achievements in this category</Typography>
      </Box>
    );
  }

  return (
    <Grid container spacing={2}>
      {sorted.map((achievement) => (
        <Grid item xs={12} sm={6} md={4} key={achievement.type}>
          <Card 
            sx={{ 
              height: '100%',
              bgcolor: achievement.unlocked 
                ? 'rgba(19, 236, 106, 0.08)' 
                : 'background.paper',
              border: '1px solid',
              borderColor: achievement.unlocked 
                ? 'primary.main' 
                : 'divider',
              opacity: achievement.unlocked ? 1 : 0.8,
              transition: 'all 0.3s ease',
              '&:hover': {
                transform: 'translateY(-4px)',
                boxShadow: achievement.unlocked 
                  ? '0 8px 24px rgba(19, 236, 106, 0.2)' 
                  : '0 8px 24px rgba(0, 0, 0, 0.2)',
              },
            }}
          >
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, mb: 2 }}>
                <Box 
                  sx={{ 
                    fontSize: 40, 
                    lineHeight: 1,
                    filter: achievement.unlocked ? 'none' : 'grayscale(100%)',
                    opacity: achievement.unlocked ? 1 : 0.5,
                  }}
                >
                  {achievement.icon}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography 
                      variant="subtitle1" 
                      sx={{ 
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {achievement.name}
                    </Typography>
                    {achievement.unlocked ? (
                      <CheckIcon sx={{ fontSize: 18, color: 'success.main', flexShrink: 0 }} />
                    ) : (
                      <LockIcon sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0 }} />
                    )}
                  </Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                    {achievement.description}
                  </Typography>
                </Box>
              </Box>

              {/* Progress Bar */}
              <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    {achievement.unlocked ? 'Completed!' : 'Progress'}
                  </Typography>
                  <Typography 
                    variant="caption" 
                    sx={{ 
                      fontWeight: 600,
                      color: achievement.unlocked ? 'success.main' : 'text.primary',
                    }}
                  >
                    {typeof achievement.current === 'number' && achievement.current < 1 
                      ? achievement.current.toFixed(1) 
                      : Math.floor(achievement.current)} / {achievement.threshold}
                  </Typography>
                </Box>
                <LinearProgress 
                  variant="determinate" 
                  value={achievement.progress}
                  color={achievement.unlocked ? 'success' : 'primary'}
                  sx={{ 
                    height: 8, 
                    borderRadius: 1,
                    bgcolor: 'rgba(255, 255, 255, 0.1)',
                  }}
                />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
}
