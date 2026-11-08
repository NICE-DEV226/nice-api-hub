"use client";

import { motion } from "framer-motion";
import { Check, Music2, Video } from "lucide-react";
import { clsx } from "clsx";

import type { FormatChoice } from "@/lib/format-options";

interface FormatSelectorProps {
  choices: FormatChoice[];
  selected: number;
  onSelect: (index: number) => void;
}

export function FormatSelector({ choices, selected, onSelect }: FormatSelectorProps) {
  const videos = choices.filter((c) => c.kind === "video");
  const audios = choices.filter((c) => c.kind === "audio");

  const renderChip = (choice: FormatChoice, index: number) => {
    const active = index === selected;
    return (
      <button
        key={`${choice.kind}-${choice.title}-${choice.audioFormat ?? ""}`}
        type="button"
        role="radio"
        aria-checked={active}
        onClick={() => onSelect(index)}
        className={clsx(
          "relative flex min-h-14 min-w-20 flex-col items-center justify-center gap-0.5 rounded-xl border px-3 py-2 transition-all",
          active
            ? "border-accent bg-accent-soft text-snow"
            : "border-edge bg-panel-2 text-mist hover:border-fog/50 hover:text-snow",
        )}
      >
        {active ? (
          <Check className="absolute right-1.5 top-1.5 size-3.5 text-accent" />
        ) : null}
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          {choice.kind === "audio" ? <Music2 className="size-3.5" /> : <Video className="size-3.5" />}
          {choice.title}
        </span>
        {choice.detail ? (
          <span className="max-w-full truncate text-[11px] text-fog">{choice.detail}</span>
        ) : null}
        {choice.badge ? (
          <span className="text-[10px] font-medium text-amber">{choice.badge}</span>
        ) : null}
      </button>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 }}
      className="w-full rounded-2xl border border-edge bg-panel p-4"
      role="radiogroup"
      aria-label="Choose a format"
    >
      <p className="mb-3 font-mono text-[11px] uppercase tracking-widest text-fog">Format</p>
      {videos.length > 0 ? (
        <div className="flex flex-wrap gap-2">{videos.map((c) => renderChip(c, choices.indexOf(c)))}</div>
      ) : null}
      {audios.length > 0 ? (
        <>
          <p className="mb-2 mt-4 font-mono text-[11px] uppercase tracking-widest text-fog">Audio</p>
          <div className="flex flex-wrap gap-2">{audios.map((c) => renderChip(c, choices.indexOf(c)))}</div>
        </>
      ) : null}
    </motion.div>
  );
}
