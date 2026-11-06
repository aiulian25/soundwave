import type { Key, ReactNode } from 'react';
import {
  Box,
  CardActionArea,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  type Breakpoint,
} from '@mui/material';
import GridViewIcon from '@mui/icons-material/GridView';
import ViewListIcon from '@mui/icons-material/ViewList';
import { useTranslation } from 'react-i18next';
import ScrollingText from './ScrollingText';
import TrackThumbnail from './TrackThumbnail';
import NowPlayingIndicator from './NowPlayingIndicator';
import { useIsNowPlaying } from '../context/NowPlayingContext';
import { useHighlightTrack } from '../hooks/useHighlightTrack';
import { useTrackListView, type TrackListView } from '../hooks/useTrackListView';
import { nowPlayingArtworkSx, nowPlayingRowSx, nowPlayingTitleSx } from '../theme/nowPlaying';

const NUMBER_COLUMN_WIDTH = 48;
const ARTWORK_SIZE = 40;
const CARD_PLACEHOLDER_ICON_SIZE = 96;
const CARD_MIN_WIDTH_PX = 180;
const ROW_HEIGHT = 60;
const UNAVAILABLE_OPACITY = 0.5;
const HIGHLIGHT_BACKGROUND = 'rgba(19, 236, 106, 0.1)';
const CARD_OVERLAY_BACKGROUND = 'rgba(0, 0, 0, 0.6)';

export interface TrackColumn<Item> {
  id: string;
  header: string;
  width: number;
  render: (item: Item) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Hidden on narrower screens, so a phone keeps the title and the actions. */
  showFrom?: Breakpoint;
}

/** What every row or card shows, whatever page the list is on. */
export interface TrackSummary {
  /** Identifies the track for "now playing" and for ?highlight= links. */
  key: string | null | undefined;
  title: string;
  subtitle?: string;
  artworkUrl?: string | null;
  /** Shown on the card's artwork, as video apps show a video's length. */
  duration?: string;
  /** A track that cannot play yet is shown dimmed and does nothing when clicked. */
  playable?: boolean;
}

interface TrackTableProps<Item> {
  items: Item[];
  rowKey: (item: Item) => Key;
  describe: (item: Item) => TrackSummary;
  onPlay: (item: Item, index: number) => void;
  columns?: TrackColumn<Item>[];
  renderActions?: (item: Item, index: number) => ReactNode;
  actionsWidth?: number;
  /** Badges after the title, such as "available offline" or "not downloaded". */
  renderTitleExtras?: (item: Item) => ReactNode;
  emptyMessage?: string;
}

type ViewProps<Item> = TrackTableProps<Item> & {
  isNowPlaying: (key: string | null | undefined) => boolean;
  getTrackRef: ReturnType<typeof useHighlightTrack>['getTrackRef'];
  shouldHighlight: ReturnType<typeof useHighlightTrack>['shouldHighlight'];
};

const visibleFrom = (breakpoint?: Breakpoint) =>
  breakpoint ? { display: { xs: 'none', [breakpoint]: 'table-cell' } } : {};

function EmptyMessage({ message }: { message: string }) {
  return (
    <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 4 }}>
      {message}
    </Typography>
  );
}

