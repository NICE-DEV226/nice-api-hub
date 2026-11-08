import Link from "next/link";
import { Terminal } from "lucide-react";

import { BrandIcon } from "./brand-icon";

const LINKS = [
  { href: "#platforms", label: "Platforms" },
  { href: "#how", label: "How it works" },
  { href: "#faq", label: "FAQ" },
];

export function NavBar() {
  return (
    <header className="sticky top-0 z-40 border-b border-edge-soft/60 bg-ink">
      <nav className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-mono text-sm font-bold tracking-[0.25em] text-accent">
          <Terminal className="size-4" />
          nah
        </Link>
        <div className="flex items-center gap-1 sm:gap-2">
          <div className="hidden items-center gap-1 sm:flex">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="rounded-lg px-3 py-1.5 text-sm text-fog transition-colors hover:bg-panel-2 hover:text-snow"
              >
                {l.label}
              </a>
            ))}
          </div>
          <a
            href="https://github.com/NICE-DEV226/nice-api-hub"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1 flex items-center gap-1.5 rounded-lg border border-edge bg-panel px-3 py-1.5 text-sm text-mist transition-colors hover:border-accent/50 hover:text-snow"
          >
            <BrandIcon platform="github" className="size-4" />
            <span className="hidden sm:inline">GitHub</span>
          </a>
        </div>
      </nav>
    </header>
  );
}
