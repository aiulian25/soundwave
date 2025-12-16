import { createTheme, Theme } from '@mui/material/styles';

export type ThemeMode = 'dark' | 'blue' | 'white' | 'green' | 'lightBlue';

const baseTypography = {
  fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
  fontSize: 13,
  h1: { fontWeight: 600, fontSize: '1.8rem' },
  h2: { fontWeight: 600, fontSize: '1.6rem' },
  h3: { fontWeight: 600, fontSize: '1.4rem' },
  h4: { fontWeight: 600, fontSize: '1.2rem' },
  h5: { fontWeight: 500, fontSize: '1.1rem' },
  h6: { fontWeight: 500, fontSize: '1rem' },
  body1: { fontSize: '0.875rem' },
  body2: { fontSize: '0.8125rem' },
  button: { fontSize: '0.8125rem' },
  caption: { fontSize: '0.75rem' },
};

const baseShape = {
  borderRadius: 12,
};

const baseComponents = {
  MuiButton: {
    styleOverrides: {
      root: {
        textTransform: 'none',
        fontWeight: 500,
        padding: '8px 16px',
        minHeight: '36px',
        fontSize: '0.875rem',
        borderRadius: '9999px',
        transition: 'all 0.3s ease',
      },
      sizeSmall: {
        padding: '6px 12px',
        minHeight: '32px',
        fontSize: '0.8125rem',
      },
      sizeLarge: {
        padding: '10px 20px',
        minHeight: '40px',
      },
    },
  },
  MuiCard: {
    styleOverrides: {
      root: {
        backgroundImage: 'none',
        borderRadius: '16px',
        transition: 'transform 0.3s ease, box-shadow 0.3s ease',
        '&:hover': {
          transform: 'translateY(-2px)',
        },
      },
    },
  },
  MuiCardContent: {
    styleOverrides: {
      root: {
        padding: '12px',
        '&:last-child': {
          paddingBottom: '12px',
        },
      },
    },
  },
  MuiIconButton: {
    styleOverrides: {
      root: {
        padding: '6px',
      },
      sizeSmall: {
        padding: '4px',
      },
    },
  },
  MuiChip: {
    styleOverrides: {
      root: {
        height: '24px',
        fontSize: '0.75rem',
      },
    },
  },
  MuiTableCell: {
    styleOverrides: {
      root: {
        padding: '8px 12px',
        fontSize: '0.8125rem',
      },
      head: {
        fontWeight: 600,
        fontSize: '0.8125rem',
      },
    },
  },
  MuiListItem: {
    styleOverrides: {
      root: {
        paddingTop: '4px',
        paddingBottom: '4px',
      },
    },
  },
  MuiListItemButton: {
    styleOverrides: {
      root: {
        paddingTop: '6px',
        paddingBottom: '6px',
      },
    },
  },
  MuiAlert: {
    styleOverrides: {
      root: {
        padding: '6px 12px',
        fontSize: '0.8125rem',
      },
    },
  },
  MuiTextField: {
    styleOverrides: {
      root: {
        '& .MuiInputBase-root': {
          fontSize: '0.875rem',
        },
      },
    },
  },
  MuiAccordionSummary: {
    styleOverrides: {
      root: {
        minHeight: '42px',
        '&.Mui-expanded': {
          minHeight: '42px',
        },
      },
      content: {
        margin: '8px 0',
        '&.Mui-expanded': {
          margin: '8px 0',
        },
      },
    },
  },
  MuiAccordionDetails: {
    styleOverrides: {
      root: {
        padding: '8px 16px 16px',
      },
    },
  },
};

// Dark Theme - Slate/Cyan Dark Mode
const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#22d3ee', // Cyan 400 - brighter for dark mode
      light: '#67e8f9', // Cyan 300
      dark: '#06b6d4', // Cyan 500
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#fbbf24', // Amber 400 accent
      light: '#fcd34d', // Amber 300
      dark: '#f59e0b', // Amber 500
      contrastText: '#000000',
    },
    background: {
      default: '#0f172a', // Slate 900 (Main Dark Background)
      paper: '#1e293b', // Slate 800 (Surface)
    },
    text: {
      primary: '#f8fafc', // Slate 50 (Light Text)
      secondary: '#94a3b8', // Slate 400 (Muted Text)
    },
    success: { main: '#10b981' },
    error: { main: '#ef4444' },
    warning: { main: '#fbbf24' },
    info: { main: '#22d3ee' },
  },
  typography: baseTypography,
  shape: baseShape,
  components: baseComponents,
});

