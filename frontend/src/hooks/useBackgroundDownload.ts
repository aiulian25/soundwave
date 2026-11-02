import { useState, useEffect, useCallback } from 'react';
import backgroundDownload, { DownloadProgress } from '../utils/backgroundDownload';

export interface UseBackgroundDownloadReturn {
  // State
  isOnline: boolean;
  activeDownloads: DownloadProgress[];
  isLoading: boolean;
  
  // Actions
  refreshStatus: () => Promise<void>;
  // Lazy polling control - only poll when UI is visible
  startPolling: () => void;
  stopPolling: () => void;
}

export function useBackgroundDownload(): UseBackgroundDownloadReturn {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [activeDownloads, setActiveDownloads] = useState<DownloadProgress[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Handle online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

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

  const refreshStatus = useCallback(async () => {
    setIsLoading(true);
    try {
      if (navigator.onLine) {
        const [pendingRes, downloadingRes] = await Promise.all([
          fetch('/api/download/?filter=pending', {
            credentials: 'include',
          }),
          fetch('/api/download/?filter=downloading', {
            credentials: 'include',
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

  return {
    isOnline,
    activeDownloads,
    isLoading,
    refreshStatus,
    startPolling,
    stopPolling,
  };
}

export default useBackgroundDownload;
