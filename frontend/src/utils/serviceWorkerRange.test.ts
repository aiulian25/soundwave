// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Runs the real worker script with real Response and Blob objects, so bytes and headers are
// what a browser would receive.
const WORKER_SOURCE = readFileSync(resolve(__dirname, '../../public/service-worker.js'), 'utf8');
const ORIGIN = 'https://soundwave.test';
const AUDIO_CACHE = 'soundwave-audio-v3';
const STREAM_CACHE = 'soundwave-stream-v1';
const OLD_SHELL_CACHE = 'soundwave-v19';
const PINNED_PATH = '/api/audio/track/download/';
const CASUAL_PATH = '/media/owner/track.m4a';
const TEN_BYTES = '0123456789';
const CONTENT_TYPE = 'audio/mp4';

function loadWorker(body = TEN_BYTES, fetchImplementation = vi.fn()) {
  const stored = () => new Response(body, { status: 200, headers: { 'Content-Type': CONTENT_TYPE } });
  const stores = new Map<string, Map<string, Response>>([
    [AUDIO_CACHE, new Map([[`${ORIGIN}${PINNED_PATH}`, stored()]])],
    [STREAM_CACHE, new Map([[`${ORIGIN}${CASUAL_PATH}`, stored()]])],
    [OLD_SHELL_CACHE, new Map()],
  ]);
  const keyOf = (key: any) => (typeof key === 'string' ? new URL(key, ORIGIN).href : key.url);
  const copyOf = (response?: Response) => response?.clone();
  const cachesApi = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        match: async (key: any) => copyOf(store.get(keyOf(key))),
        put: async (key: any, value: Response) => void store.set(keyOf(key), value),
        delete: async (key: any) => store.delete(keyOf(key)),
        keys: async () => [...store.keys()].map((url) => ({ url })),
        addAll: async () => undefined,
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (key: any) => copyOf([...stores.values()].map((store) => store.get(keyOf(key))).find(Boolean)),
  };
  const listeners: Record<string, (event: any) => void> = {};
  const self = {
    addEventListener: (type: string, listener: (event: any) => void) => { listeners[type] = listener; },
    location: { origin: ORIGIN },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };
  new Function('self', 'caches', 'fetch', 'clients', 'console', WORKER_SOURCE)(
    self,
    cachesApi,
    fetchImplementation,
    self.clients,
    { log: () => undefined, warn: () => undefined, error: () => undefined },
  );

  const request = (path: string, range?: string) => {
    let responded: Promise<Response> | undefined;
    const headers = new Headers(range === undefined ? {} : { Range: range });
    listeners.fetch({
      request: { url: `${ORIGIN}${path}`, method: 'GET', headers, destination: 'audio', mode: 'cors' },
      respondWith: (promise: Promise<Response>) => { responded = promise; },
    });
    return responded!;
  };
  const activate = () => {
    const pending: Promise<unknown>[] = [];
    listeners.activate({ waitUntil: (work: Promise<unknown>) => pending.push(work) });
    return Promise.all(pending);
  };
  return { request, activate, stores };
}

const BOTH_CACHED_PATHS = [['pinned', PINNED_PATH], ['casual', CASUAL_PATH]];

describe.each(BOTH_CACHED_PATHS)('byte ranges on the %s cache path', (_name, path) => {
  it.each([
    ['bytes=2-4', '234', 'bytes 2-4/10'],
    ['bytes=-3', '789', 'bytes 7-9/10'],
    ['bytes=5-', '56789', 'bytes 5-9/10'],
    ['bytes=0-', TEN_BYTES, 'bytes 0-9/10'],
    ['bytes=8-100', '89', 'bytes 8-9/10'],
    ['bytes=-20', TEN_BYTES, 'bytes 0-9/10'],
    ['bytes=9-9', '9', 'bytes 9-9/10'],
    ['BYTES=2-4', '234', 'bytes 2-4/10'],
  ])('%s gives the exact bytes', async (range, expectedBody, contentRange) => {
    const response = await loadWorker().request(path, range);

    expect(response.status).toBe(206);
    expect(await response.text()).toBe(expectedBody);
    expect(response.headers.get('content-range')).toBe(contentRange);
    expect(response.headers.get('content-length')).toBe(String(expectedBody.length));
    expect(response.headers.get('content-type')).toBe(CONTENT_TYPE);
    expect(response.headers.get('accept-ranges')).toBe('bytes');
  });

  it.each(['bytes=20-', 'bytes=10-', 'bytes=-0', 'bytes=10-20'])('%s cannot be satisfied', async (range) => {
    const response = await loadWorker().request(path, range);

    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe('bytes */10');
    expect(await response.text()).toBe('');
  });

  it.each(['bytes=abc', 'items=0-1', 'bytes=-', 'bytes=5-2', 'bytes=0-1,3-4', 'bytes', ''])(
    '"%s" is ignored and the whole body returned',
    async (range) => {
      const response = await loadWorker().request(path, range);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe(TEN_BYTES);
      expect(response.headers.get('content-range')).toBeNull();
      if (range) expect(response.headers.get('accept-ranges')).toBe('bytes');
    },
  );

  it.each(['bytes=0-', 'bytes=-5'])('%s on an empty body cannot be satisfied', async (range) => {
    const response = await loadWorker('').request(path, range);

    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe('bytes */0');
  });

  it('a request without a range gets the whole body', async () => {
    const response = await loadWorker().request(path);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(TEN_BYTES);
    expect(response.headers.get('content-range')).toBeNull();
  });

  it('serves repeated ranges, because the stored response stays readable', async () => {
    const worker = loadWorker();

    expect(await (await worker.request(path, 'bytes=0-0')).text()).toBe('0');
    expect(await (await worker.request(path, 'bytes=-1')).text()).toBe('9');
  });
});

describe('around the range handling', () => {
  it('a casual track not in the cache still goes to the network with its range', async () => {
    const networkResponse = new Response('from network', { status: 206 });
    const fetchMock = vi.fn(async () => networkResponse);
    const worker = loadWorker(TEN_BYTES, fetchMock);

    const response = await worker.request('/media/owner/other.m4a', 'bytes=0-1');

    expect(response).toBe(networkResponse);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('a worker update keeps pinned audio and retires the old shell', async () => {
    const worker = loadWorker();

    await worker.activate();

    expect(worker.stores.get(AUDIO_CACHE)!.has(`${ORIGIN}${PINNED_PATH}`)).toBe(true);
    expect(worker.stores.has(OLD_SHELL_CACHE)).toBe(false);
    expect(await (await worker.request(PINNED_PATH, 'bytes=-3')).text()).toBe('789');
  });
});
