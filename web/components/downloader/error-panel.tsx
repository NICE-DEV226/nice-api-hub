"use client";

import { motion } from "framer-motion";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface ErrorPanelProps {
  title: string;
  detail?: string;
  onRetry?: () => void;
}

/** Human-friendly mapping of gateway error codes to actionable messages. */
const HINTS: Record<string, string> = {
  content_unavailable: "The media is private, removed, or has no downloadable video.",
  blocked_url: "That link points somewhere the downloader isn't allowed to go.",
  rate_limited: "Too many requests — wait a moment and try again.",
  daily_quota: "The daily download quota has been reached.",
  no_such_media: "None of the available formats match that request.",
  upstream_unavailable: "The source platform didn't answer. Try again in a few seconds.",
  not_configured: "The downloader backend isn't configured yet.",
};

export function errorHint(code?: string): string | undefined {
  return code ? HINTS[code] : undefined;
}

export function ErrorPanel({ title, detail, onRetry }: ErrorPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full rounded-2xl border border-rose/30 bg-panel p-5"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-rose" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-snow">{title}</p>
          {detail ? <p className="mt-1 text-sm leading-relaxed text-fog">{detail}</p> : null}
          {onRetry ? (
            <button
              onClick={onRetry}
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl border border-edge bg-panel-2 px-4 text-sm font-medium text-mist transition-colors hover:border-accent/50 hover:text-snow"
            >
              <RotateCcw className="size-4" />
              Try again
            </button>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}
