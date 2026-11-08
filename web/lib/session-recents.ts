"use client";

export interface RecentDownload {
  url: string;
  title: string;
  platform: string;
  at: number;
}

const KEY = "nah:web:recents";
const MAX = 6;

let snapshot: RecentDownload[] | null = null;
const listeners = new Set<() => void>();

function read(): RecentDownload[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentDownload[];
    return Array.isArray(parsed) ? parsed.filter((r) => r?.url && r?.title).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

/** Stable snapshot for useSyncExternalStore; invalidated by pushRecent/storage events. */
export function getRecentSnapshot(): RecentDownload[] {
  snapshot ??= read();
  return snapshot;
}

export function subscribeRecents(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      snapshot = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export const EMPTY_RECENTS: RecentDownload[] = [];

export function pushRecent(entry: RecentDownload): void {
  try {
    const next = [entry, ...getRecentSnapshot().filter((r) => r.url !== entry.url)].slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
    snapshot = next;
    for (const l of listeners) l();
  } catch {
    /* storage unavailable — recents are a nicety, not a feature */
  }
}
