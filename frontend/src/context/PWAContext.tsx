import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { pwaManager } from '../utils/pwa';
import { audioCache } from '../utils/audioCache';

export interface CacheProgress {
  current: number;
  total: number;
  percent: number;
  currentItem: string;
  status: string;
}

interface CacheResult {
  success: boolean;
  cached: number;
  failed: number;
}

interface PWAContextType {
  isOnline: boolean;
  canInstall: boolean;
  isInstalled: boolean;
  isUpdateAvailable: boolean;
  cacheSize: { usage: number; quota: number } | null;
  showInstallPrompt: () => Promise<boolean>;
  updateApp: () => Promise<void>;
  clearCache: () => Promise<boolean>;
  cacheAudio: (url: string) => Promise<boolean>;
  cachePlaylist: (playlistId: string, audioUrls: string[], onProgress?: (progress: CacheProgress) => void) => Promise<CacheResult>;
  removePlaylistCache: (playlistId: string, audioUrls: string[]) => Promise<boolean>;
  requestNotifications: () => Promise<NotificationPermission>;
}

const PWAContext = createContext<PWAContextType | undefined>(undefined);

export const usePWA = () => {
  const context = useContext(PWAContext);
  if (!context) {
    throw new Error('usePWA must be used within PWAProvider');
  }
  return context;
};

interface PWAProviderProps {
  children: ReactNode;
}

export const PWAProvider: React.FC<PWAProviderProps> = ({ children }) => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [canInstall, setCanInstall] = useState(false);
  const [isInstalled, setIsInstalled] = useState(pwaManager.getIsInstalled());
  const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);
  const [cacheSize, setCacheSize] = useState<{ usage: number; quota: number } | null>(null);

  useEffect(() => {
    // Register service worker
    pwaManager.registerServiceWorker();

    // Set up event listeners
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    const handleCanInstall = () => setCanInstall(true);
    const handleInstalled = () => {
      setIsInstalled(true);
      setCanInstall(false);
    };
    const handleUpdate = () => setIsUpdateAvailable(true);

    pwaManager.on('online', handleOnline);
    pwaManager.on('offline', handleOffline);
    pwaManager.on('canInstall', handleCanInstall);
    pwaManager.on('installed', handleInstalled);
    pwaManager.on('updateAvailable', handleUpdate);

    // Get cache size
    const updateCacheSize = async () => {
      const size = await pwaManager.getCacheSize();
      setCacheSize(size);
    };
    updateCacheSize();

    // Check initial install state
    setCanInstall(pwaManager.canInstall());

    return () => {
      pwaManager.off('online', handleOnline);
      pwaManager.off('offline', handleOffline);
      pwaManager.off('canInstall', handleCanInstall);
      pwaManager.off('installed', handleInstalled);
      pwaManager.off('updateAvailable', handleUpdate);
    };
  }, []);

  const showInstallPrompt = async () => {
    return await pwaManager.showInstallPrompt();
  };

  const updateApp = async () => {
    await pwaManager.updateServiceWorker();
  };

  const clearCache = async () => {
    const result = await pwaManager.clearCache();
    if (result) {
      const size = await pwaManager.getCacheSize();
      setCacheSize(size);
    }
    return result;
  };

  const cacheAudio = async (url: string) => {
    const result = await pwaManager.cacheAudio(url);
    if (result) {
      const size = await pwaManager.getCacheSize();
      setCacheSize(size);
    }
    return result;
  };

  const cachePlaylist = async (playlistId: string, audioUrls: string[], onProgress?: (progress: CacheProgress) => void) => {
    const result = await pwaManager.cachePlaylist(playlistId, audioUrls, onProgress);
    if (result.success) {
      const size = await pwaManager.getCacheSize();
      setCacheSize(size);
      
      // Refresh the in-memory cache index so Player can find cached tracks instantly
      await audioCache.refreshServiceWorkerIndex();
      console.log('[PWA] Refreshed cache index after playlist cache');
    }
    return result;
  };

  const removePlaylistCache = async (playlistId: string, audioUrls: string[]) => {
    const result = await pwaManager.removePlaylistCache(playlistId, audioUrls);
    if (result) {
      const size = await pwaManager.getCacheSize();
      setCacheSize(size);
      
      // Refresh the in-memory cache index
      await audioCache.refreshServiceWorkerIndex();
    }
    return result;
  };

  const requestNotifications = async () => {
    return await pwaManager.requestNotificationPermission();
  };

  const value: PWAContextType = {
    isOnline,
    canInstall,
    isInstalled,
    isUpdateAvailable,
    cacheSize,
    showInstallPrompt,
    updateApp,
    clearCache,
    cacheAudio,
    cachePlaylist,
    removePlaylistCache,
    requestNotifications,
  };

  return <PWAContext.Provider value={value}>{children}</PWAContext.Provider>;
};
