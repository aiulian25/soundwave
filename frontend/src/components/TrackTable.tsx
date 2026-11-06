import type { Key, ReactNode } from 'react';
import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  type Breakpoint,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import ScrollingText from './ScrollingText';
import TrackThumbnail from './TrackThumbnail';
import NowPlayingIndicator from './NowPlayingIndicator';
import { useIsNowPlaying } from '../context/NowPlayingContext';
import { useHighlightTrack } from '../hooks/useHighlightTrack';
import { nowPlayingRowSx, nowPlayingTitleSx } from '../theme/nowPlaying';

const NUMBER_COLUMN_WIDTH = 48;
const ARTWORK_SIZE = 40;
const ROW_HEIGHT = 60;
const UNAVAILABLE_OPACITY = 0.5;
const HIGHLIGHT_BACKGROUND = 'rgba(19, 236, 106, 0.1)';

export interface TrackColumn<Item> {
  id: string;
  header: string;
  width: number;
  render: (item: Item) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Hidden on narrower screens, so a phone keeps the title and the actions. */
  showFrom?: Breakpoint;
}

/** What every row shows, whatever page the list is on. */
export interface TrackSummary {
  /** Identifies the track for "now playing" and for ?highlight= links. */
  key: string | null | undefined;
  title: string;
  subtitle?: string;
  artworkUrl?: string | null;
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

const visibleFrom = (breakpoint?: Breakpoint) =>
  breakpoint ? { display: { xs: 'none', [breakpoint]: 'table-cell' } } : {};

/**
 * The track list every page uses, so titles roll, the playing track shows and narrow screens
 * drop the same columns everywhere. The fixed layout gives the title all remaining width,
 * which is what lets a long title know it overflows and roll.
 */
export default function TrackTable<Item>({
  items,
  rowKey,
  describe,
  onPlay,
  columns = [],
  renderActions,
  actionsWidth = 0,
  renderTitleExtras,
  emptyMessage,
}: TrackTableProps<Item>) {
  const { t } = useTranslation();
  const isNowPlaying = useIsNowPlaying();
  const { getTrackRef, shouldHighlight } = useHighlightTrack();
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
              <TableCell colSpan={columns.length + (hasActions ? 3 : 2)} align="center" sx={{ py: 4 }}>
                <Typography variant="body2" color="text.secondary">{emptyMessage}</Typography>
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
