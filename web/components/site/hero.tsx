"use client";

import { motion } from "framer-motion";
import { ShieldCheck, Sparkles } from "lucide-react";

import { DownloaderShell } from "@/components/downloader/downloader-shell";
import { Reveal } from "./reveal";

export function Hero() {
  return (
    <div className="relative mx-auto flex w-full max-w-3xl flex-col items-center px-4 pb-20 pt-14 sm:pt-20">
      {/* ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px]"
        style={{
          background:
            "radial-gradient(600px 300px at 50% 0%, rgba(88,166,255,0.14), transparent 65%), radial-gradient(400px 240px at 80% 10%, rgba(63,185,80,0.06), transparent 60%)",
        }}
      />
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex flex-col items-center text-center"
      >
        <span className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-panel px-3 py-1 text-xs text-fog">
          <Sparkles className="size-3.5 text-accent" />
          open source · free forever · no ads
        </span>
        <h1 className="mt-6 text-4xl font-extrabold leading-[1.05] tracking-tight text-snow sm:text-6xl">
          Save what you
          <br />
          <span className="bg-gradient-to-r from-accent via-[#79b8ff] to-mint bg-clip-text text-transparent">
            love.
          </span>
        </h1>
        <p className="mt-4 max-w-lg text-base leading-relaxed text-fog sm:text-lg">
          Videos and audio from YouTube, TikTok, X, Instagram and more —
          paste the link, pick a format, download. Works on phone and desktop.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="mt-10 w-full max-w-2xl rounded-3xl border border-edge bg-panel/70 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-sm sm:p-5"
      >
        <DownloaderShell />
      </motion.div>

      <Reveal delay={0.1} className="mt-6">
        <p className="flex items-center gap-1.5 text-xs text-fog/70">
          <ShieldCheck className="size-3.5 text-mint" />
          Files stream straight from the gateway — nothing is stored or cached.
        </p>
      </Reveal>
    </div>
  );
}