// Blue Theme
const blueTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#13ec6a', // Vibrant Green
      light: '#4fff92',
      dark: '#0db855',
    },
    secondary: {
      main: '#00BCD4', // Cyan
      light: '#4DD0E1',
      dark: '#0097A7',
    },
    background: {
      default: '#0D1B2A', // Deep ocean blue
      paper: '#1B263B', // Dark blue
    },
    text: {
      primary: '#E0F7FA',
      secondary: '#B3E5FC',
    },
    success: { main: '#13ec6a' },
    error: { main: '#FF5252' },
    warning: { main: '#FFD740' },
    info: { main: '#13ec6a' },
  },
  typography: baseTypography,
  shape: baseShape,
  components: baseComponents,
});

// White Theme (Light)
const whiteTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#13ec6a', // Vibrant Green
      light: '#4fff92',
      dark: '#0db855',
    },
    secondary: {
      main: '#13ec6a',
      light: '#4fff92',
      dark: '#0db855',
    },
    background: {
      default: '#f6f8f7', // Light gray-green
      paper: '#FFFFFF', // Pure white
    },
    text: {
      primary: '#0f172a',
      secondary: '#64748b',
    },
    success: { main: '#13ec6a' },
    error: { main: '#D32F2F' },
    warning: { main: '#F57C00' },
    info: { main: '#13ec6a' },
  },
  typography: baseTypography,
  shape: baseShape,
  components: {
    ...baseComponents,
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
        },
      },
    },
  },
});

// Green Theme
const greenTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#13ec6a', // Vibrant Green
      light: '#4fff92',
      dark: '#0db855',
    },
    secondary: {
      main: '#13ec6a',
      light: '#4fff92',
      dark: '#0db855',
    },
    background: {
      default: '#102217', // Dark green-black
      paper: '#162e21', // Surface dark green
    },
    text: {
      primary: '#ffffff',
      secondary: 'rgba(255, 255, 255, 0.6)',
    },
    success: { main: '#13ec6a' },
    error: { main: '#EF5350' },
    warning: { main: '#FFA726' },
    info: { main: '#13ec6a' },
  },
  typography: baseTypography,
  shape: baseShape,
  components: baseComponents,
});

// Light Blue Theme - Cyan/Ocean inspired theme
const lightBlueTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#06b6d4', // Cyan 500
      light: '#22d3ee', // Cyan 400
      dark: '#0891b2', // Cyan 600
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#0ea5e9', // Sky 500
      light: '#38bdf8', // Sky 400
      dark: '#0284c7', // Sky 600
      contrastText: '#ffffff',
    },
    background: {
      default: '#ecfeff', // Cyan 50
      paper: '#ffffff',
    },
    text: {
      primary: '#0c4a6e', // Sky 900
      secondary: '#0369a1', // Sky 700
    },
    success: { main: '#10b981' },
    error: { main: '#ef4444' },
    warning: { main: '#f59e0b' },
    info: { main: '#06b6d4' },
  },
  typography: baseTypography,
  shape: baseShape,
  components: baseComponents,
});

export const themes: Record<ThemeMode, Theme> = {
  dark: darkTheme,
  blue: blueTheme,
  white: whiteTheme,
  green: greenTheme,
  lightBlue: lightBlueTheme,
};

export const themeNames: Record<ThemeMode, string> = {
  dark: 'Dark',
  blue: 'Ocean Blue',
  white: 'Light',
  green: 'Forest Green',
  lightBlue: 'Light Blue',
};

export const getTheme = (mode: ThemeMode): Theme => {
  return themes[mode] || themes.dark;
};

export const saveThemePreference = (mode: ThemeMode): void => {
  localStorage.setItem('themeMode', mode);
};

export const getThemePreference = (): ThemeMode => {
  const saved = localStorage.getItem('themeMode');
  return (saved as ThemeMode) || 'dark';
};

export default darkTheme;
