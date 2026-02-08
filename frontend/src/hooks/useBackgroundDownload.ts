import { useState, useEffect, useCallback } from 'react';
import backgroundDownload, { 
  PendingDownload, 
  DownloadProgress 
} from '../utils/backgroundDownload';

export interface UseBackgroundDownloadReturn {
  // State
  isSupported: boolean;
  isOnline: boolean;
  pendingDownloads: PendingDownload[];
  activeDownloads: DownloadProgress[];
  isLoading: boolean;
  
  // Actions
  queueDownload: (url: string, title?: string) => Promise<boolean>;
  queueDownloads: (downloads: { url: string; title?: string }[]) => Promise<boolean>;
  removePendingDownload: (id: number) => Promise<boolean>;
  triggerSync: () => Promise<boolean>;
  refreshStatus: () => Promise<void>;
  // Lazy polling control - only poll when UI is visible
  startPolling: () => void;
  stopPolling: () => void;
}

export function useBackgroundDownload(): UseBackgroundDownloadReturn {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingDownloads, setPendingDownloads] = useState<PendingDownload[]>([]);
  const [activeDownloads, setActiveDownloads] = useState<DownloadProgress[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Set auth token when component mounts
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      backgroundDownload.setAuthToken(token);
    }
  }, []);

  // Handle online/offline status
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Trigger sync when coming back online
      backgroundDownload.triggerSync();
    };
    
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Track if polling is active (only when UI is visible)
  const [pollingActive, setPollingActive] = useState(false);

  // Subscribe to status updates - but DON'T auto-start polling
  // Polling is controlled by startPolling/stopPolling for lazy loading
  useEffect(() => {
    const unsubscribe = backgroundDownload.onStatusUpdate((downloads) => {
      setActiveDownloads(downloads);
    });

    return () => {
      unsubscribe();
      backgroundDownload.stopStatusPolling();
    };
  }, []);

  // Start polling - call this when download UI becomes visible
  const startPolling = useCallback(() => {
    if (isOnline && !pollingActive) {
      console.debug('[BackgroundDownload] Starting polling (UI visible)');
      backgroundDownload.startStatusPolling(10000);
      setPollingActive(true);
    }
  }, [isOnline, pollingActive]);

  // Stop polling - call this when download UI is hidden
  const stopPolling = useCallback(() => {
    if (pollingActive) {
      console.debug('[BackgroundDownload] Stopping polling (UI hidden)');
      backgroundDownload.stopStatusPolling();
      setPollingActive(false);
    }
  }, [pollingActive]);

  // Load pending downloads on mount
  useEffect(() => {
    loadPendingDownloads();
  }, []);

  const loadPendingDownloads = async () => {
    const downloads = await backgroundDownload.getPendingDownloads();
    setPendingDownloads(downloads);
  };

  const refreshStatus = useCallback(async () => {
    setIsLoading(true);
    try {
      await loadPendingDownloads();
      
      // Also fetch active downloads from server
      const token = localStorage.getItem('token');
      if (token && navigator.onLine) {
        const [pendingRes, downloadingRes] = await Promise.all([
          fetch('/api/download/?filter=pending', {
            headers: { 'Authorization': `Token ${token}` },
          }),
          fetch('/api/download/?filter=downloading', {
            headers: { 'Authorization': `Token ${token}` },
          }),
        ]);

        if (pendingRes.ok && downloadingRes.ok) {
          const pending = await pendingRes.json();
          const downloading = await downloadingRes.json();
          setActiveDownloads([
            ...(pending.data || []),
            ...(downloading.data || []),
          ]);
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const queueDownload = useCallback(async (url: string, title?: string): Promise<boolean> => {
    setIsLoading(true);
    try {
      const result = await backgroundDownload.queueDownload(url, title);
      
      if (result.success) {
        await loadPendingDownloads();
      }
      
      return result.success;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const queueDownloads = useCallback(async (downloads: { url: string; title?: string }[]): Promise<boolean> => {
    setIsLoading(true);
    try {
      const result = await backgroundDownload.queueDownloads(downloads);
      
      if (result.success) {
        await loadPendingDownloads();
      }
      
      return result.success;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const removePendingDownload = useCallback(async (id: number): Promise<boolean> => {
    const success = await backgroundDownload.removePendingDownload(id);
    
    if (success) {
      setPendingDownloads(prev => prev.filter(d => d.id !== id));
    }
    
    return success;
  }, []);

  const triggerSync = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    try {
      const result = await backgroundDownload.triggerSync();
      await loadPendingDownloads();
      return result;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    isSupported: backgroundDownload.supported,
    isOnline,
    pendingDownloads,
    activeDownloads,
    isLoading,
    queueDownload,
    queueDownloads,
    removePendingDownload,
    triggerSync,
    refreshStatus,
    startPolling,
    stopPolling,
  };
}

export default useBackgroundDownload;
