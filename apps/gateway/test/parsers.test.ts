import { describe, expect, it } from 'vitest';
import { parseTikDownloader } from '../src/providers/impl/tikdownloader.js';
import { parseVidfly } from '../src/providers/impl/vidfly.js';

// NOTE: these fixtures are synthetic, built from the selectors the original scrapers used.
// Refresh them with real captured responses (see `npm run probe`-style smoke checks) when available.
const TIK_HTML = `
<div class="thumbnail"><img src="https://cdn.example/t.jpg"><h3> My  clip </h3></div>
<div class="dl-action">
  <a href="https://dl.example/v_hd.mp4">Download MP4 HD</a>
  <a href="https://dl.example/v.mp4">Download MP4</a>
  <a href="https://dl.example/a.mp3">Download MP3</a>
  <a href="#">Fake</a>
  <a href="javascript:alert(1)">Evil</a>
</div>
<ul class="photo-list"><div class="download-box"><li><a href="https://dl.example/p1.jpg">Photo 1</a></li></div></ul>`;

describe('parseTikDownloader', () => {
  const media = parseTikDownloader(TIK_HTML);

  it('extracts metadata', () => {
    expect(media.title).toBe('My clip');
    expect(media.thumbnail).toBe('https://cdn.example/t.jpg');
  });

  it('classifies variants and drops unsafe links', () => {
    expect(media.variants.map((v) => v.kind)).toEqual(['video', 'video', 'audio', 'image']);
    expect(media.variants.some((v) => v.url.startsWith('javascript:'))).toBe(false);
    expect(media.variants.every((v) => /^https?:/.test(v.url))).toBe(true);
  });

  it('derives quality, extension and mime', () => {
    const [hd, , audio] = media.variants;
    expect(hd).toMatchObject({ quality: 'hd', ext: 'mp4', mime: 'video/mp4', hasAudio: true });
    expect(audio).toMatchObject({ kind: 'audio', ext: 'mp3', mime: 'audio/mpeg' });
  });

  it('returns no variants for an empty page', () => {
    expect(parseTikDownloader('<div>nothing</div>').variants).toEqual([]);
  });
});

describe('parseVidfly', () => {
  it('maps the payload to the unified model', () => {
    const media = parseVidfly({
      data: {
        title: 'Song',
        cover: 'https://img.example/c.jpg',
        duration: 212,
        items: [
          { type: 'video', label: '1080p', ext: 'mp4', url: 'https://dl.example/1080.mp4' },
          { type: 'audio', label: '128kbps', extension: 'm4a', url: 'https://dl.example/a.m4a' },
          { type: 'video', label: 'bad', url: 'ftp://nope' },
        ],
      },
    });
    expect(media).toMatchObject({ title: 'Song', durationSeconds: 212, thumbnail: 'https://img.example/c.jpg' });
    expect(media.variants).toHaveLength(2);
    expect(media.variants[1]).toMatchObject({ kind: 'audio', ext: 'm4a', mime: 'audio/mp4' });
  });

  it.each([{}, { data: {} }, { data: { title: 't', items: [] } }])('rejects malformed payload %j', (payload) => {
    expect(() => parseVidfly(payload as any)).toThrow();
  });
});
