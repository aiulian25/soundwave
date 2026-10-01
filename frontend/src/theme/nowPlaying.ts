import { alpha, createTheme, darken, type Theme } from '@mui/material/styles';

export interface NowPlayingColors {
  main: string;
  background: string;
}

declare module '@mui/material/styles' {
  interface Palette {
    nowPlaying: NowPlayingColors;
  }
  interface PaletteOptions {
    nowPlaying?: NowPlayingColors;
  }
}

// The light themes' primaries (bright green, cyan) are too pale for text on white, so the
// accent is darkened there to stay readable; dark themes use their primary as is.
const LIGHT_MODE_ACCENT_DARKENING = 0.5;
const LIGHT_MODE_TINT_OPACITY = 0.18;
const DARK_MODE_TINT_OPACITY = 0.14;
const ACCENT_BAR_WIDTH_PX = 3;
const ARTWORK_RING_WIDTH_PX = 2;

export function withNowPlaying(theme: Theme): Theme {
  const isLightMode = theme.palette.mode === 'light';
  const primary = theme.palette.primary.main;
  return createTheme(theme, {
    palette: {
      nowPlaying: {
        main: isLightMode ? darken(primary, LIGHT_MODE_ACCENT_DARKENING) : primary,
        background: alpha(primary, isLightMode ? LIGHT_MODE_TINT_OPACITY : DARK_MODE_TINT_OPACITY),
      },
    },
  });
}

const accentBar = (theme: Theme) => `inset ${ACCENT_BAR_WIDTH_PX}px 0 0 ${theme.palette.nowPlaying.main}`;

/** Table row of the playing track: tint, kept on hover, with an accent bar on the first cell.
 * The second hover selector matches the specificity of MUI's own `hover` row style. */
export const nowPlayingRowSx = {
  bgcolor: 'nowPlaying.background',
  '&:hover, &.MuiTableRow-hover:hover': { bgcolor: 'nowPlaying.background' },
  '& > td:first-of-type': { boxShadow: accentBar },
};

/** List item or horizontal card of the playing track. */
export const nowPlayingItemSx = {
  bgcolor: 'nowPlaying.background',
  '&:hover': { bgcolor: 'nowPlaying.background' },
  boxShadow: accentBar,
};

/** Artwork of the playing track on a cover-style card. The ring sits inside the edge so a
 * scrolling row never clips it, and outlines paint above the image and its overlays. */
export const nowPlayingArtworkSx = {
  outline: `${ARTWORK_RING_WIDTH_PX}px solid`,
  outlineColor: 'nowPlaying.main',
  outlineOffset: -ARTWORK_RING_WIDTH_PX,
};

/** Title of the playing track; also valid as Typography props. */
export const nowPlayingTitleSx = {
  color: 'nowPlaying.main',
  fontWeight: 600,
};
