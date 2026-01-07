/**
 * Announcement Banner Component
 * Author: NICE-DEV
 */

'use client';

import { useEffect, useState } from 'react';
import { X, Megaphone } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface Announcement {
  id: string;
  title: string;
  message: string;
  type: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR' | 'PROMO';
  dismissible: boolean;
  isPinned: boolean;
}

interface Props {
  target: 'public' | 'users';
}

export default function AnnouncementBanner({ target }: Props) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    const stored = localStorage.getItem('dismissedAnnouncements');
    if (stored) {
      try {
        setDismissed(new Set(JSON.parse(stored)));
      } catch {}
    }

    fetch(`${API_URL}/announcements/active?target=${target}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setAnnouncements(data.data.announcements);
        }
      })
      .catch(() => {});
  }, [target]);

  const dismissAnnouncement = (id: string) => {
    const newDismissed = new Set(dismissed);
    newDismissed.add(id);
    setDismissed(newDismissed);
    localStorage.setItem('dismissedAnnouncements', JSON.stringify([...newDismissed]));
  };

  const visibleAnnouncements = announcements.filter((a) => !dismissed.has(a.id));

  if (visibleAnnouncements.length === 0) return null;

  return (
    <div className="space-y-4">
      {visibleAnnouncements.map((announcement) => (
        <div
          key={announcement.id}
          className="relative bg-neutral-900 rounded-2xl overflow-hidden"
        >
          {/* Accent bar */}
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-gradient-to-b from-orange-500 to-orange-600" />
          
          {/* Content */}
          <div className="flex items-start gap-4 px-6 py-5 sm:px-8 sm:py-6">
            {/* Icon */}
            <div className="flex-shrink-0 h-12 w-12 rounded-xl bg-orange-500/10 flex items-center justify-center">
              <Megaphone className="h-6 w-6 text-orange-500" />
            </div>

            {/* Text */}
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-white text-xl sm:text-2xl leading-tight">
                {announcement.title}
              </h3>
              <p className="text-neutral-300 text-base sm:text-lg mt-2 leading-relaxed">
                {announcement.message}
              </p>
            </div>

            {/* Dismiss button */}
            {announcement.dismissible && (
              <button
                onClick={() => dismissAnnouncement(announcement.id)}
                className="flex-shrink-0 p-2 rounded-lg hover:bg-white/10 transition-colors"
                aria-label="Fermer"
              >
                <X className="h-6 w-6 text-neutral-500 hover:text-white" />
              </button>
            )}
          </div>

          {/* Pinned badge */}
          {announcement.isPinned && (
            <div className="absolute top-3 right-14 bg-orange-500 text-white text-xs font-bold px-2 py-1 rounded">
              IMPORTANT
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
