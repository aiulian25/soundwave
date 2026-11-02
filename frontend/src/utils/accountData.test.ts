import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearAllData: vi.fn(),
  clearAccountCaches: vi.fn(),
  resetIndex: vi.fn(),
}));

vi.mock('./offlineStorage', () => ({ offlineStorage: { clearAllData: mocks.clearAllData } }));
vi.mock('./pwa', () => ({ pwaManager: { clearAccountCaches: mocks.clearAccountCaches } }));
vi.mock('./audioCache', () => ({ audioCache: { resetIndex: mocks.resetIndex } }));

import { claimBrowserData, clearAccountData, watchDataOwner } from './accountData';

const OWNER_KEY = 'soundwave_data_owner';
const RECENT_SEARCHES_KEY = 'soundwave_recent_searches';
const ACCOUNT_A = 1;
const ACCOUNT_B = 2;

describe('account data ownership', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.clearAllData.mockReset().mockResolvedValue(undefined);
    mocks.clearAccountCaches.mockReset().mockResolvedValue(undefined);
    mocks.resetIndex.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps data when the same account returns', async () => {
    localStorage.setItem(OWNER_KEY, String(ACCOUNT_A));
    await claimBrowserData(ACCOUNT_A);
    expect(mocks.clearAccountCaches).not.toHaveBeenCalled();
  });

  it('clears data before another account can read it, including after a session expiry', async () => {
    localStorage.setItem(OWNER_KEY, String(ACCOUNT_A));
    localStorage.setItem(RECENT_SEARCHES_KEY, '["a private search"]');
    await claimBrowserData(ACCOUNT_B);
    expect(mocks.clearAllData).toHaveBeenCalledOnce();
    expect(mocks.clearAccountCaches).toHaveBeenCalledOnce();
    expect(mocks.resetIndex).toHaveBeenCalledOnce();
    expect(localStorage.getItem(RECENT_SEARCHES_KEY)).toBeNull();
    expect(localStorage.getItem(OWNER_KEY)).toBe(String(ACCOUNT_B));
  });

  it('adopts data with no recorded owner for an already open session, so upgrading keeps downloads', async () => {
    await claimBrowserData(ACCOUNT_A, { adoptUnknown: true });
    expect(mocks.clearAccountCaches).not.toHaveBeenCalled();
    expect(localStorage.getItem(OWNER_KEY)).toBe(String(ACCOUNT_A));
  });

  it('does not adopt a known owner, even for an open session', async () => {
    localStorage.setItem(OWNER_KEY, String(ACCOUNT_A));
    await claimBrowserData(ACCOUNT_B, { adoptUnknown: true });
    expect(mocks.clearAccountCaches).toHaveBeenCalledOnce();
  });

  it('clears unowned data on a fresh sign-in', async () => {
    await claimBrowserData(ACCOUNT_A);
    expect(mocks.clearAccountCaches).toHaveBeenCalledOnce();
  });

  it('forgets the owner once clearing succeeds', async () => {
    localStorage.setItem(OWNER_KEY, String(ACCOUNT_A));
    await clearAccountData();
    expect(localStorage.getItem(OWNER_KEY)).toBeNull();
  });

  it('ends the server session before clearing', async () => {
    const order: string[] = [];
    mocks.clearAccountCaches.mockImplementation(async () => order.push('caches'));
    await clearAccountData(async () => order.push('server'));
    expect(order).toEqual(['server', 'caches']);
  });

  it('settles when a step never finishes, and keeps the owner so the next account clears again', async () => {
    vi.useFakeTimers();
    localStorage.setItem(OWNER_KEY, String(ACCOUNT_A));
    mocks.clearAccountCaches.mockReturnValue(new Promise(() => undefined));
    const finished = clearAccountData(() => new Promise(() => undefined));
    await vi.runAllTimersAsync();
    await finished;
    expect(localStorage.getItem(OWNER_KEY)).toBe(String(ACCOUNT_A));
  });

  it('a sign-in waits for a clear that is still running', async () => {
    let finishClearing = () => undefined as void;
    mocks.clearAccountCaches.mockReturnValueOnce(new Promise<void>((resolve) => { finishClearing = resolve; }));
    localStorage.setItem(OWNER_KEY, String(ACCOUNT_A));
    const clearing = clearAccountData();
    const claiming = claimBrowserData(ACCOUNT_B);
    await Promise.resolve();
    expect(localStorage.getItem(OWNER_KEY)).toBe(String(ACCOUNT_A));
    finishClearing();
    await clearing;
    await claiming;
    expect(localStorage.getItem(OWNER_KEY)).toBe(String(ACCOUNT_B));
  });

  it('the same account signing back in during its own logout stays recorded as owner', async () => {
    localStorage.setItem(OWNER_KEY, String(ACCOUNT_A));
    const clearing = clearAccountData();
    await claimBrowserData(ACCOUNT_A);
    await clearing;
    expect(localStorage.getItem(OWNER_KEY)).toBe(String(ACCOUNT_A));
  });

  describe('other tabs', () => {
    const storageEvent = (key: string, newValue: string | null) =>
      window.dispatchEvent(new StorageEvent('storage', { key, newValue }));

    it('reacts to a sign-out or a different account, and to nothing else', () => {
      const onChange = vi.fn();
      const stop = watchDataOwner(ACCOUNT_A, onChange);

      storageEvent(OWNER_KEY, String(ACCOUNT_A));
      storageEvent('themeMode', 'dark');
      expect(onChange).not.toHaveBeenCalled();

      storageEvent(OWNER_KEY, null);
      storageEvent(OWNER_KEY, String(ACCOUNT_B));
      expect(onChange).toHaveBeenCalledTimes(2);

      stop();
      storageEvent(OWNER_KEY, null);
      expect(onChange).toHaveBeenCalledTimes(2);
    });

    it('a signed-out tab follows a sign-in elsewhere', () => {
      const onChange = vi.fn();
      const stop = watchDataOwner(null, onChange);
      storageEvent(OWNER_KEY, String(ACCOUNT_A));
      expect(onChange).toHaveBeenCalledOnce();
      stop();
    });
  });
});
