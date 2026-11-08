"use client";

import { motion } from "framer-motion";
import { Clock3, User } from "lucide-react";

import type { MediaResult } from "@/lib/media-types";

function fmtDuration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export function MediaSummaryCard({ media }: { media: MediaResult }) {
  const duration = fmtDuration(media.durationSeconds);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-4 rounded-lg border border-edge bg-panel p-4"
    >
      <div className="relative size-28 shrink-0 overflow-hidden rounded-md bg-panel-2 sm:size-36">
        {media.thumbnail ? (
          // Thumbnails come from arbitrary CDNs; next/image remotePatterns would need a wildcard.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={media.thumbnail}
            alt=""
            className="size-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex size-full items-center justify-center font-mono text-xs text-fog">
            {media.platform}
          </div>
        )}
        {duration ? (
          <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[11px] text-snow">
            {duration}
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
        <span className="inline-flex w-fit items-center rounded-md border border-edge bg-panel-2 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide text-accent">
          {media.platform}
        </span>
        <h2 className="line-clamp-2 text-[15px] font-semibold leading-snug text-snow">
          {media.title ?? "Untitled media"}
        </h2>
        {media.author ? (
          <p className="flex items-center gap-1.5 truncate text-sm text-fog">
            <User className="size-3.5 shrink-0" />
            {media.author}
          </p>
        ) : null}
        <p className="flex items-center gap-1.5 text-xs text-fog/80">
          <Clock3 className="size-3.5" />
          {media.variants.length} format{media.variants.length === 1 ? "" : "s"} available
        </p>
      </div>
    </motion.div>
  );
}
