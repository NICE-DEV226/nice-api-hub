import { FileDown, MousePointerClick, SlidersHorizontal } from "lucide-react";
import { Reveal } from "./reveal";

const STEPS = [
  {
    icon: MousePointerClick,
    title: "Paste the link",
    text: "Copy any public video or audio URL — from your phone or your desktop.",
  },
  {
    icon: SlidersHorizontal,
    title: "Pick a format",
    text: "Choose the quality or audio format. The gateway merges and remuxes for you.",
  },
  {
    icon: FileDown,
    title: "Download directly",
    text: "The file streams straight from the server to your device — no ads, no redirects.",
  },
];

const PILLARS = [
  { label: "No ads", hint: "ever" },
  { label: "No accounts", hint: "just paste & go" },
  { label: "No tracking", hint: "zero logs policy" },
  { label: "Open source", hint: "self-hostable" },
];

export function HowItWorks() {
  return (
    <section id="how" className="border-y border-edge-soft/60 bg-panel/40">
      <div className="mx-auto w-full max-w-5xl scroll-mt-20 px-4 py-16">
        <Reveal>
          <p className="text-center font-mono text-[11px] uppercase tracking-[0.25em] text-accent">
            How it works
          </p>
          <h2 className="mt-2 text-center text-2xl font-bold tracking-tight text-snow sm:text-3xl">
            Three steps. That&apos;s the whole app.
          </h2>
        </Reveal>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.title} delay={i * 0.08}>
              <div className="relative h-full rounded-2xl border border-edge bg-panel p-5">
                <span className="absolute right-4 top-4 font-mono text-xs text-fog/50">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <s.icon className="size-6 text-accent" />
                <h3 className="mt-3 font-semibold text-snow">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-fog">{s.text}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.15}>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
            {PILLARS.map((p) => (
              <span
                key={p.label}
                className="inline-flex items-baseline gap-1.5 rounded-full border border-edge bg-panel px-3.5 py-1.5 text-sm"
              >
                <span className="font-medium text-snow">{p.label}</span>
                <span className="text-xs text-fog">{p.hint}</span>
              </span>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
