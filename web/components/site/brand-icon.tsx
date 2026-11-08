import { Briefcase } from "lucide-react";
import {
  siBluesky,
  siDailymotion,
  siFacebook,
  siGithub,
  siInstagram,
  siPinterest,
  siSoundcloud,
  siTiktok,
  siX,
  siYoutube,
  type SimpleIcon,
} from "simple-icons";

const ICONS: Record<string, SimpleIcon> = {
  youtube: siYoutube,
  tiktok: siTiktok,
  twitter: siX,
  x: siX,
  instagram: siInstagram,
  facebook: siFacebook,
  soundcloud: siSoundcloud,
  pinterest: siPinterest,
  dailymotion: siDailymotion,
  bluesky: siBluesky,
  github: siGithub,
};

/** Brands without a simple-icons glyph get a neutral lucide stand-in. */
const FALLBACKS: Record<string, typeof Briefcase> = {
  linkedin: Briefcase,
};

export function platformIcon(platform: string): SimpleIcon | null {
  return ICONS[platform.toLowerCase()] ?? null;
}

/** Brand glyph rendered from simple-icons path data (real brand logos). */
export function BrandIcon({ platform, className }: { platform: string; className?: string }) {
  const key = platform.toLowerCase();
  const icon = ICONS[key];
  if (icon) {
    return (
      <svg viewBox="0 0 24 24" fill={`#${icon.hex}`} className={className} aria-hidden="true">
        <path d={icon.path} />
      </svg>
    );
  }
  const Fallback = FALLBACKS[key];
  if (Fallback) return <Fallback className={className} aria-hidden="true" />;
  return null;
}
