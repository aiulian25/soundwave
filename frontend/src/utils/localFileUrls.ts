import type { LocalAudioFile } from './localAudioDB';

// One object URL per file for the life of the page. The player keeps using them after the local
// files page unmounts, so they are released when a file is removed rather than on unmount.
const urlsByFileId = new Map<string, string>();

export function localFileUrl(localFile: LocalAudioFile): string {
  if (!localFile.file) return '';

  const existing = urlsByFileId.get(localFile.id);
  if (existing) return existing;

  const url = URL.createObjectURL(localFile.file);
  urlsByFileId.set(localFile.id, url);
  return url;
}

export function releaseLocalFileUrl(fileId: string): void {
  const url = urlsByFileId.get(fileId);
  if (!url) return;

  URL.revokeObjectURL(url);
  urlsByFileId.delete(fileId);
}

export function releaseAllLocalFileUrls(): void {
  [...urlsByFileId.keys()].forEach(releaseLocalFileUrl);
}
