import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadAPI } from '../api/client';
import { getPollingInterval } from '../utils/networkQuality';

export interface DownloadItem {
  id: number;
  url: string;
  youtube_id?: string;
  title?: string;
  channel_name?: string;
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'ignored';
  error_message?: string;
  added_date?: string;
  started_date?: string;
  completed_date?: string;
}

const BASE_POLL_INTERVAL_MS = 3000;

const isActiveStatus = (item: DownloadItem) => item.status === 'pending' || item.status === 'downloading';
const canPollNow = () => !document.hidden && navigator.onLine;

/**
 * Polls the download queue only while `active` (the popover is open) AND there are
 * pending/downloading items, pausing when the tab is hidden or offline, and cleaning
 * up on unmount — so an idle activity center never keeps hitting the API.
 */
export function useActivityCenter(active: boolean) {
  const [items, setItems] = useState<DownloadItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const timerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const activeRef = useRef(active);
  activeRef.current = active;

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const tick = useCallback(async () => {
    stop();
    if (!activeRef.current || !canPollNow()) {
      return;
    }
    let latest: DownloadItem[] = [];
    let failed = false;
    try {
      const response = await downloadAPI.list('all');
      latest = response.data?.data ?? [];
    } catch {
      failed = true;
    }
    // Bail if the component unmounted during the request — never setState or reschedule.
    if (!mountedRef.current) {
      return;
    }
    setError(failed);
    if (!failed) {
      setItems(latest);
    }
    setLoading(false);
    // Keep the loop alive only while it is worth polling.
    if (activeRef.current && canPollNow() && latest.some(isActiveStatus)) {
      timerRef.current = window.setTimeout(tick, getPollingInterval(BASE_POLL_INTERVAL_MS));
    }
  }, [stop]);

  const start = useCallback(() => {
    setLoading(true);
    tick();
  }, [tick]);

  // Track mounted state so no async continuation setStates or reschedules after unmount.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stop();
    };
  }, [stop]);

  // One seed fetch on mount so the badge reflects state without starting the poll loop.
  useEffect(() => {
    if (!canPollNow()) {
      return;
    }
    downloadAPI
      .list('all')
      .then((response) => {
        if (mountedRef.current) {
          setItems(response.data?.data ?? []);
        }
      })
      .catch(() => undefined);
  }, []);

  // Poll while the popover is open; stop and clean up otherwise and on unmount.
  useEffect(() => {
    if (active) {
      start();
    } else {
      stop();
    }
    return stop;
  }, [active, start, stop]);

  // Pause when backgrounded/offline; resume when foregrounded/online.
  useEffect(() => {
    const resume = () => {
      if (activeRef.current && canPollNow()) {
        start();
      }
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('offline', stop);
    return () => {
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', stop);
    };
  }, [start, stop]);

  const retry = useCallback(
    async (id: number) => {
      await downloadAPI.retry(id);
      start(); // the retried item flips to pending -> resume polling
    },
    [start],
  );

  const retryAll = useCallback(async () => {
    await downloadAPI.retry();
    start();
  }, [start]);

  return { items, loading, error, refresh: start, retry, retryAll };
}
