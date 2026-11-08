import Link from "next/link";
import { Terminal } from "lucide-react";

import { BrandIcon } from "./brand-icon";

export function SiteFooter() {
  return (
    <footer className="border-t border-edge-soft/60">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-4 px-4 py-8 sm:flex-row sm:justify-between">
        <Link href="/" className="flex items-center gap-2 font-mono text-xs font-bold tracking-[0.25em] text-fog">
          <Terminal className="size-3.5" />
          nah
        </Link>
        <p className="max-w-md text-center text-xs leading-relaxed text-fog/70 sm:text-left">
          Only download content you have the right to save. nah streams through your own
          gateway — no accounts, no tracking, no ads.
        </p>
        <a
          href="https://github.com/NICE-DEV226/nice-api-hub"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-fog transition-colors hover:text-snow"
        >
          <BrandIcon platform="github" className="size-3.5" />
          Open source
        </a>
      </div>
    </footer>
  );
}
