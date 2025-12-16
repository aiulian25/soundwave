# SoundWave Themes

SoundWave now includes 4 beautiful themes that users can switch between from the Settings page.

## Available Themes

### 1. Dark (Default)
**Description**: Original dark theme with indigo and deep purple accents
- **Primary Color**: #5C6BC0 (Indigo)
- **Secondary Color**: #7E57C2 (Deep Purple)
- **Background**: #0A0E27 (Very dark blue) / #151932 (Dark blue-gray)
- **Best For**: Late-night listening sessions, OLED displays

### 2. Ocean Blue
**Description**: Vibrant blue theme with cyan accents
- **Primary Color**: #2196F3 (Bright Blue)
- **Secondary Color**: #00BCD4 (Cyan)
- **Background**: #0D1B2A (Deep ocean blue) / #1B263B (Dark blue)
- **Best For**: Users who love blue aesthetics, calming vibes

### 3. Light
**Description**: Clean light theme with excellent readability
- **Primary Color**: #1976D2 (Blue)
- **Secondary Color**: #9C27B0 (Purple)
- **Background**: #F5F7FA (Light gray-blue) / #FFFFFF (Pure white)
- **Best For**: Daytime use, bright environments, accessibility

### 4. Forest Green
**Description**: Nature-inspired green theme
- **Primary Color**: #4CAF50 (Green)
- **Secondary Color**: #00E676 (Bright green)
- **Background**: #0D1F12 (Deep forest green) / #1A2F23 (Dark green)
- **Best For**: Users who prefer green themes, natural aesthetics

## How to Use

### For Users
1. Navigate to **Settings** page (gear icon in sidebar)
2. Find the **Appearance** section
3. Choose your preferred theme from:
   - Dropdown selector
   - Visual theme preview cards
4. Theme changes instantly and persists across sessions

### For Developers

#### Theme Structure
```typescript
// Located in: frontend/src/theme/theme.ts

export type ThemeMode = 'dark' | 'blue' | 'white' | 'green';

export const themes: Record<ThemeMode, Theme> = {
  dark: darkTheme,
  blue: blueTheme,
  white: whiteTheme,
  green: greenTheme,
};
```

#### Using Theme Context
```tsx
import { useThemeContext } from '../AppWithTheme';

function MyComponent() {
  const { themeMode, setThemeMode } = useThemeContext();
  
  // Get current theme
  console.log(themeMode); // 'dark' | 'blue' | 'white' | 'green'
  
  // Change theme
  setThemeMode('blue');
}
```

#### Theme Persistence
Themes are automatically saved to `localStorage`:
```typescript
// Save theme preference
saveThemePreference('blue');

// Get saved preference
const savedTheme = getThemePreference(); // Returns 'dark' as default
```

## Adding a New Theme

1. **Define the theme in `theme.ts`**:
```typescript
const myNewTheme = createTheme({
  palette: {
    mode: 'dark', // or 'light'
    primary: { main: '#FF0000' },
    secondary: { main: '#00FF00' },
    background: {
      default: '#000000',
      paper: '#111111',
    },
    text: {
      primary: '#FFFFFF',
      secondary: '#CCCCCC',
    },
  },
  typography: baseTypography,
  shape: baseShape,
  components: baseComponents,
});
```

2. **Add to theme collection**:
```typescript
export type ThemeMode = 'dark' | 'blue' | 'white' | 'green' | 'mynew';

export const themes: Record<ThemeMode, Theme> = {
  // ... existing themes
  mynew: myNewTheme,
};

export const themeNames: Record<ThemeMode, string> = {
  // ... existing names
  mynew: 'My New Theme',
};
```

3. **Add colors to ThemePreview** (`components/ThemePreview.tsx`):
```typescript
const themeColors = {
  // ... existing colors
  mynew: {
    primary: '#FF0000',
    secondary: '#00FF00',
    bg1: '#000000',
    bg2: '#111111',
    text: '#FFFFFF',
  },
};
```

## Theme Features

### Automatic Switching
- Themes switch instantly without page reload
- All Material-UI components adapt automatically
- Custom components using `theme` props update in real-time

### Responsive Design
- All themes work across all screen sizes
- Theme preview cards are responsive (6 cols on mobile, 3 on desktop)
- Dropdown selector available for quick switching

### Accessibility
- Light theme provides high contrast for readability
- All themes meet WCAG color contrast guidelines
- Theme choice persists across sessions

### Components Affected
All Material-UI components automatically use theme colors:
- Buttons, Cards, Dialogs
- Text fields, Selects, Switches
- Navigation (Sidebar, TopBar)
- Player controls
- All page components

## Technical Details

### Theme Provider Hierarchy
```
main.tsx
  └─ AppWithTheme (Theme Context Provider)
      └─ ThemeProvider (Material-UI)
          └─ CssBaseline
              └─ App (Main application)
```

### State Management
- Theme state managed by React Context
- Preference stored in localStorage
- No backend API calls needed
- Instant theme switching

### Performance
- Themes are pre-created at import time
- No runtime theme generation
- Minimal re-renders on theme change
- localStorage access is synchronous

## Screenshots

### Settings Page - Appearance Section
- Dropdown selector for quick theme change
- Visual preview cards showing theme colors
- Selected theme is highlighted
- Hover effects for better UX

### Theme Preview Cards
Each card shows:
- Theme name
- Gradient background
- Sample UI elements (header, text, accent)
- Checkmark on selected theme
- Hover animation with theme-colored shadow

## Future Enhancements

Potential theme-related features:
- [ ] Custom theme creator (user-defined colors)
- [ ] Theme import/export
- [ ] Automatic theme switching based on time of day
- [ ] System theme detection (dark/light mode)
- [ ] Per-component theme overrides
- [ ] Theme marketplace/community themes
- [ ] Animated theme transitions
- [ ] Theme presets for colorblind users

## Browser Support

Themes work on all modern browsers:
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Opera 76+

No polyfills needed for theme functionality.

## Credits

- Material-UI theming system
- Color palettes inspired by Material Design
- Theme persistence using Web Storage API

---

**Last Updated**: December 15, 2025
**Current Version**: 1.0
**Total Themes**: 4
