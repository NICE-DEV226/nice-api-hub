/**
 * Client-side platform detection from the URL hostname — mirrors the host
 * allowlist in api/src/providers/platforms.ts. Used to show an instant
 * "detected: YouTube" hint while the user pastes, before resolving.
 */

interface KnownPlatform {
  id: string;
  name: string;
  hosts: string[];
}

const KNOWN: KnownPlatform[] = [
  { id: "youtube", name: "YouTube", hosts: ["youtube.com", "youtu.be", "youtube-nocookie.com"] },
  { id: "tiktok", name: "TikTok", hosts: ["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"] },
  { id: "twitter", name: "X / Twitter", hosts: ["twitter.com", "x.com", "mobile.twitter.com"] },
  { id: "instagram", name: "Instagram", hosts: ["instagram.com", "instagr.am"] },
  { id: "facebook", name: "Facebook", hosts: ["facebook.com", "fb.watch", "fb.com", "m.facebook.com"] },
  { id: "soundcloud", name: "SoundCloud", hosts: ["soundcloud.com", "snd.sc", "on.soundcloud.com"] },
  { id: "linkedin", name: "LinkedIn", hosts: ["linkedin.com"] },
  { id: "pinterest", name: "Pinterest", hosts: ["pinterest.com", "pin.it"] },
  { id: "dailymotion", name: "Dailymotion", hosts: ["dailymotion.com", "dai.ly"] },
  { id: "bluesky", name: "Bluesky", hosts: ["bsky.app"] },
];

function hostMatches(hostname: string, suffix: string): boolean {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

export interface DetectedPlatform {
  id: string;
  name: string;
}

/** Returns the platform for a URL, or null when the host isn't recognized. */
export function detectPlatform(raw: string): DetectedPlatform | null {
  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const hostname = url.hostname.toLowerCase();
  const found = KNOWN.find((p) => p.hosts.some((h) => hostMatches(hostname, h)));
  return found ? { id: found.id, name: found.name } : null;
}
