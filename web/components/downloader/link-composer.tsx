"use client";

import { useState } from "react";
import { ClipboardPaste, Link2, Loader2 } from "lucide-react";

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

  return (
    <form onSubmit={submit} className="w-full">
      <div className="group flex items-center gap-2 rounded-2xl border border-edge bg-panel p-2 shadow-[0_8px_30px_rgba(0,0,0,0.35)] transition-colors focus-within:border-accent/60">
        <Link2 className="ml-2 size-5 shrink-0 text-fog transition-colors group-focus-within:text-accent" />
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
          className="hidden h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm text-fog transition-colors hover:bg-panel-2 hover:text-mist sm:flex"
          title="Paste from clipboard"
        >
          <ClipboardPaste className="size-4" />
          {pasted ? "Pasted" : "Paste"}
        </button>
        <button
          type="submit"
          disabled={busy || !url.trim()}
          className="flex h-10 shrink-0 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-ink transition-all hover:bg-[#79b8ff] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {busy ? "Resolving…" : "Resolve"}
        </button>
      </div>
      <p className="mt-3 px-1 text-center text-xs text-fog">
        YouTube · TikTok · X · Instagram · Facebook · SoundCloud · LinkedIn · Pinterest · Dailymotion · Bluesky
      </p>
    </form>
  );
}
