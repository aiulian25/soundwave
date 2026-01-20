/**
 * Settings Context for managing user settings globally
 */

import React, { createContext, useContext, ReactNode } from 'react';
import { useUserSettings, UserSettings } from '../hooks/useUserSettings';

interface SettingsContextType {
  settings: UserSettings;
  loading: boolean;
  error: string | null;
  updateSetting: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => Promise<boolean>;
  updateExtraSetting: (key: string, value: any) => Promise<boolean>;
  getExtraSetting: (key: string, defaultValue?: any) => any;
  saveSettings: (settings: Partial<UserSettings>) => Promise<boolean>;
  loadSettings: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const settingsHook = useUserSettings();

  return (
    <SettingsContext.Provider value={settingsHook}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};
