"use client";

import { useState } from "react";
import { Check, ClipboardPaste, Loader2, TriangleAlert } from "lucide-react";

import { detectPlatform } from "@/lib/platform-detect";
import { BrandIcon } from "@/components/site/brand-icon";

interface LinkComposerProps {
  onSubmit: (url: string) => void;
  busy: boolean;
  initialUrl?: string;
}

export function LinkComposer({ onSubmit, busy, initialUrl }: LinkComposerProps) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [pasted, setPasted] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (trimmed && !busy) onSubmit(trimmed);
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrl(text.trim());
        setPasted(true);
        setTimeout(() => setPasted(false), 1500);
      }
    } catch {
      /* clipboard permission denied — user can paste manually */
    }
  };

  const trimmed = url.trim();
  const detected = trimmed.length > 3 ? detectPlatform(trimmed) : null;
  const unknownHost =
    trimmed.length > 3 && !detected && /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);

  return (
    <form onSubmit={submit} className="w-full">
      <div className="group flex items-center gap-2 rounded-lg border border-edge bg-panel p-2 transition-colors focus-within:border-accent/60">
        <span className="ml-2 shrink-0 font-mono text-sm text-mint select-none">❯</span>
        <input
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a video or audio link…"
          aria-label="Media URL"
          className="h-11 min-w-0 flex-1 bg-transparent text-[15px] text-snow placeholder:text-fog/70 focus:outline-none"
        />
        <button
          type="button"
          onClick={paste}
          className="hidden h-10 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm text-fog transition-colors hover:bg-panel-2 hover:text-mist sm:flex"
          title="Paste from clipboard"
        >
          <ClipboardPaste className="size-4" />
          {pasted ? "Pasted" : "Paste"}
        </button>
        <button
          type="submit"
          disabled={busy || !url.trim()}
          className="flex h-10 shrink-0 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-ink transition-all hover:bg-[#79b8ff] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {busy ? "Resolving…" : "Resolve"}
        </button>
      </div>
      <div className="mt-3 flex min-h-5 items-center justify-center gap-2 px-1 text-xs">
        {detected ? (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-mint/30 bg-mint/10 px-2.5 py-1 text-mint">
            <BrandIcon platform={detected.id} className="size-3.5" />
            {detected.name}
            <Check className="size-3.5" />
          </span>
        ) : unknownHost ? (
          <span className="inline-flex items-center gap-1.5 text-amber">
            <TriangleAlert className="size-3.5" />
            unrecognized site — the gateway supports 10 platforms
          </span>
        ) : (
          <span className="text-fog">
            YouTube · TikTok · X · Instagram · Facebook · SoundCloud · LinkedIn · Pinterest · Dailymotion · Bluesky
          </span>
        )}
      </div>
    </form>
  );
}
