/**
 * Custom hook for managing user settings with backend persistence
 */

import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';

export interface UserSettings {
  theme: string;
  volume: number;
  repeat_mode: 'none' | 'one' | 'all';
  shuffle_enabled: boolean;
  smart_shuffle_enabled: boolean;
  smart_shuffle_history_size: number;
  audio_quality: 'low' | 'medium' | 'high' | 'best';
  items_per_page: number;
  // Visualizer settings
  visualizer_theme: string;
  visualizer_enabled: boolean;
  visualizer_glow: boolean;
  // Prefetch/caching settings
  prefetch_enabled: boolean;
  extra_settings: Record<string, any>;
  updated_at?: string;
}

const DEFAULT_SETTINGS: UserSettings = {
  theme: 'dark',
  volume: 80,
  repeat_mode: 'none',
  shuffle_enabled: false,
  smart_shuffle_enabled: true,
  smart_shuffle_history_size: 10,
  audio_quality: 'high',
  items_per_page: 50,
  // Visualizer defaults
  visualizer_theme: 'classic-bars',
  visualizer_enabled: true,
  visualizer_glow: true,
  // Prefetch defaults
  prefetch_enabled: true,
  extra_settings: {},
};

export const useUserSettings = () => {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load settings from backend
  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get('/user/config/');
      console.log('[Settings] Loaded from backend:', response.data);
      setSettings(response.data);
    } catch (err: any) {
      console.error('Failed to load user settings:', err);
      setError(err?.message || 'Failed to load settings');
      // Use defaults on error
      setSettings(DEFAULT_SETTINGS);
    } finally {
      setLoading(false);
    }
  }, []);

  // Save settings to backend
  const saveSettings = useCallback(async (newSettings: Partial<UserSettings>) => {
    try {
      const response = await api.post('/user/config/', newSettings);
      setSettings(response.data.config);
      return true;
    } catch (err: any) {
      console.error('Failed to save user settings:', err);
      setError(err?.message || 'Failed to save settings');
      return false;
    }
  }, []);

  // Update a single setting
  const updateSetting = useCallback(async <K extends keyof UserSettings>(
    key: K,
    value: UserSettings[K]
  ) => {
    // Optimistic update
    setSettings((prev) => ({ ...prev, [key]: value }));
    
    // Save to backend
    const success = await saveSettings({ [key]: value });
    
    // Revert on failure
    if (!success) {
      await loadSettings();
    }
    
    return success;
  }, [saveSettings, loadSettings]);

  // Update extra setting (nested in extra_settings object)
  const updateExtraSetting = useCallback(async (key: string, value: any) => {
    const newExtraSettings = { ...settings.extra_settings, [key]: value };
    return await updateSetting('extra_settings', newExtraSettings);
  }, [settings.extra_settings, updateSetting]);

  // Get extra setting
  const getExtraSetting = useCallback((key: string, defaultValue: any = null) => {
    return settings.extra_settings[key] ?? defaultValue;
  }, [settings.extra_settings]);

  // Load settings on mount - always try to load (API client handles auth via cookies or token)
  useEffect(() => {
    const token = localStorage.getItem('token');
    console.log('[Settings] Mount check - token exists:', !!token);
    // Always try to load settings - the API will return 401 if not authenticated
    // This handles both token-based and session-based auth
    loadSettings();
  }, [loadSettings]);

  return {
    settings,
    loading,
    error,
    updateSetting,
    updateExtraSetting,
    getExtraSetting,
    saveSettings,
    loadSettings,
  };
};
