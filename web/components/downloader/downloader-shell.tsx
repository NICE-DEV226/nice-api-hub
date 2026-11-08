"use client";

import { useCallback, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import type { DownloadLinkRequest } from "@/lib/nah-api";
import { buildFormatChoices, type FormatChoice } from "@/lib/format-options";
import type { MediaResult } from "@/lib/media-types";
import { DownloadButton } from "./download-button";
import { ErrorPanel, errorHint } from "./error-panel";
import { FormatSelector } from "./format-selector";
import { LinkComposer } from "./link-composer";
import { MediaSummaryCard } from "./media-summary-card";
import { ResolvingState } from "./resolving-state";
import { SessionHistory } from "./session-history";

type Stage = "idle" | "resolving" | "ready" | "error";

interface Failure {
  title: string;
  detail?: string;
  code?: string;
}

export function DownloaderShell() {
  const [stage, setStage] = useState<Stage>("idle");
  const [url, setUrl] = useState("");
  const [media, setMedia] = useState<MediaResult | null>(null);
  const [choices, setChoices] = useState<FormatChoice[]>([]);
  const [selected, setSelected] = useState(0);
  const [failure, setFailure] = useState<Failure | null>(null);

  const resolve = useCallback(async (target: string) => {
    setUrl(target);
    setStage("resolving");
    setFailure(null);
    try {
      const res = await fetch("/api/media/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: target }),
      });
      const body = (await res.json()) as { data?: MediaResult; code?: string; detail?: string };
      if (!res.ok || !body.data) {
        const hint = errorHint(body.code);
        setFailure({
          title: res.status === 429 ? "Slow down" : "Couldn't resolve that link",
          detail: hint ?? body.detail,
          code: body.code,
        });
        setStage("error");
        return;
      }
      const media = body.data;
      const options = buildFormatChoices(media);
      if (options.length === 0) {
        setFailure({
          title: "Nothing downloadable here",
          detail: "This link resolved, but no usable video or audio format was found.",
          code: "no_such_media",
        });
        setStage("error");
        return;
      }
      setMedia(media);
      setChoices(options);
      setSelected(0);
      setStage("ready");
    } catch {
      setFailure({ title: "Network error", detail: "Check your connection and try again." });
      setStage("error");
    }
  }, []);

  const choice = stage === "ready" ? choices[selected] : undefined;
  const downloadRequest: DownloadLinkRequest | null =
    media && choice
      ? {
          url: media.sourceUrl || url,
          kind: choice.kind,
          ...(choice.maxHeight ? { maxHeight: choice.maxHeight } : {}),
          ...(choice.audioFormat ? { audioFormat: choice.audioFormat } : {}),
        }
      : null;

  return (
    <div className="flex w-full flex-col gap-4">
      <LinkComposer onSubmit={resolve} busy={stage === "resolving"} />

      <AnimatePresence mode="wait">
        {stage === "resolving" ? <ResolvingState key="resolving" /> : null}

        {stage === "error" && failure ? (
          <ErrorPanel
            key="error"
            title={failure.title}
            detail={failure.detail}
            onRetry={url ? () => resolve(url) : undefined}
          />
        ) : null}

        {stage === "ready" && media ? (
          <motion.div
            key="result"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col gap-4"
          >
            <MediaSummaryCard media={media} />
            <FormatSelector choices={choices} selected={selected} onSelect={setSelected} />
            {downloadRequest && choice ? (
              <DownloadButton
                mediaUrl={media.sourceUrl || url}
                mediaTitle={media.title ?? "Untitled media"}
                mediaPlatform={media.platform}
                request={downloadRequest}
                choiceLabel={choice.title}
                onError={(title, detail, code) => setFailure({ title, detail, code })}
              />
            ) : null}
            {failure ? <ErrorPanel title={failure.title} detail={failure.detail} /> : null}
          </motion.div>
        ) : null}
      </AnimatePresence>

      {stage !== "resolving" ? <SessionHistory onPick={resolve} /> : null}
    </div>
  );
}
