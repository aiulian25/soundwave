/**
 * Visualizer Themes Configuration
 * Multiple visualization styles and color schemes for the audio player
 */

export type VisualizerStyle = 
  | 'classic-bars'      // 0: Traditional frequency spectrum with rainbow-colored vertical bars
  | 'bars-rounded'      // User favorite - Rounded bars with smooth animations
  | 'circular-spectrum' // 1: Bars arranged in a circle radiating outward
  | 'waveform'          // 2: Real-time audio waveform display (oscilloscope style)
  | 'symmetric-bars'    // 3: Mirrored bars extending from center (top & bottom)
  | 'particles'         // 4: Random particles that appear based on audio intensity
  | 'frequency-rings'   // 5: Concentric circles that grow based on frequency data
  | 'line-spectrum'     // 6: Smooth line graph with gradient colors
  | 'radial-bars'       // 7: Bars radiating from a central circle outward
  | 'block-grid'        // 8: 16×8 pixel-art style grid like an equalizer LED display
  | 'spiral';           // 9: Dynamic spiral pattern that expands based on audio

export type VisualizerColorScheme = 
  | 'theme' 
  | 'rainbow' 
  | 'fire' 
  | 'ocean' 
  | 'neon' 
  | 'sunset'
  | 'aurora'
  | 'monochrome'
  | 'purple-blue-green';

export interface VisualizerTheme {
  id: string;
  name: string;
  style: VisualizerStyle;
  colorScheme: VisualizerColorScheme;
  description: string;
  preview: {
    primaryColor: string;
    secondaryColor: string;
    accentColor?: string;
  };
}

// Predefined visualizer themes
export const visualizerThemes: VisualizerTheme[] = [
  // User favorite - Rounded Bars (default)
  {
    id: 'rounded-bars',
    name: 'Rounded Bars ⭐',
    style: 'bars-rounded',
    colorScheme: 'theme',
    description: 'Soft rounded bars with smooth animations (Your favorite!)',
    preview: {
      primaryColor: '#7E57C2',
      secondaryColor: '#5C6BC0',
    },
  },
  // Modern Metallic Radial - uses app theme color
  {
    id: 'radial-metallic',
    name: 'Radial Metallic ✨',
    style: 'radial-bars',
    colorScheme: 'theme',
    description: 'Modern radial bars with metallic grey tones and theme accent',
    preview: {
      primaryColor: '#8B9DC3',
      secondaryColor: '#5D6D7E',
      accentColor: '#ABB2BF',
    },
  },
  // 0: Classic Bars
  {
    id: 'classic-bars',
    name: 'Classic Bars',
    style: 'classic-bars',
    colorScheme: 'rainbow',
    description: 'Traditional frequency spectrum with rainbow-colored vertical bars',
    preview: {
      primaryColor: '#FF0000',
      secondaryColor: '#00FF00',
      accentColor: '#0000FF',
    },
  },
  // 1: Circular Spectrum
  {
    id: 'circular-spectrum',
    name: 'Circular Spectrum',
    style: 'circular-spectrum',
    colorScheme: 'neon',
    description: 'Bars arranged in a circle radiating outward',
    preview: {
      primaryColor: '#FF00FF',
      secondaryColor: '#00FFFF',
      accentColor: '#00FF00',
    },
  },
  // 2: Waveform
  {
    id: 'waveform',
    name: 'Waveform',
    style: 'waveform',
    colorScheme: 'ocean',
    description: 'Real-time audio waveform display (oscilloscope style)',
    preview: {
      primaryColor: '#00CED1',
      secondaryColor: '#006994',
      accentColor: '#40E0D0',
    },
  },
  // 3: Symmetric Bars
  {
    id: 'symmetric-bars',
    name: 'Symmetric Bars',
    style: 'symmetric-bars',
    colorScheme: 'sunset',
    description: 'Mirrored bars extending from center (top & bottom)',
    preview: {
      primaryColor: '#FF6B6B',
      secondaryColor: '#FFE66D',
      accentColor: '#FF8E53',
    },
  },
  // 4: Particles
  {
    id: 'particles',
    name: 'Particles',
    style: 'particles',
    colorScheme: 'aurora',
    description: 'Random particles that appear based on audio intensity',
    preview: {
      primaryColor: '#00FF87',
      secondaryColor: '#7B68EE',
      accentColor: '#FF69B4',
    },
  },
  // 5: Frequency Rings
  {
    id: 'frequency-rings',
    name: 'Frequency Rings',
    style: 'frequency-rings',
    colorScheme: 'neon',
    description: 'Concentric circles that grow based on frequency data',
    preview: {
      primaryColor: '#FF00FF',
      secondaryColor: '#00FFFF',
      accentColor: '#FFFF00',
    },
  },
  // 6: Line Spectrum
  {
    id: 'line-spectrum',
    name: 'Line Spectrum',
    style: 'line-spectrum',
    colorScheme: 'purple-blue-green',
    description: 'Smooth line graph with gradient colors (purple → blue → green)',
    preview: {
      primaryColor: '#9400D3',
      secondaryColor: '#0000FF',
      accentColor: '#00FF00',
    },
  },
  // 7: Radial Bars
  {
    id: 'radial-bars',
    name: 'Radial Bars',
    style: 'radial-bars',
    colorScheme: 'fire',
    description: 'Bars radiating from a central circle outward',
    preview: {
      primaryColor: '#FF4500',
      secondaryColor: '#FFD700',
      accentColor: '#FF6347',
    },
  },
  // 8: Block Grid
  {
    id: 'block-grid',
    name: 'Block Grid',
    style: 'block-grid',
    colorScheme: 'rainbow',
    description: '16×8 pixel-art style grid like an equalizer LED display',
    preview: {
      primaryColor: '#00FF00',
      secondaryColor: '#FFFF00',
      accentColor: '#FF0000',
    },
  },
  // 9: Spiral
  {
    id: 'spiral',
    name: 'Spiral',
    style: 'spiral',
    colorScheme: 'aurora',
    description: 'Dynamic spiral pattern that expands based on audio',
    preview: {
      primaryColor: '#00FF87',
      secondaryColor: '#FF69B4',
      accentColor: '#7B68EE',
    },
  },
];

