import { BrandIcon } from "./brand-icon";
import { Reveal } from "./reveal";

const PLATFORMS = [
  { id: "youtube", name: "YouTube", note: "video + audio, up to 4K" },
  { id: "tiktok", name: "TikTok", note: "video, no watermark" },
  { id: "twitter", name: "X / Twitter", note: "video + GIFs" },
  { id: "instagram", name: "Instagram", note: "reels, posts, stories*" },
  { id: "facebook", name: "Facebook", note: "public videos" },
  { id: "soundcloud", name: "SoundCloud", note: "audio tracks" },
  { id: "linkedin", name: "LinkedIn", note: "public posts" },
  { id: "pinterest", name: "Pinterest", note: "video pins" },
  { id: "dailymotion", name: "Dailymotion", note: "video" },
  { id: "bluesky", name: "Bluesky", note: "video + images" },
];

export function PlatformGrid() {
  return (
    <section id="platforms" className="mx-auto w-full max-w-5xl scroll-mt-20 px-4 py-16">
      <Reveal>
        <p className="text-center font-mono text-xs text-fog">
          <span className="text-mint">$</span> nah platforms --list
        </p>
        <h2 className="mt-3 text-center text-2xl font-bold tracking-tight text-snow sm:text-3xl">
          If it&apos;s public, it&apos;s probably here.
        </h2>
      </Reveal>
      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {PLATFORMS.map((p, i) => (
          <Reveal key={p.id} delay={i * 0.04}>
            <div className="group flex h-full items-center gap-3 rounded-md border border-edge bg-panel p-3.5 transition-all hover:border-accent/40 hover:bg-panel-2">
              <BrandIcon platform={p.id} className="size-6 shrink-0" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-snow">{p.name}</p>
                <p className="truncate text-[11px] text-fog">{p.note}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal delay={0.1}>
        <p className="mt-4 text-center text-xs text-fog/70">
          * Availability depends on the platform — private or members-only content can&apos;t be fetched.
        </p>
      </Reveal>
    </section>
  );
}
