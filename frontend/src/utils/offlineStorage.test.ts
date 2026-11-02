import { beforeEach, describe, expect, it, vi } from 'vitest';

// A small IndexedDB stand-in that lets a test decide how the transaction ends, which is the
// behavior in question: the request can succeed and the transaction still abort.
type Ending = 'complete' | 'abort' | 'never';

function fakeIndexedDB() {
  const state = { ending: 'complete' as Ending, finishTransaction: () => undefined as void };
  const transaction = (storeName: string) => {
    if (storeName === 'missing') throw new DOMException('No such store', 'NotFoundError');
    const tx: any = { error: null };
    const finish = () => {
      if (state.ending === 'abort') {
        tx.error = new DOMException('Over quota', 'QuotaExceededError');
        tx.onabort?.();
        return;
      }
      tx.oncomplete?.();
    };
    state.finishTransaction = finish;
    const request = () => {
      const pending: any = {};
      queueMicrotask(() => {
        pending.onsuccess?.();
        if (state.ending !== 'never') finish();
      });
      return pending;
    };
    tx.objectStore = () => ({ put: request, delete: request, clear: request });
    return tx;
  };
  const db = { objectStoreNames: { contains: () => true }, transaction };
  const open = () => {
    const pending: any = { result: db };
    queueMicrotask(() => pending.onsuccess?.());
    return pending;
  };
  return { state, api: { open } };
}

describe('offlineStorage writes', () => {
  let database: ReturnType<typeof fakeIndexedDB>;
  let offlineStorage: any;

  beforeEach(async () => {
    vi.resetModules();
    database = fakeIndexedDB();
    vi.stubGlobal('indexedDB', database.api);
    ({ offlineStorage } = await import('./offlineStorage'));
    await offlineStorage.init();
  });

  const writes: Array<[string, () => Promise<void>]> = [
    ['put', () => offlineStorage.put('lyrics', { youtube_id: 'X' })],
    ['delete', () => offlineStorage.delete('lyrics', 'X')],
    ['clear', () => offlineStorage.clear('lyrics')],
  ];

  it.each(writes)('%s waits for the transaction to commit', async (_name, write) => {
    database.state.ending = 'never';
    let settled = false;

    const writing = write().then(() => { settled = true; });
    await new Promise((done) => setTimeout(done, 0));
    expect(settled).toBe(false);

    database.state.finishTransaction();
    await writing;
    expect(settled).toBe(true);
  });

  it.each(writes)('%s rejects when the transaction aborts', async (_name, write) => {
    database.state.ending = 'abort';

    await expect(write()).rejects.toThrow('Over quota');
  });

  it('rejects instead of pretending a write to a missing store worked', async () => {
    await expect(offlineStorage.put('missing', {})).rejects.toThrow('No such store');
  });

  it('a lyrics save that fails reaches the caller', async () => {
    database.state.ending = 'abort';

    await expect(offlineStorage.saveLyrics('X', { plain_lyrics: 'words' })).rejects.toThrow('Over quota');
  });
});
