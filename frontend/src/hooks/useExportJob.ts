import { useCallback, useEffect, useState } from 'react';
import { exportJobAPI } from '../api/client';

const POLL_INTERVAL_MS = 2000;
const ACTIVE_STATUSES = ['queued', 'running'];

export interface ExportJob {
  id: string;
  status: 'queued' | 'running' | 'ready' | 'failed' | 'canceled' | 'expired';
  tracks_done: number;
  tracks_total: number;
  summary: { omitted?: unknown[]; warnings?: unknown[] };
  error: string;
}

/** Follows a background export while the dialog is open; the export itself runs on regardless. */
export function useExportJob(playlistId: string, open: boolean) {
  const [job, setJob] = useState<ExportJob | null>(null);

  // Coming back to the dialog finds an export started earlier.
  useEffect(() => {
    if (!open) return;
    exportJobAPI.list(playlistId).then((response) => setJob(response.data.data?.[0] ?? null)).catch(console.error);
  }, [open, playlistId]);

  const follow = useCallback(async (jobId: string) => {
    const response = await exportJobAPI.get(jobId);
    setJob(response.data);
  }, []);

  const jobId = job?.id;
  const isActive = Boolean(job && ACTIVE_STATUSES.includes(job.status));

  useEffect(() => {
    if (!open || !isActive || !jobId) return undefined;

    const timer = setTimeout(() => follow(jobId).catch(console.error), POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [open, isActive, jobId, follow, job]);

  const cancel = useCallback(async () => {
    if (!jobId) return;
    await exportJobAPI.cancel(jobId);
    setJob(null);
  }, [jobId]);

  return { job, isActive, follow, cancel };
}
