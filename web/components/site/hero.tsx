"use client";

import { motion } from "framer-motion";

import { DownloaderShell } from "@/components/downloader/downloader-shell";
import { Reveal } from "./reveal";

export function Hero() {
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 pb-16 pt-12 sm:pt-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-center lg:gap-14">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <p className="font-mono text-xs text-fog">
          <span className="text-mint">$</span> nah --version
          <span className="ml-3 text-fog">{"// media downloader"}</span>
        </p>
        <h1 className="mt-4 text-4xl font-bold leading-[1.1] tracking-tight text-snow sm:text-5xl">
          paste a link.
          <br />
          <span className="text-accent">get the file.</span>
          <span className="nah-cursor" aria-hidden />
        </h1>
        <p className="mt-5 max-w-md text-sm leading-relaxed text-fog">
          Videos and audio from YouTube, TikTok, X, Instagram, Facebook,
          SoundCloud and more — resolved, remuxed and streamed straight to
          your device. No ads, no accounts, no tracking.
        </p>
        <Reveal delay={0.15}>
          <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-1.5 font-mono text-xs text-fog">
            <li><span className="text-accent">·</span> zero logs</li>
            <li><span className="text-accent">·</span> open source</li>
            <li><span className="text-accent">·</span> self-hostable</li>
            <li><span className="text-accent">·</span> phone + desktop</li>
          </ul>
        </Reveal>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="w-full"
      >
        {/* terminal chrome around the tool — same metaphor as the TUI */}
        <div className="overflow-hidden rounded-lg border border-edge bg-term shadow-[0_16px_40px_rgba(0,0,0,0.4)]">
          <div className="flex items-center gap-2 border-b border-edge-soft px-4 py-2.5">
            <span className="size-2.5 rounded-full bg-[#ff5f57]" />
            <span className="size-2.5 rounded-full bg-[#febc2e]" />
            <span className="size-2.5 rounded-full bg-[#28c840]" />
            <span className="ml-3 font-mono text-[11px] text-fog">nah — downloader</span>
          </div>
          <div className="p-4 sm:p-5">
            <DownloaderShell />
          </div>
        </div>
        <p className="mt-3 px-1 font-mono text-[11px] text-fog/70">
          <span className="text-mint">$</span> files stream gateway → device · nothing stored
        </p>
      </motion.div>
    </div>
  );
}
