/**
 * Visualizer Themes Configuration
 * Multiple visualization styles and color schemes for the audio player
 */

export type VisualizerStyle = 
  | 'bars' 
  | 'bars-rounded' 
  | 'wave' 
  | 'circular' 
  | 'particles' 
  | 'spectrum'
  | 'mirror-bars'
  | 'dots';

export type VisualizerColorScheme = 
  | 'theme' 
  | 'rainbow' 
  | 'fire' 
  | 'ocean' 
  | 'neon' 
  | 'sunset'
  | 'aurora'
  | 'monochrome';

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
  {
    id: 'classic-bars',
    name: 'Classic Bars',
    style: 'bars',
    colorScheme: 'theme',
    description: 'Traditional frequency bars using theme colors',
    preview: {
      primaryColor: '#5C6BC0',
      secondaryColor: '#3F51B5',
    },
  },
  {
    id: 'rounded-bars',
    name: 'Rounded Bars',
    style: 'bars-rounded',
    colorScheme: 'theme',
    description: 'Soft rounded bars with smooth animations',
    preview: {
      primaryColor: '#7E57C2',
      secondaryColor: '#5C6BC0',
    },
  },
  {
    id: 'neon-wave',
    name: 'Neon Wave',
    style: 'wave',
    colorScheme: 'neon',
    description: 'Flowing neon waveform visualization',
    preview: {
      primaryColor: '#00FF87',
      secondaryColor: '#FF00FF',
      accentColor: '#00FFFF',
    },
  },
  {
    id: 'fire-spectrum',
    name: 'Fire Spectrum',
    style: 'spectrum',
    colorScheme: 'fire',
    description: 'Blazing fire-colored frequency spectrum',
    preview: {
      primaryColor: '#FF4500',
      secondaryColor: '#FFD700',
      accentColor: '#FF6347',
    },
  },
  {
    id: 'ocean-wave',
    name: 'Ocean Wave',
    style: 'wave',
    colorScheme: 'ocean',
    description: 'Cool ocean-inspired flowing waves',
    preview: {
      primaryColor: '#006994',
      secondaryColor: '#00CED1',
      accentColor: '#40E0D0',
    },
  },
  {
    id: 'circular-rainbow',
    name: 'Circular Rainbow',
    style: 'circular',
    colorScheme: 'rainbow',
    description: 'Colorful circular audio spectrum',
    preview: {
      primaryColor: '#FF0000',
      secondaryColor: '#00FF00',
      accentColor: '#0000FF',
    },
  },
  {
    id: 'aurora-particles',
    name: 'Aurora Particles',
    style: 'particles',
    colorScheme: 'aurora',
    description: 'Northern lights-inspired particle effect',
    preview: {
      primaryColor: '#00FF87',
      secondaryColor: '#7B68EE',
      accentColor: '#FF69B4',
    },
  },
  {
    id: 'sunset-mirror',
    name: 'Sunset Mirror',
    style: 'mirror-bars',
    colorScheme: 'sunset',
    description: 'Mirrored bars with warm sunset colors',
    preview: {
      primaryColor: '#FF6B6B',
      secondaryColor: '#FFE66D',
      accentColor: '#FF8E53',
    },
  },
  {
    id: 'minimal-dots',
    name: 'Minimal Dots',
    style: 'dots',
    colorScheme: 'monochrome',
    description: 'Clean, minimalist dot visualization',
    preview: {
      primaryColor: '#FFFFFF',
      secondaryColor: '#888888',
    },
  },
  {
    id: 'rainbow-bars',
    name: 'Rainbow Bars',
    style: 'bars',
    colorScheme: 'rainbow',
    description: 'Full spectrum rainbow-colored bars',
    preview: {
      primaryColor: '#FF0000',
      secondaryColor: '#00FF00',
      accentColor: '#0000FF',
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
};

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
  'bars': 'Classic Bars',
  'bars-rounded': 'Rounded Bars',
  'wave': 'Wave',
  'circular': 'Circular',
  'particles': 'Particles',
  'spectrum': 'Spectrum',
  'mirror-bars': 'Mirror Bars',
  'dots': 'Dots',
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
};

// Default visualizer theme ID
export const DEFAULT_VISUALIZER_THEME = 'classic-bars';

// Get theme by ID
export function getVisualizerTheme(themeId: string): VisualizerTheme {
  return visualizerThemes.find(t => t.id === themeId) || visualizerThemes[0];
}
