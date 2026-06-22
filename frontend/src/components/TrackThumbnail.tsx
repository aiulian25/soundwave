import { Avatar } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import { MusicNote as MusicNoteIcon } from '@mui/icons-material';

interface TrackThumbnailProps {
  /** The track's own artwork URL. Falls back to a music-note icon when missing/offline. */
  src?: string | null;
  /** Accessible label — pass the track title. */
  alt?: string;
  /** Square edge length in px. */
  size?: number;
  sx?: SxProps<Theme>;
}

/**
 * Small per-track thumbnail used in track lists across the app.
 *
 * - `loading="lazy"` / `decoding="async"`: offscreen images don't fetch until scrolled
 *   into view, so long un-virtualized lists (e.g. the Library table) stay responsive.
 * - Offline / 404: the Avatar automatically renders the MusicNote fallback child.
 * - `referrerPolicy="no-referrer"`: don't leak the app URL to the image CDN.
 */
export default function TrackThumbnail({ src, alt, size = 40, sx }: TrackThumbnailProps) {
  return (
    <Avatar
      src={src || undefined}
      alt={alt}
      variant="rounded"
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        bgcolor: 'action.hover',
        boxShadow: 1,
        ...sx,
      }}
      imgProps={{ loading: 'lazy', decoding: 'async', referrerPolicy: 'no-referrer' }}
    >
      <MusicNoteIcon sx={{ fontSize: Math.round(size * 0.5) }} />
    </Avatar>
  );
}
