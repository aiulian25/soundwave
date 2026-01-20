import { useState, useEffect, createContext, useContext } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import App from './App';
import { ThemeMode, getTheme, getThemePreference, saveThemePreference } from './theme/theme';
import { useSettings } from './context/SettingsContext';

interface ThemeContextType {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  themeMode: 'dark',
  setThemeMode: () => {},
});

export const useThemeContext = () => useContext(ThemeContext);

export default function AppWithTheme() {
  const { settings, updateSetting, loading } = useSettings();
  const [themeMode, setThemeModeState] = useState<ThemeMode>(
    settings.theme as ThemeMode || getThemePreference()
  );

  // Sync theme from settings
  useEffect(() => {
    if (!loading && settings.theme) {
      setThemeModeState(settings.theme as ThemeMode);
    }
  }, [settings.theme, loading]);

  const setThemeMode = (mode: ThemeMode) => {
    setThemeModeState(mode);
    saveThemePreference(mode); // Keep localStorage for immediate persistence
    updateSetting('theme', mode); // Sync to backend
  };

  const theme = getTheme(themeMode);

  return (
    <ThemeContext.Provider value={{ themeMode, setThemeMode }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <App />
      </ThemeProvider>
    </ThemeContext.Provider>
  );
}
