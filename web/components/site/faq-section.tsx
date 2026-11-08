"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { clsx } from "clsx";

import { Reveal } from "./reveal";

const FAQS = [
  {
    q: "Is nah really free?",
    a: "Yes — no accounts, no paywalls, no ads. The gateway is open source and the web app is a thin client over it. You can also self-host the whole stack (API + this site) with Docker.",
  },
  {
    q: "Why can't I download private or members-only videos?",
    a: "The gateway only fetches publicly accessible content. Private videos, age-restricted posts behind login, and subscription-only media aren't reachable — same limitation as every downloader.",
  },
  {
    q: "Do you store my downloads or links?",
    a: "No. Requests are processed in memory and streamed straight to your device; nothing is cached or logged per-user. Recent downloads on this page live in your browser's localStorage only.",
  },
  {
    q: "Which formats can I get?",
    a: "Whatever the source offers: up to 4K video where available, MP3 audio extraction, and the original audio format. Separate video+audio tracks are merged automatically (e.g. YouTube).",
  },
  {
    q: "Is it legal to download videos?",
    a: "nah is a tool, not legal advice. Only download content you own or are authorized to save, and respect each platform's terms of service and copyright rules.",
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-edge bg-panel">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
      >
        <span className="text-sm font-semibold text-snow">{q}</span>
        <ChevronDown
          className={clsx("size-4 shrink-0 text-fog transition-transform", open && "rotate-180 text-accent")}
        />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <p className="px-5 pb-4 text-sm leading-relaxed text-fog">{a}</p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function FaqSection() {
  return (
    <section id="faq" className="mx-auto w-full max-w-3xl scroll-mt-20 px-4 py-16">
      <Reveal>
        <p className="text-center font-mono text-[11px] uppercase tracking-[0.25em] text-accent">FAQ</p>
        <h2 className="mt-2 text-center text-2xl font-bold tracking-tight text-snow sm:text-3xl">
          Fair questions.
        </h2>
      </Reveal>
      <div className="mt-8 flex flex-col gap-3">
        {FAQS.map((f, i) => (
          <Reveal key={f.q} delay={i * 0.05}>
            <FaqItem q={f.q} a={f.a} />
          </Reveal>
        ))}
      </div>
    </section>
  );
}
