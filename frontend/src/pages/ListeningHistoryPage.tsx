/**
 * Listening History Page
 * 
 * Shows a timeline of recently played tracks with:
 * - Grouped by time periods (Today, Yesterday, This Week, etc.)
 * - "On This Day" memories section
 * - Jump back to where you left off
 * - Clear history options
 */

import { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  CircularProgress,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  ListItemSecondaryAction,
  Avatar,
  IconButton,
  Chip,
  Divider,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Skeleton,
  Tooltip,
  useTheme,
  alpha,
  Collapse,
  Paper,
  Fab,
  Zoom,
} from '@mui/material';
import {
  History as HistoryIcon,
  PlayArrow as PlayIcon,
  Today as TodayIcon,
  CalendarMonth as CalendarIcon,
  AccessTime as TimeIcon,
  Delete as DeleteIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  MusicNote as MusicNoteIcon,
  Celebration as CelebrationIcon,
  Refresh as RefreshIcon,
  KeyboardArrowUp as KeyboardArrowUpIcon,
} from '@mui/icons-material';
import { statsAPI } from '../api/client';
import type { Audio } from '../types';

interface HistoryEntry {
  id: number;
  audio_id: number;
  youtube_id: string;
  title: string;
  artist: string;
  channel_name: string;
  genre: string;
  thumbnail_url: string;
  listened_at: string;
  duration_listened: number;
  completed: boolean;
}

interface OnThisDayData {
  [key: string]: {
    label: string;
    date: string;
    tracks: HistoryEntry[];
    count: number;
  };
}

interface GroupedHistory {
  label: string;
  entries: HistoryEntry[];
}

interface ListeningHistoryPageProps {
  onTrackSelect?: (audio: Audio) => void;
}

// Format duration helper
const formatDuration = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

// Format time ago helper
const formatTimeAgo = (dateStr: string) => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
};

// Memoized History Entry Component - defined OUTSIDE of main component
const HistoryEntryItem = memo(({ 
  entry, 
  onPlay,
}: { 
  entry: HistoryEntry;
  onPlay: (entry: HistoryEntry) => void;
}) => {
  const theme = useTheme();
  
  return (
    <ListItem
      sx={{
        borderRadius: 2,
        mb: 0.5,
        cursor: 'pointer',
        transition: 'background-color 0.15s ease',
        '&:hover': {
          bgcolor: alpha(theme.palette.primary.main, 0.08),
        },
      }}
      onClick={() => onPlay(entry)}
    >
      <ListItemAvatar>
        <Avatar 
          src={entry.thumbnail_url} 
          variant="rounded"
          sx={{ 
            width: 56, 
            height: 56,
            boxShadow: 2,
          }}
        >
          <MusicNoteIcon />
        </Avatar>
      </ListItemAvatar>
      <ListItemText
        primary={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body1" fontWeight={500} noWrap sx={{ maxWidth: '70%' }}>
              {entry.title}
            </Typography>
            {entry.completed && (
              <Chip label="✓" size="small" color="success" variant="outlined" sx={{ height: 18, fontSize: '0.65rem', minWidth: 24 }} />
            )}
          </Box>
        }
        secondary={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
            <Typography variant="body2" color="text.secondary" noWrap>
              {entry.artist || entry.channel_name}
            </Typography>
            <Typography variant="caption" color="text.disabled">•</Typography>
            <Typography variant="caption" color="text.secondary">
              {formatDuration(entry.duration_listened)}
            </Typography>
          </Box>
        }
        sx={{ ml: 1 }}
      />
      <ListItemSecondaryAction>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Tooltip title={new Date(entry.listened_at).toLocaleString()}>
            <Typography variant="caption" color="text.secondary">
              {formatTimeAgo(entry.listened_at)}
            </Typography>
          </Tooltip>
          <IconButton 
            size="small" 
            color="primary"
            onClick={(e) => {
              e.stopPropagation();
              onPlay(entry);
            }}
          >
            <PlayIcon />
          </IconButton>
        </Box>
      </ListItemSecondaryAction>
    </ListItem>
  );
});

