import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import api from '../api/client';

interface QuickSyncStatus {
  network: {
    speed_mbps: number;
    status: 'excellent' | 'good' | 'fair' | 'poor';
  };
  system: {
    cpu_percent: number;
    memory_percent: number;
    memory_available_mb: number;
    status: 'low_load' | 'moderate_load' | 'high_load';
  };
  quality: {
    level: 'low' | 'medium' | 'high' | 'ultra' | 'auto';
    bitrate: number;
    description: string;
    auto_selected: boolean;
  };
  buffer: {
    buffer_size: number;
    preload: string;
    max_buffer_size: number;
    rebuffer_threshold: number;
  };
  timestamp: number;
}

interface QuickSyncPreferences {
  mode: 'auto' | 'low' | 'medium' | 'high' | 'ultra';
  prefer_quality: boolean;
  adapt_to_system: boolean;
  auto_download_quality: boolean;
}

interface QuickSyncContextType {
  status: QuickSyncStatus | null;
  preferences: QuickSyncPreferences | null;
  loading: boolean;
  updatePreferences: (prefs: Partial<QuickSyncPreferences>) => Promise<void>;
  runSpeedTest: () => Promise<void>;
  refreshStatus: () => Promise<void>;
}

const QuickSyncContext = createContext<QuickSyncContextType | undefined>(undefined);

export const useQuickSync = () => {
  const context = useContext(QuickSyncContext);
  if (!context) {
    throw new Error('useQuickSync must be used within QuickSyncProvider');
  }
  return context;
};

interface QuickSyncProviderProps {
  children: ReactNode;
}

export const QuickSyncProvider = ({ children }: QuickSyncProviderProps) => {
  const [status, setStatus] = useState<QuickSyncStatus | null>(null);
  const [preferences, setPreferences] = useState<QuickSyncPreferences | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = async () => {
    try {
      const response = await api.get('/audio/quick-sync/status/');
      setStatus(response.data.status);
      setPreferences(response.data.preferences);
    } catch (error: any) {
      // Silently handle 401/403 errors (not authenticated or no permission)
      if (error?.response?.status === 401 || error?.response?.status === 403) {
        // Quick Sync feature not available or user not authenticated
        setStatus(null);
        setPreferences(null);
      } else {
        console.error('Error fetching Quick Sync status:', error);
      }
    } finally {
      setLoading(false);
    }
  };

  const updatePreferences = async (prefs: Partial<QuickSyncPreferences>) => {
    try {
      const response = await api.post('/audio/quick-sync/preferences/', prefs);
      setPreferences(response.data.preferences);
      setStatus(response.data.status);
    } catch (error) {
      console.error('Error updating Quick Sync preferences:', error);
      throw error;
    }
  };

  const runSpeedTest = async () => {
    try {
      setLoading(true);
      const response = await api.post('/audio/quick-sync/test/');
      await fetchStatus(); // Refresh full status after test
    } catch (error) {
      console.error('Error running speed test:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const refreshStatus = async () => {
    setLoading(true);
    await fetchStatus();
  };

  useEffect(() => {
    // Only fetch if user is authenticated
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }
    
    fetchStatus();
    // Refresh status every 5 minutes
    const interval = setInterval(fetchStatus, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <QuickSyncContext.Provider
      value={{
        status,
        preferences,
        loading,
        updatePreferences,
        runSpeedTest,
        refreshStatus,
      }}
    >
      {children}
    </QuickSyncContext.Provider>
  );
};
