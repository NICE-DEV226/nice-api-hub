import { upstreamRaw } from '../http.js';
import { ProviderError, type MediaDraft, type Provider, type Variant } from '../types.js';
import { makeVariant, safeHttpUrl } from './mime.js';

const API = 'https://public.api.bsky.app/xrpc';

interface Embed {
  $type?: string;
  playlist?: string;
  thumbnail?: string;
  images?: Array<{ fullsize?: string; thumb?: string; alt?: string }>;
  media?: Embed;
}

interface Post {
  author?: { handle?: string; displayName?: string };
  record?: { text?: string };
  embed?: Embed;
}

function collect(embed: Embed | undefined, variants: Variant[], thumbs: string[]): void {
  if (!embed) return;
  const type = embed.$type ?? '';
  if (type.startsWith('app.bsky.embed.video')) {
    const v = makeVariant({
      kind: 'video',
      url: safeHttpUrl(embed.playlist),
      protocol: 'hls',
      mime: 'application/vnd.apple.mpegurl',
      label: 'HLS playlist',
    });
    if (v) variants.push(v);
    const t = safeHttpUrl(embed.thumbnail);
    if (t) thumbs.push(t);
  } else if (type.startsWith('app.bsky.embed.images')) {
    for (const img of embed.images ?? []) {
      const v = makeVariant({ kind: 'image', url: safeHttpUrl(img.fullsize), label: img.alt || undefined });
      if (v) variants.push(v);
      const t = safeHttpUrl(img.thumb);
      if (t) thumbs.push(t);
    }
  } else if (type.startsWith('app.bsky.embed.recordWithMedia')) {
    collect(embed.media, variants, thumbs);
  }
}

/** Pure mapping of `app.bsky.feed.getPostThread`. Tested against a real post. */
export function parseBlueskyPost(json: { thread?: { post?: Post } }): MediaDraft {
  const post = json.thread?.post;
  if (!post) throw new ProviderError('unavailable', 'post not found');

  const variants: Variant[] = [];
  const thumbs: string[] = [];
  collect(post.embed, variants, thumbs);
  if (variants.length === 0) throw new ProviderError('unavailable', 'this post has no video or images');

  const text = post.record?.text?.trim();
  return {
    title: text ? text.slice(0, 280) : null,
    author: post.author?.displayName || post.author?.handle || null,
    thumbnail: thumbs[0] ?? null,
    durationSeconds: null,
    variants,
  };
}

/** `https://bsky.app/profile/<handle-or-did>/post/<rkey>` → parts. */
export function parseBlueskyUrl(url: URL): { actor: string; rkey: string } | null {
  const m = /^\/profile\/([^/]+)\/post\/([A-Za-z0-9]+)\/?$/.exec(url.pathname);
  return m ? { actor: m[1]!, rkey: m[2]! } : null;
}

async function getJson(path: string, params: Record<string, string>, signal: AbortSignal) {
  const u = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const { status, text } = await upstreamRaw({ url: u.toString(), signal, acceptStatus: [400, 404] });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ProviderError('bad_response', 'bluesky returned invalid JSON');
  }
  return { status, body };
}

/** Official AT Protocol public AppView: a documented API, no scraping, no key. */
export const blueskyProvider: Provider = {
  id: 'bluesky-appview',
  platform: 'bluesky',
  priority: 10,
  maxConcurrency: 10,

  async fetch({ url, signal }) {
    const ref = parseBlueskyUrl(url);
    if (!ref) throw new ProviderError('unavailable', 'not a Bluesky post URL');

    let did = ref.actor;
    if (!did.startsWith('did:')) {
      const r = await getJson('com.atproto.identity.resolveHandle', { handle: ref.actor }, signal);
      const resolved = (r.body as { did?: string }).did;
      if (r.status !== 200 || !resolved) throw new ProviderError('unavailable', 'unknown Bluesky account');
      did = resolved;
    }

    const r = await getJson(
      'app.bsky.feed.getPostThread',
      { uri: `at://${did}/app.bsky.feed.post/${ref.rkey}`, depth: '0', parentHeight: '0' },
      signal,
    );
    if (r.status !== 200) throw new ProviderError('unavailable', 'post not found');
    return parseBlueskyPost(r.body as { thread?: { post?: Post } });
  },
};