// Memoized Section Header
const SectionHeader = memo(({ 
  label, 
  count, 
  isExpanded, 
  onToggle 
}: { 
  label: string; 
  count: number; 
  isExpanded: boolean; 
  onToggle: () => void;
}) => (
  <Box 
    sx={{ 
      display: 'flex', 
      alignItems: 'center', 
      gap: 1, 
      mb: 1,
      cursor: 'pointer',
      userSelect: 'none',
      py: 0.5,
    }}
    onClick={onToggle}
  >
    {label === 'Today' && <TodayIcon color="primary" fontSize="small" />}
    {label === 'Yesterday' && <TimeIcon color="secondary" fontSize="small" />}
    {!['Today', 'Yesterday'].includes(label) && <CalendarIcon color="action" fontSize="small" />}
    <Typography variant="subtitle1" fontWeight={600} color="text.primary">
      {label}
    </Typography>
    <Chip 
      label={count} 
      size="small" 
      variant="outlined"
      sx={{ height: 20, fontSize: '0.7rem' }}
    />
    <Box sx={{ flex: 1 }} />
    <IconButton size="small">
      {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
    </IconButton>
  </Box>
));

export default function ListeningHistoryPage({ onTrackSelect }: ListeningHistoryPageProps) {
  const theme = useTheme();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [onThisDay, setOnThisDay] = useState<OnThisDayData>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  
  // Use a Set for collapsed sections (more efficient)
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [onThisDayExpanded, setOnThisDayExpanded] = useState(true);

  // Scroll handler for showing/hiding scroll-to-top button
  // Need to find the scrollable parent container since App.tsx has overflow:auto on the content area
  useEffect(() => {
    const handleScroll = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target) {
        setShowScrollTop(target.scrollTop > 400);
      }
    };
    
    // Find the scrollable parent - it's the Box with overflow: auto in App.tsx
    const findScrollableParent = () => {
      let element = document.querySelector('[data-history-page]')?.parentElement;
      while (element) {
        const style = window.getComputedStyle(element);
        if (style.overflow === 'auto' || style.overflowY === 'auto' || 
            style.overflow === 'scroll' || style.overflowY === 'scroll') {
          return element;
        }
        element = element.parentElement;
      }
      return null;
    };
    
    const scrollContainer = findScrollableParent();
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
      return () => scrollContainer.removeEventListener('scroll', handleScroll);
    }
    
    // Fallback to window
    const windowScroll = () => {
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      setShowScrollTop(scrollTop > 400);
    };
    window.addEventListener('scroll', windowScroll, { passive: true });
    return () => window.removeEventListener('scroll', windowScroll);
  }, []);

  // Scroll to top function
  const scrollToTop = useCallback(() => {
    // Find the scrollable parent
    const findScrollableParent = () => {
      let element = document.querySelector('[data-history-page]')?.parentElement;
      while (element) {
        const style = window.getComputedStyle(element);
        if (style.overflow === 'auto' || style.overflowY === 'auto' || 
            style.overflow === 'scroll' || style.overflowY === 'scroll') {
          return element;
        }
        element = element.parentElement;
      }
      return null;
    };
    
    const scrollContainer = findScrollableParent();
    if (scrollContainer) {
      scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  // Load history
  const loadHistory = useCallback(async (pageNum: number = 1, append: boolean = false) => {
    try {
      if (pageNum === 1) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      setError(null);
      
      const response = await statsAPI.history({ page: pageNum, page_size: 100 });
      
      if (append) {
        setHistory(prev => [...prev, ...response.data.results]);
      } else {
        setHistory(response.data.results);
      }
      setPage(pageNum);
      setTotalPages(response.data.total_pages);
    } catch (err: any) {
      setError(err.message || 'Failed to load history');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  // Load "On This Day" data
  const loadOnThisDay = useCallback(async () => {
    try {
      const response = await statsAPI.onThisDay();
      setOnThisDay(response.data);
    } catch (err) {
      console.error('Failed to load On This Day data:', err);
    }
  }, []);

  useEffect(() => {
    loadHistory();
    loadOnThisDay();
  }, [loadHistory, loadOnThisDay]);

  // Group history entries by time period - using useMemo instead of useCallback
  const groupedHistory = useMemo((): GroupedHistory[] => {
    if (history.length === 0) return [];
    
    const groups: Record<string, HistoryEntry[]> = {};
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const thisWeekStart = new Date(today.getTime() - today.getDay() * 24 * 60 * 60 * 1000);
    const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    for (const entry of history) {
      const date = new Date(entry.listened_at);
      let groupKey: string;

      if (date >= today) {
        groupKey = 'Today';
      } else if (date >= yesterday) {
        groupKey = 'Yesterday';
      } else if (date >= thisWeekStart) {
        groupKey = 'This Week';
      } else if (date >= lastWeekStart) {
        groupKey = 'Last Week';
      } else if (date >= thisMonthStart) {
        groupKey = 'This Month';
      } else if (date >= lastMonthStart) {
        groupKey = 'Last Month';
      } else {
        groupKey = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      }

      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(entry);
    }

    const orderedKeys = ['Today', 'Yesterday', 'This Week', 'Last Week', 'This Month', 'Last Month'];
    const result: GroupedHistory[] = [];

    for (const key of orderedKeys) {
      if (groups[key]) {
        result.push({ label: key, entries: groups[key] });
        delete groups[key];
      }
    }

    // Add remaining groups (older months)
    const remainingKeys = Object.keys(groups).sort((a, b) => {
      const dateA = new Date(groups[a][0].listened_at);
      const dateB = new Date(groups[b][0].listened_at);
      return dateB.getTime() - dateA.getTime();
    });

    for (const key of remainingKeys) {
      result.push({ label: key, entries: groups[key] });
    }

    return result;
  }, [history]);

  // Handle track play - memoized to prevent child re-renders
  const handlePlayTrack = useCallback((entry: HistoryEntry) => {
    if (onTrackSelect) {
      const audio: Audio = {
        id: entry.audio_id,
        youtube_id: entry.youtube_id,
        title: entry.title,
        channel_name: entry.channel_name,
        thumbnail_url: entry.thumbnail_url,
        duration: entry.duration_listened,
        file_size: 0,
        play_count: 0,
        is_favorite: false,
      };
      onTrackSelect(audio);
    }
  }, [onTrackSelect]);

  // Clear history - memoized
  const handleClearHistory = useCallback(async (days?: number) => {
    try {
      await statsAPI.clearHistory(days);
      setClearDialogOpen(false);
      loadHistory();
      loadOnThisDay();
    } catch (err) {
      console.error('Failed to clear history:', err);
    }
  }, [loadHistory, loadOnThisDay]);

  // Toggle section - simple and fast with Set
  const toggleSection = useCallback((label: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  }, []);

  // On This Day Section - memoized
  const OnThisDaySection = useMemo(() => {
    const hasMemories = Object.keys(onThisDay).length > 0;

    if (!hasMemories) return null;

    return (
      <Card 
        sx={{ 
          mb: 3, 
          background: `linear-gradient(135deg, ${alpha(theme.palette.secondary.main, 0.1)} 0%, ${alpha(theme.palette.primary.main, 0.1)} 100%)`,
          border: `1px solid ${alpha(theme.palette.secondary.main, 0.2)}`,
        }}
      >
        <CardContent>
          <Box 
            sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              cursor: 'pointer',
              userSelect: 'none',
              mb: onThisDayExpanded ? 2 : 0,
            }}
            onClick={() => setOnThisDayExpanded(prev => !prev)}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CelebrationIcon color="secondary" />
              <Typography variant="h6" fontWeight={600}>
                On This Day
              </Typography>
              <Chip 
                label={`${Object.keys(onThisDay).length} memories`} 
                size="small" 
                color="secondary"
                variant="outlined"
              />
            </Box>
            <IconButton size="small">
              {onThisDayExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>
          </Box>

          <Collapse in={onThisDayExpanded} timeout={200}>
            <Grid container spacing={2}>
              {Object.entries(onThisDay).map(([key, period]) => (
                <Grid item xs={12} md={4} key={key}>
                  <Paper 
                    sx={{ 
                      p: 2, 
                      bgcolor: alpha(theme.palette.background.paper, 0.8),
                      height: '100%',
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <CalendarIcon fontSize="small" color="primary" />
                      <Typography variant="subtitle1" fontWeight={600}>
                        {period.label}
                      </Typography>
                    </Box>
                    <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                      {new Date(period.date).toLocaleDateString('en-US', { 
                        weekday: 'long', 
                        month: 'long', 
                        day: 'numeric',
                        year: 'numeric'
                      })}
                    </Typography>
                    <List dense sx={{ py: 0 }}>
                      {period.tracks.slice(0, 3).map((track) => (
                        <ListItem 
                          key={track.id}
                          sx={{ 
                            px: 0,
                            cursor: 'pointer',
                            borderRadius: 1,
                            '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.1) },
                          }}
                          onClick={() => handlePlayTrack(track)}
                        >
                          <ListItemAvatar sx={{ minWidth: 48 }}>
                            <Avatar 
                              src={track.thumbnail_url} 
                              variant="rounded"
                              sx={{ width: 40, height: 40 }}
                            >
                              <MusicNoteIcon />
                            </Avatar>
                          </ListItemAvatar>
                          <ListItemText
                            primary={track.title}
                            secondary={track.artist || track.channel_name}
                            primaryTypographyProps={{ 
                              noWrap: true, 
                              fontSize: '0.875rem',
                              fontWeight: 500,
                            }}
                            secondaryTypographyProps={{ noWrap: true, fontSize: '0.75rem' }}
                          />
                          <IconButton 
                            size="small" 
                            color="primary"
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePlayTrack(track);
                            }}
                          >
                            <PlayIcon fontSize="small" />
                          </IconButton>
                        </ListItem>
                      ))}
                    </List>
                    {period.tracks.length > 3 && (
                      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                        +{period.tracks.length - 3} more tracks
                      </Typography>
                    )}
                  </Paper>
                </Grid>
              ))}
            </Grid>
          </Collapse>
        </CardContent>
      </Card>
    );
  }, [onThisDay, onThisDayExpanded, theme, handlePlayTrack]);

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Skeleton variant="rectangular" height={200} sx={{ mb: 3, borderRadius: 2 }} />
        {[1, 2, 3, 4, 5].map(i => (
          <Skeleton key={i} variant="rectangular" height={72} sx={{ mb: 1, borderRadius: 2 }} />
        ))}
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        <Button variant="contained" onClick={() => loadHistory()}>Retry</Button>
      </Box>
    );
  }

  return (
    <Box data-history-page sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <HistoryIcon sx={{ fontSize: 32, color: 'primary.main' }} />
          <Box>
            <Typography variant="h4" fontWeight={700}>
              Listening History
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {history.length} tracks in your history
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title="Refresh">
            <IconButton onClick={() => { loadHistory(); loadOnThisDay(); }}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          <Button 
            variant="outlined" 
            color="error" 
            startIcon={<DeleteIcon />}
            onClick={() => setClearDialogOpen(true)}
          >
            Clear
          </Button>
        </Box>
      </Box>

      {/* On This Day Section */}
      {OnThisDaySection}

      {/* History Timeline */}
      {groupedHistory.length === 0 ? (
        <Card sx={{ textAlign: 'center', py: 8 }}>
          <MusicNoteIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
          <Typography variant="h6" color="text.secondary">
            No listening history yet
          </Typography>
          <Typography variant="body2" color="text.disabled">
            Start playing some music to build your history!
          </Typography>
        </Card>
      ) : (
        groupedHistory.map((group) => {
          const isExpanded = !collapsedSections.has(group.label);
          return (
            <Box key={group.label} sx={{ mb: 3 }}>
              <SectionHeader
                label={group.label}
                count={group.entries.length}
                isExpanded={isExpanded}
                onToggle={() => toggleSection(group.label)}
              />
              
              <Collapse in={isExpanded} timeout={150} unmountOnExit>
                <Card variant="outlined" sx={{ borderRadius: 2 }}>
                  <List sx={{ py: 0 }}>
                    {group.entries.slice(0, 50).map((entry, index) => (
                      <Box key={entry.id}>
                        <HistoryEntryItem
                          entry={entry}
                          onPlay={handlePlayTrack}
                        />
                        {index < Math.min(group.entries.length, 50) - 1 && <Divider variant="inset" />}
                      </Box>
                    ))}
                    {group.entries.length > 50 && (
                      <Box sx={{ p: 2, textAlign: 'center' }}>
                        <Typography variant="caption" color="text.secondary">
                          Showing first 50 of {group.entries.length} tracks
                        </Typography>
                      </Box>
                    )}
                  </List>
                </Card>
              </Collapse>
            </Box>
          );
        })
      )}

      {/* Load More */}
      {page < totalPages && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
          <Button
            variant="outlined"
            onClick={() => loadHistory(page + 1, true)}
            disabled={loadingMore}
            startIcon={loadingMore ? <CircularProgress size={16} /> : null}
          >
            {loadingMore ? 'Loading...' : 'Load More'}
          </Button>
        </Box>
      )}

      {/* Clear History Dialog */}
      <Dialog open={clearDialogOpen} onClose={() => setClearDialogOpen(false)}>
        <DialogTitle>Clear Listening History</DialogTitle>
        <DialogContent>
          <Typography gutterBottom>
            Choose how much history to clear:
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 2 }}>
            <Button 
              variant="outlined" 
              onClick={() => handleClearHistory(7)}
              fullWidth
            >
              Clear older than 1 week
            </Button>
            <Button 
              variant="outlined" 
              onClick={() => handleClearHistory(30)}
              fullWidth
            >
              Clear older than 1 month
            </Button>
            <Button 
              variant="outlined" 
              onClick={() => handleClearHistory(90)}
              fullWidth
            >
              Clear older than 3 months
            </Button>
            <Divider sx={{ my: 1 }} />
            <Button 
              variant="contained" 
              color="error"
              onClick={() => handleClearHistory()}
              fullWidth
            >
              Clear All History
            </Button>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClearDialogOpen(false)}>Cancel</Button>
        </DialogActions>
      </Dialog>

      {/* Scroll to Top FAB */}
      <Zoom in={showScrollTop}>
        <Fab
          color="primary"
          size="medium"
          onClick={scrollToTop}
          sx={{
            position: 'fixed',
            bottom: { xs: 80, md: 24 },
            right: 24,
            zIndex: 1000,
          }}
          aria-label="scroll to top"
        >
          <KeyboardArrowUpIcon />
        </Fab>
      </Zoom>
    </Box>
  );
}