// Color scheme gradients
export const colorSchemeGradients: Record<VisualizerColorScheme, string[]> = {
  theme: [], // Will use theme primary color
  rainbow: ['#FF0000', '#FF7F00', '#FFFF00', '#00FF00', '#0000FF', '#4B0082', '#9400D3'],
  fire: ['#FFD700', '#FFA500', '#FF4500', '#FF0000', '#DC143C'],
  ocean: ['#00CED1', '#20B2AA', '#006994', '#00008B', '#191970'],
  neon: ['#FF00FF', '#00FFFF', '#00FF00', '#FF00FF'],
  sunset: ['#FF6B6B', '#FFE66D', '#FF8E53', '#FF6347', '#CD5C5C'],
  aurora: ['#00FF87', '#7B68EE', '#FF69B4', '#00BFFF', '#98FB98'],
  monochrome: ['#FFFFFF', '#CCCCCC', '#999999', '#666666', '#333333'],
  'purple-blue-green': ['#9400D3', '#4B0082', '#0000FF', '#00BFFF', '#00FF00'],
};

// Get colors for lyrics highlighting based on theme
// Uses the theme's preview colors for accurate matching
// Adapts to light/dark app theme for visibility
export interface LyricsThemeColors {
  primary: string;
  secondary: string;
  gradientStart: string;
  gradientMid: string;
  gradientEnd: string;
  glow: string;
  background: string;
  backgroundHover: string;
  hoverBackground: string; // Hover for non-highlighted lines
  textColor: string; // For non-highlighted text
  pastTextColor: string; // For past lyrics
  upcomingTextColor: string; // For upcoming lyrics
}

// Helper to convert hex to rgba
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Helper to lighten a hex color
function lightenColor(hex: string, percent: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  
  const newR = Math.min(255, Math.round(r + (255 - r) * percent));
  const newG = Math.min(255, Math.round(g + (255 - g) * percent));
  const newB = Math.min(255, Math.round(b + (255 - b) * percent));
  
  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
}

// Helper to darken a hex color
function darkenColor(hex: string, percent: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  
  const newR = Math.max(0, Math.round(r * (1 - percent)));
  const newG = Math.max(0, Math.round(g * (1 - percent)));
  const newB = Math.max(0, Math.round(b * (1 - percent)));
  
  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
}

