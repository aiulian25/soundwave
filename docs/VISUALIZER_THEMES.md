# 🎨 Visualizer Themes Feature

## Overview

SoundWave now includes customizable audio visualizer themes that provide multiple visualization styles and color schemes for the audio player.

## Features

### Visualization Styles
- **Classic Bars**: Traditional frequency bars using theme colors
- **Rounded Bars**: Soft rounded bars with smooth animations
- **Wave**: Flowing waveform visualization
- **Circular**: Circular audio spectrum display
- **Particles**: Particle-based effect that reacts to audio
- **Spectrum**: Full frequency spectrum with gradients
- **Mirror Bars**: Mirrored bars centered vertically
- **Dots**: Minimalist dot-based visualization

### Color Schemes
- **Theme**: Uses your selected app theme color
- **Rainbow**: Full spectrum rainbow colors
- **Fire**: Warm fire-inspired colors (yellow, orange, red)
- **Ocean**: Cool ocean blues and teals
- **Neon**: Vibrant neon colors (magenta, cyan, green)
- **Sunset**: Warm sunset palette (coral, gold, orange)
- **Aurora**: Northern lights inspired (green, purple, pink)
- **Monochrome**: Clean grayscale palette

## Predefined Themes

| Theme ID | Style | Color Scheme | Description |
|----------|-------|--------------|-------------|
| classic-bars | bars | theme | Traditional frequency bars |
| rounded-bars | bars-rounded | theme | Soft rounded bars |
| neon-wave | wave | neon | Flowing neon waveform |
| fire-spectrum | spectrum | fire | Blazing fire colors |
| ocean-wave | wave | ocean | Cool ocean waves |
| circular-rainbow | circular | rainbow | Colorful circular spectrum |
| aurora-particles | particles | aurora | Northern lights particles |
| sunset-mirror | mirror-bars | sunset | Mirrored bars with sunset colors |
| minimal-dots | dots | monochrome | Clean minimalist dots |
| rainbow-bars | bars | rainbow | Full rainbow colored bars |

## User Settings

### Available Settings
- **visualizer_enabled**: Toggle visualizer on/off (default: true)
- **visualizer_theme**: Selected theme ID (default: 'classic-bars')
- **visualizer_glow**: Enable/disable glow effect (default: true)

### Settings Page
Navigate to **Settings** → **Audio Visualizer** to customize:
1. Enable/disable the visualizer
2. Toggle glow effect
3. Choose from 10 different visualizer themes with live previews

## Technical Implementation

### Frontend Components

1. **visualizerThemes.ts** (`/frontend/src/config/visualizerThemes.ts`)
   - Theme definitions and configurations
   - Color scheme gradients
   - Utility functions for color interpolation

2. **AudioVisualizer.tsx** (`/frontend/src/components/AudioVisualizer.tsx`)
   - Canvas-based visualizer component
   - Multiple rendering functions for different styles
   - Real-time audio data visualization

3. **VisualizerThemePreview.tsx** (`/frontend/src/components/VisualizerThemePreview.tsx`)
   - Animated preview component for settings page
   - Shows mini visualization of each theme style

### Backend Model

**UserConfig** model fields:
```python
visualizer_theme = models.CharField(max_length=50, default='classic-bars')
visualizer_enabled = models.BooleanField(default=True)
visualizer_glow = models.BooleanField(default=True)
```

### API

Settings are managed via the existing `/api/user/config/` endpoint:
- GET: Retrieve current settings
- POST: Update settings

## Usage Example

```typescript
// In Player component
import AudioVisualizer from './AudioVisualizer';

// Render visualizer
{settings.visualizer_enabled && (
  <AudioVisualizer
    data={visualizerData}
    isPlaying={isPlaying}
    themeId={settings.visualizer_theme}
    showGlow={settings.visualizer_glow}
    height={120}
  />
)}
```

## Performance Notes

- Canvas-based rendering for smooth animations
- RequestAnimationFrame for efficient updates
- Particle limits to prevent memory issues
- Automatic cleanup on component unmount

## Migration

Run migration to add visualizer fields:
```bash
python manage.py migrate user
```

## Browser Support

- All modern browsers with Canvas API support
- WebGL not required
- Falls back gracefully if canvas is unavailable
