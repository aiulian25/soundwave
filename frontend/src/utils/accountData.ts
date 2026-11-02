/**
 * Which account the browser's cached data belongs to, and clearing it on every path out
 * of that account: logout, session expiry followed by another sign-in, and other tabs.
 * Imported local files are not touched here; they live in a per-account database.
 */

import { audioCache } from './audioCache';
import { offlineStorage } from './offlineStorage';
import { pwaManager } from './pwa';

const DATA_OWNER_KEY = 'soundwave_data_owner';

export const dataOwner = () => localStorage.getItem(DATA_OWNER_KEY);
const ACCOUNT_LOCAL_STORAGE_KEYS = ['soundwave_recent_searches', 'soundwave_play_history'];
const CLEAR_STEP_TIMEOUT_MS = 5000;

function withinTimeLimit(work: Promise<unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out clearing account data')), CLEAR_STEP_TIMEOUT_MS);
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

async function runClear(beforeClearing?: () => Promise<unknown>): Promise<void> {
  if (beforeClearing) {
    await withinTimeLimit(beforeClearing()).catch((error) => console.error('[AccountData]', error));
  }

  ACCOUNT_LOCAL_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  const steps = await Promise.allSettled([
    withinTimeLimit(offlineStorage.clearAllData()),
    withinTimeLimit(pwaManager.clearAccountCaches()),
  ]);
  audioCache.resetIndex();

  const failures = steps.filter((step) => step.status === 'rejected');
  if (failures.length > 0) {
    // The owner stays recorded, so the next different account clears again.
    console.error('[AccountData] Clearing was incomplete:', failures);
    return;
  }
  localStorage.removeItem(DATA_OWNER_KEY);
}

let pendingClear: Promise<void> = Promise.resolve();

/** Every step is time-limited, so this always settles, with or without a service worker. */
export function clearAccountData(beforeClearing?: () => Promise<unknown>): Promise<void> {
  pendingClear = pendingClear.then(() => runClear(beforeClearing));
  return pendingClear;
}

/**
 * Make the browser's data safe for this account before anything reads it.
 *
 * `adoptUnknown` is for a session that was already open: data with no recorded owner
 * predates this tracking and is almost certainly that session's, so an upgrade does not
 * delete its offline downloads. A fresh sign-in has no such assurance.
 */
export async function claimBrowserData(accountId: number, { adoptUnknown = false } = {}): Promise<void> {
  await pendingClear;
  const owner = localStorage.getItem(DATA_OWNER_KEY);
  const claimant = String(accountId);
  if (owner === claimant) return;

  const mayKeepData = owner === null && adoptUnknown;
  if (!mayKeepData) await clearAccountData();
  localStorage.setItem(DATA_OWNER_KEY, claimant);
}

/** Calls back when another tab changes the owner, so this tab cannot keep showing the old account. */
export function watchDataOwner(accountId: number | null, onChange: () => void): () => void {
  const expectedOwner = accountId === null ? null : String(accountId);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === DATA_OWNER_KEY && event.newValue !== expectedOwner) onChange();
  };
  window.addEventListener('storage', handleStorage);
  return () => window.removeEventListener('storage', handleStorage);
}
