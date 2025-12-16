/**
 * ID3 tag reader using jsmediatags
 * Extracts metadata from audio files
 */

import type { LocalAudioFile } from './localAudioDB';

export async function extractMetadata(file: File): Promise<Partial<LocalAudioFile>> {
  return new Promise((resolve) => {
    // Try to use jsmediatags if available, otherwise use basic metadata
    if (typeof (window as any).jsmediatags !== 'undefined') {
      (window as any).jsmediatags.read(file, {
        onSuccess: (tag: any) => {
          const tags = tag.tags;
          const metadata: Partial<LocalAudioFile> = {
            title: tags.title || file.name.replace(/\.[^/.]+$/, ''),
            artist: tags.artist || 'Unknown Artist',
            album: tags.album || '',
            year: tags.year ? parseInt(tags.year) : null,
            genre: tags.genre || '',
          };

          // Extract cover art
          if (tags.picture) {
            const { data, format } = tags.picture;
            const base64 = btoa(
              data.reduce((acc: string, byte: number) => acc + String.fromCharCode(byte), '')
            );
            metadata.coverArt = `data:${format};base64,${base64}`;
          }

          resolve(metadata);
        },
        onError: () => {
          // Fallback to basic metadata
          resolve({
            title: file.name.replace(/\.[^/.]+$/, ''),
            artist: 'Unknown Artist',
            album: '',
            year: null,
            genre: '',
          });
        },
      });
    } else {
      // No jsmediatags available, use basic metadata
      resolve({
        title: file.name.replace(/\.[^/.]+$/, ''),
        artist: 'Unknown Artist',
        album: '',
        year: null,
        genre: '',
      });
    }
  });
}

export async function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);

    audio.addEventListener('loadedmetadata', () => {
      resolve(Math.round(audio.duration));
      URL.revokeObjectURL(url);
    });

    audio.addEventListener('error', () => {
      resolve(0);
      URL.revokeObjectURL(url);
    });

    audio.src = url;
  });
}
