"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Download, Loader2 } from "lucide-react";

import type { DownloadLinkRequest } from "@/lib/nah-api";
import { pushRecent } from "@/lib/session-recents";

interface DownloadButtonProps {
  mediaUrl: string;
  mediaTitle: string;
  mediaPlatform: string;
  request: DownloadLinkRequest;
  choiceLabel: string;
  onError: (title: string, detail?: string, code?: string) => void;
}

type Phase = "idle" | "minting" | "started";

export function DownloadButton({
  mediaUrl,
  mediaTitle,
  mediaPlatform,
  request,
  choiceLabel,
  onError,
}: DownloadButtonProps) {
  const [phase, setPhase] = useState<Phase>("idle");

  const start = async () => {
    if (phase !== "idle") return;
    setPhase("minting");
    try {
      const res = await fetch("/api/media/download-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const body = (await res.json()) as { url?: string; code?: string; detail?: string };
      if (!res.ok || !body.url) {
        onError("Couldn't prepare the download", body.detail, body.code);
        setPhase("idle");
        return;
      }
      // Hand the signed URL to the browser: the gateway streams the bytes
      // straight to the device — nothing large passes through this page.
      const a = document.createElement("a");
      a.href = body.url;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();

      pushRecent({ url: mediaUrl, title: mediaTitle || "Untitled media", platform: mediaPlatform, at: Date.now() });
      setPhase("started");
      setTimeout(() => setPhase("idle"), 8000);
    } catch {
      onError("Couldn't reach the server", "Check your connection and try again.");
      setPhase("idle");
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
      <button
        type="button"
        onClick={start}
        disabled={phase !== "idle"}
        className="flex h-13 w-full items-center justify-center gap-2.5 rounded-lg bg-accent py-3.5 text-[15px] font-bold text-ink transition-all hover:bg-[#79b8ff] active:scale-[0.99] disabled:cursor-wait disabled:opacity-80"
      >
        {phase === "minting" ? (
          <Loader2 className="size-5 animate-spin" />
        ) : phase === "started" ? (
          <CheckCircle2 className="size-5" />
        ) : (
          <Download className="size-5" />
        )}
        {phase === "minting"
          ? "Preparing…"
          : phase === "started"
            ? "Download started"
            : `Download ${choiceLabel}`}
      </button>
      {phase === "started" ? (
        <p className="mt-2.5 text-center text-xs text-fog">
          The file is coming from the gateway directly — check your downloads.
        </p>
      ) : null}
    </motion.div>
  );
}