export function getLyricsColors(themeId: string, isLightMode: boolean = false, muiThemeColor?: string): LyricsThemeColors {
  const theme = getVisualizerTheme(themeId);
  
  // If the visualizer theme uses 'theme' colorScheme and we have a MUI theme color, use it
  // This ensures lyrics match the actual visualizer colors
  let primary: string;
  let secondary: string;
  
  if (theme.colorScheme === 'theme' && muiThemeColor) {
    // Use the MUI theme's primary color for consistency with visualizer
    primary = muiThemeColor;
    secondary = darkenColor(muiThemeColor, 0.2);
    console.log('[Lyrics] Using MUI theme color:', muiThemeColor, 'for theme:', themeId);
  } else {
    // Use the theme's preview colors
    primary = theme.preview.primaryColor;
    secondary = theme.preview.secondaryColor;
    console.log('[Lyrics] Using visualizer theme colors:', primary, 'for theme:', themeId, 'colorScheme:', theme.colorScheme);
  }
  
  let accent = theme.preview.accentColor || lightenColor(primary, 0.3);
  
  // For light mode, we may need to darken colors for better visibility
  if (isLightMode) {
    // Darken the colors for better contrast on light backgrounds
    primary = darkenColor(primary, 0.2);
    secondary = darkenColor(secondary, 0.2);
    accent = darkenColor(accent, 0.2);
  }
  
  // Create a more vibrant highlight color for the current line
  const highlightColor = isLightMode ? primary : lightenColor(primary, 0.15);
  
  return {
    primary,
    secondary,
    gradientStart: highlightColor,
    gradientMid: accent,
    gradientEnd: secondary,
    glow: isLightMode ? hexToRgba(primary, 0.4) : hexToRgba(primary, 0.6),
    background: hexToRgba(primary, isLightMode ? 0.15 : 0.2),
    backgroundHover: hexToRgba(primary, isLightMode ? 0.22 : 0.3),
    hoverBackground: isLightMode ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.08)',
    // Text colors for non-highlighted lyrics - more contrast
    textColor: isLightMode ? 'rgba(0, 0, 0, 0.55)' : 'rgba(255, 255, 255, 0.45)',
    pastTextColor: isLightMode ? 'rgba(0, 0, 0, 0.3)' : 'rgba(255, 255, 255, 0.25)',
    upcomingTextColor: isLightMode ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.75)',
  };
}

// Get color at position for gradient
export function getGradientColor(scheme: VisualizerColorScheme, position: number, themeColor?: string): string {
  if (scheme === 'theme' && themeColor) {
    return themeColor;
  }
  
  const colors = colorSchemeGradients[scheme];
  if (!colors.length) return themeColor || '#5C6BC0';
  
  const index = Math.floor(position * (colors.length - 1));
  return colors[Math.min(index, colors.length - 1)];
}

// Get multiple colors for a visualization
export function getColorArray(scheme: VisualizerColorScheme, count: number, themeColor?: string): string[] {
  if (scheme === 'theme' && themeColor) {
    return Array(count).fill(themeColor);
  }
  
  const colors = colorSchemeGradients[scheme];
  if (!colors.length) return Array(count).fill(themeColor || '#5C6BC0');
  
  return Array.from({ length: count }, (_, i) => {
    const position = i / (count - 1);
    const index = Math.floor(position * (colors.length - 1));
    const nextIndex = Math.min(index + 1, colors.length - 1);
    const localPosition = (position * (colors.length - 1)) - index;
    
    // Interpolate between colors
    return interpolateColor(colors[index], colors[nextIndex], localPosition);
  });
}

// Helper: Interpolate between two hex colors
function interpolateColor(color1: string, color2: string, factor: number): string {
  const r1 = parseInt(color1.slice(1, 3), 16);
  const g1 = parseInt(color1.slice(3, 5), 16);
  const b1 = parseInt(color1.slice(5, 7), 16);
  
  const r2 = parseInt(color2.slice(1, 3), 16);
  const g2 = parseInt(color2.slice(3, 5), 16);
  const b2 = parseInt(color2.slice(5, 7), 16);
  
  const r = Math.round(r1 + (r2 - r1) * factor);
  const g = Math.round(g1 + (g2 - g1) * factor);
  const b = Math.round(b1 + (b2 - b1) * factor);
  
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Visualizer style display names
export const visualizerStyleNames: Record<VisualizerStyle, string> = {
  'bars-rounded': 'Rounded Bars ⭐',
  'classic-bars': 'Classic Bars',
  'circular-spectrum': 'Circular Spectrum',
  'waveform': 'Waveform',
  'symmetric-bars': 'Symmetric Bars',
  'particles': 'Particles',
  'frequency-rings': 'Frequency Rings',
  'line-spectrum': 'Line Spectrum',
  'radial-bars': 'Radial Bars',
  'block-grid': 'Block Grid',
  'spiral': 'Spiral',
};

// Color scheme display names
export const colorSchemeNames: Record<VisualizerColorScheme, string> = {
  'theme': 'Theme Color',
  'rainbow': 'Rainbow',
  'fire': 'Fire',
  'ocean': 'Ocean',
  'neon': 'Neon',
  'sunset': 'Sunset',
  'aurora': 'Aurora',
  'monochrome': 'Monochrome',
  'purple-blue-green': 'Purple Blue Green',
};

// Default visualizer theme ID - User's favorite (rounded bars)
export const DEFAULT_VISUALIZER_THEME = 'rounded-bars';

// Get theme by ID
export function getVisualizerTheme(themeId: string): VisualizerTheme {
  return visualizerThemes.find(t => t.id === themeId) || visualizerThemes[0];
}
