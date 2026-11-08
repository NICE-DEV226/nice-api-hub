"use client";

export interface RecentDownload {
  url: string;
  title: string;
  platform: string;
  at: number;
}

const KEY = "nah:web:recents";
const MAX = 6;

export function listRecents(): RecentDownload[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentDownload[];
    return Array.isArray(parsed) ? parsed.filter((r) => r?.url && r?.title).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function pushRecent(entry: RecentDownload): void {
  try {
    const next = [entry, ...listRecents().filter((r) => r.url !== entry.url)].slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — recents are a nicety, not a feature */
  }
}
