"use client";

import { motion } from "framer-motion";

/** Animated placeholder shown while the gateway resolves the media. */
export function ResolvingState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full rounded-lg border border-edge bg-panel p-5"
      role="status"
      aria-live="polite"
    >
      <div className="flex gap-4">
        <div className="size-28 shrink-0 animate-pulse rounded-md bg-panel-2 sm:size-36" />
        <div className="flex min-w-0 flex-1 flex-col gap-3 py-1">
          <div className="h-4 w-3/4 animate-pulse rounded bg-panel-2" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-panel-2" />
          <div className="h-3 w-2/5 animate-pulse rounded bg-panel-2" />
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {["360p", "720p", "1080p", "MP3"].map((f) => (
          <div key={f} className="h-9 w-20 animate-pulse rounded-lg bg-panel-2" />
        ))}
      </div>
      <p className="mt-4 font-mono text-xs text-fog">
        <span className="mr-2 inline-block size-1.5 animate-pulse rounded-full bg-accent align-middle" />
        contacting providers…
      </p>
    </motion.div>
  );
}
