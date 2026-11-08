import { FaqSection } from "@/components/site/faq-section";
import { Hero } from "@/components/site/hero";
import { HowItWorks } from "@/components/site/how-it-works";
import { NavBar } from "@/components/site/nav-bar";
import { PlatformGrid } from "@/components/site/platform-grid";
import { SiteFooter } from "@/components/site/site-footer";

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col">
      <NavBar />
      <main className="flex-1">
        <section className="relative overflow-hidden">
          <Hero />
        </section>
        <PlatformGrid />
        <HowItWorks />
        <FaqSection />
      </main>
      <SiteFooter />
    </div>
  );
}
