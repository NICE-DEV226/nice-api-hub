"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";

import { listRecents, type RecentDownload } from "@/lib/session-recents";

interface SessionHistoryProps {
  onPick: (url: string) => void;
}

function timeAgo(at: number): string {
  const s = Math.floor((Date.now() - at) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Session-local recent downloads (localStorage only — nothing leaves the device). */
export function SessionHistory({ onPick }: SessionHistoryProps) {
  const [items, setItems] = useState<RecentDownload[]>([]);

  useEffect(() => {
    setItems(listRecents());
  }, []);

  if (items.length === 0) return null;

  return (
    <section className="w-full" aria-label="Recent downloads">
      <h3 className="mb-2 flex items-center gap-1.5 px-1 font-mono text-[11px] uppercase tracking-widest text-fog">
        <History className="size-3.5" />
        Recent on this device
      </h3>
      <ul className="divide-y divide-edge-soft overflow-hidden rounded-2xl border border-edge bg-panel">
        {items.map((item) => (
          <li key={item.url}>
            <button
              type="button"
              onClick={() => onPick(item.url)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-panel-2"
            >
              <span className="shrink-0 rounded-md border border-edge bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] uppercase text-fog">
                {item.platform}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-mist">{item.title}</span>
              <span className="shrink-0 text-xs text-fog/70">{timeAgo(item.at)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
