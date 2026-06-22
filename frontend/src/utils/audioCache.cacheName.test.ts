import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// Regression guard for the v1/v3 mismatch: audioCache.ts read 'soundwave-audio-v1'
// while the service worker wrote 'soundwave-audio-v3', so the offline-cache index was
// always empty. This test fails if the two names ever drift apart again.
describe('service-worker audio cache name', () => {
  it('matches between audioCache.ts and public/service-worker.js', () => {
    const sw = readFileSync(resolve(here, '../../public/service-worker.js'), 'utf8');
    const client = readFileSync(resolve(here, './audioCache.ts'), 'utf8');

    const swName = sw.match(/AUDIO_CACHE_NAME\s*=\s*'([^']+)'/)?.[1];
    const clientName = client.match(/SW_AUDIO_CACHE_NAME\s*=\s*'([^']+)'/)?.[1];

    expect(swName, 'AUDIO_CACHE_NAME not found in service-worker.js').toBeTruthy();
    expect(clientName, 'SW_AUDIO_CACHE_NAME not found in audioCache.ts').toBeTruthy();
    expect(clientName).toBe(swName);
  });
});