function TrackRows<Item>({
  items, rowKey, describe, onPlay, columns = [], renderActions, actionsWidth = 0, renderTitleExtras, emptyMessage,
  isNowPlaying, getTrackRef, shouldHighlight,
}: ViewProps<Item>) {
  const { t } = useTranslation();
  const hasActions = Boolean(renderActions);

  return (
    <TableContainer component={Paper} sx={{ borderRadius: 3, border: 1, borderColor: 'divider' }}>
      <Table size="small" sx={{ tableLayout: 'fixed', width: '100%' }}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ width: NUMBER_COLUMN_WIDTH, fontWeight: 600 }}>#</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>{t('library.columns.title')}</TableCell>
            {columns.map((column) => (
              <TableCell
                key={column.id}
                align={column.align}
                sx={{ width: column.width, fontWeight: 600, ...visibleFrom(column.showFrom) }}
              >
                {column.header}
              </TableCell>
            ))}
            {hasActions && <TableCell sx={{ width: actionsWidth }} aria-label={t('library.columns.actions')} />}
          </TableRow>
        </TableHead>
        <TableBody>
          {items.length === 0 && emptyMessage && (
            <TableRow>
              <TableCell colSpan={columns.length + (hasActions ? 3 : 2)}>
                <EmptyMessage message={emptyMessage} />
              </TableCell>
            </TableRow>
          )}
          {items.map((item, index) => {
            const track = describe(item);
            const playing = isNowPlaying(track.key);
            const playable = track.playable !== false;
            return (
              <TableRow
                key={rowKey(item)}
                ref={getTrackRef(track.key ?? undefined)}
                hover
                data-testid="track-row"
                onClick={() => playable && onPlay(item, index)}
                sx={{
                  height: ROW_HEIGHT,
                  cursor: playable ? 'pointer' : 'default',
                  opacity: playable ? 1 : UNAVAILABLE_OPACITY,
                  // Off-screen rows skip layout and paint; the DOM stays for refs and scrolling.
                  contentVisibility: 'auto',
                  containIntrinsicSize: `auto ${ROW_HEIGHT}px`,
                  ...(shouldHighlight(track.key ?? undefined) && { bgcolor: HIGHLIGHT_BACKGROUND }),
                  ...(playing && nowPlayingRowSx),
                }}
              >
                <TableCell sx={{ color: 'text.secondary' }}>
                  {playing ? <NowPlayingIndicator /> : index + 1}
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                    <TrackThumbnail src={track.artworkUrl} alt={track.title} size={ARTWORK_SIZE} />
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                        <ScrollingText
                          variant="body2"
                          sx={{ fontWeight: 500, minWidth: 0, ...(playing && nowPlayingTitleSx) }}
                        >
                          {track.title}
                        </ScrollingText>
                        {renderTitleExtras?.(item)}
                      </Box>
                      {track.subtitle && (
                        <Typography variant="caption" color="text.secondary" noWrap component="p">
                          {track.subtitle}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                </TableCell>
                {columns.map((column) => (
                  <TableCell
                    key={column.id}
                    align={column.align}
                    sx={{ color: 'text.secondary', ...visibleFrom(column.showFrom) }}
                  >
                    {column.render(item)}
                  </TableCell>
                ))}
                {hasActions && (
                  <TableCell align="right" onClick={(event) => event.stopPropagation()}>
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                      {renderActions?.(item, index)}
                    </Box>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function TrackCards<Item>({
  items, rowKey, describe, onPlay, renderActions, renderTitleExtras, emptyMessage,
  isNowPlaying, getTrackRef, shouldHighlight,
}: ViewProps<Item>) {
  if (items.length === 0) return emptyMessage ? <EmptyMessage message={emptyMessage} /> : null;

  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: {
          xs: 'repeat(2, minmax(0, 1fr))',
          sm: `repeat(auto-fill, minmax(${CARD_MIN_WIDTH_PX}px, 1fr))`,
        },
      }}
    >
      {items.map((item, index) => {
        const track = describe(item);
        const playing = isNowPlaying(track.key);
        const playable = track.playable !== false;
        return (
          <Paper
            key={rowKey(item)}
            ref={getTrackRef(track.key ?? undefined)}
            data-testid="track-card"
            sx={{
              position: 'relative',
              borderRadius: 3,
              overflow: 'hidden',
              border: 1,
              borderColor: 'divider',
              opacity: playable ? 1 : UNAVAILABLE_OPACITY,
              ...(shouldHighlight(track.key ?? undefined) && { bgcolor: HIGHLIGHT_BACKGROUND }),
            }}
          >
            <CardActionArea disabled={!playable} onClick={() => onPlay(item, index)}>
              <Box sx={{ position: 'relative' }}>
                <TrackThumbnail
                  src={track.artworkUrl}
                  alt={track.title}
                  size={CARD_PLACEHOLDER_ICON_SIZE}
                  sx={{
                    width: '100%',
                    height: 'auto',
                    aspectRatio: '1',
                    borderRadius: 0,
                    boxShadow: 0,
                    ...(playing && nowPlayingArtworkSx),
                  }}
                />
                {playing && (
                  <Box sx={{ position: 'absolute', left: 8, bottom: 8, p: 0.75, borderRadius: 1, bgcolor: CARD_OVERLAY_BACKGROUND }}>
                    <NowPlayingIndicator />
                  </Box>
                )}
                {track.duration && (
                  <Typography
                    variant="caption"
                    data-testid="track-card-duration"
                    sx={{ position: 'absolute', right: 8, bottom: 8, px: 0.75, borderRadius: 1, color: 'common.white', bgcolor: CARD_OVERLAY_BACKGROUND }}
                  >
                    {track.duration}
                  </Typography>
                )}
              </Box>
              <Box sx={{ p: 1.5, minWidth: 0 }}>
                <ScrollingText variant="body2" sx={{ fontWeight: 600, ...(playing && nowPlayingTitleSx) }}>
                  {track.title}
                </ScrollingText>
                {track.subtitle && (
                  <Typography variant="caption" color="text.secondary" noWrap component="p">
                    {track.subtitle}
                  </Typography>
                )}
                {renderTitleExtras && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5, minHeight: 0 }}>
                    {renderTitleExtras(item)}
                  </Box>
                )}
              </Box>
            </CardActionArea>
            {renderActions && (
              <Box
                onClick={(event) => event.stopPropagation()}
                sx={{
                  position: 'absolute',
                  top: 6,
                  right: 6,
                  display: 'flex',
                  borderRadius: 999,
                  bgcolor: CARD_OVERLAY_BACKGROUND,
                  color: 'common.white',
                  '& .MuiIconButton-root': { color: 'common.white' },
                }}
              >
                {renderActions(item, index)}
              </Box>
            )}
          </Paper>
        );
      })}
    </Box>
  );
}

/**
 * The track list every page uses, shown as rows or as artwork cards. Either way titles roll when
 * they do not fit and the playing track is marked. In rows, the fixed layout gives the title all
 * remaining width, which is what lets a long title know it overflows and roll.
 */
export default function TrackTable<Item>(props: TrackTableProps<Item>) {
  const { t } = useTranslation();
  const isNowPlaying = useIsNowPlaying();
  const { getTrackRef, shouldHighlight } = useHighlightTrack();
  const [view, setView] = useTrackListView();
  const viewProps = { ...props, isNowPlaying, getTrackRef, shouldHighlight };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1.5 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={view}
          aria-label={t('trackView.label')}
          onChange={(_event, next: TrackListView | null) => next && setView(next)}
        >
          <ToggleButton value="list" aria-label={t('trackView.list')}>
            <ViewListIcon fontSize="small" />
          </ToggleButton>
          <ToggleButton value="cards" aria-label={t('trackView.cards')}>
            <GridViewIcon fontSize="small" />
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>
      {view === 'cards' ? <TrackCards {...viewProps} /> : <TrackRows {...viewProps} />}
    </Box>
  );
}
