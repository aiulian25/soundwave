import { describe, expect, it } from 'vitest';
import { classifyMusicLink, firstLinkIn } from './musicLink';

describe('classifyMusicLink', () => {
  it('treats nothing typed and plain words differently', () => {
    expect(classifyMusicLink('   ')).toEqual({ kind: 'empty' });
    expect(classifyMusicLink('my favourite song')).toEqual({ kind: 'invalid' });
  });

  it.each([
    'https://www.youtube.com/watch?v=abc123',
    'https://youtu.be/abc123?si=x',
    'https://www.youtube.com/shorts/abc123',
    'https://music.youtube.com/watch?v=abc123',
    'https://soundcloud.example/artist/song',
  ])('%s is one track', (link) => {
    expect(classifyMusicLink(link)).toEqual({ kind: 'track', url: link });
  });

  it.each([
    ['https://www.youtube.com/playlist?list=PL123', 'playlist'],
    ['https://www.youtube.com/@someone', 'channel'],
    ['https://www.youtube.com/channel/UC123', 'channel'],
    ['https://m.youtube.com/c/someone/videos', 'channel'],
    ['https://www.youtube.com/user/someone', 'channel'],
  ])('%s is a %s to subscribe to', (link, kind) => {
    expect(classifyMusicLink(link)).toEqual({ kind, url: link });
  });

  it('offers both when a video is opened inside a playlist', () => {
    expect(classifyMusicLink('https://www.youtube.com/watch?v=abc123&list=PL123&index=4')).toEqual({
      kind: 'trackInPlaylist',
      trackUrl: 'https://www.youtube.com/watch?v=abc123',
      playlistUrl: 'https://www.youtube.com/playlist?list=PL123',
    });
  });

  it('a generated mix is only its current track', () => {
    const link = 'https://www.youtube.com/watch?v=abc123&list=RDabc123';
    expect(classifyMusicLink(link)).toEqual({ kind: 'track', url: link });
  });

  it('finds the link in text shared from another app', () => {
    expect(firstLinkIn('Great Song - YouTube https://youtu.be/abc123 via app')).toBe('https://youtu.be/abc123');
    expect(classifyMusicLink('Great Song https://youtu.be/abc123')).toEqual({ kind: 'track', url: 'https://youtu.be/abc123' });
    expect(firstLinkIn('no link here')).toBe('');
  });
});
