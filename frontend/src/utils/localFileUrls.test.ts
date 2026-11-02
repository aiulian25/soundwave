import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalAudioFile } from './localAudioDB';
import { localFileUrl, releaseAllLocalFileUrls, releaseLocalFileUrl } from './localFileUrls';

const localFile = (id: string, file: Blob | undefined = new Blob(['audio'])) =>
  ({ id, file }) as unknown as LocalAudioFile;

describe('local file object URLs', () => {
  let nextUrl = 0;
  const create = vi.fn(() => `blob:test/${nextUrl++}`);
  const revoke = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    create.mockClear();
    revoke.mockClear();
  });

  afterEach(() => releaseAllLocalFileUrls());

  it('reuses one URL however many times a file is played', () => {
    const first = localFileUrl(localFile('a'));
    const second = localFileUrl(localFile('a'));

    expect(second).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('gives a file with no stored data an empty address and no URL', () => {
    const fileWithoutData = { id: 'empty' } as unknown as LocalAudioFile;

    expect(localFileUrl(fileWithoutData)).toBe('');
    expect(create).not.toHaveBeenCalled();
  });

  it('frees only the removed file, and a later play gets a fresh URL', () => {
    const removed = localFileUrl(localFile('a'));
    const kept = localFileUrl(localFile('b'));

    releaseLocalFileUrl('a');

    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith(removed);
    expect(localFileUrl(localFile('b'))).toBe(kept);
    expect(localFileUrl(localFile('a'))).not.toBe(removed);
  });

  it('frees everything when the library is cleared', () => {
    localFileUrl(localFile('a'));
    localFileUrl(localFile('b'));

    releaseAllLocalFileUrls();

    expect(revoke).toHaveBeenCalledTimes(2);
  });
});
