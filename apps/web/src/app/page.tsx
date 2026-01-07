/**
 * Landing Page
 * Author: NICE-DEV
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { platformIconsExtended, platformColors } from '@/components/PlatformIcons';
import AnnouncementBanner from '@/components/AnnouncementBanner';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const platforms = [
  { name: 'TikTok', slug: 'tiktok' },
  { name: 'YouTube', slug: 'youtube' },
  { name: 'Instagram', slug: 'instagram' },
  { name: 'Facebook', slug: 'facebook' },
  { name: 'Twitter/X', slug: 'twitter' },
  { name: 'Pinterest', slug: 'pinterest' },
  { name: 'Reddit', slug: 'reddit' },
  { name: 'LinkedIn', slug: 'linkedin' },
  { name: 'Snapchat', slug: 'snapchat' },
  { name: 'Threads', slug: 'threads' },
  { name: 'Spotify', slug: 'spotify' },
  { name: 'SoundCloud', slug: 'soundcloud' },
  { name: 'Dailymotion', slug: 'dailymotion' },
  { name: 'Tumblr', slug: 'tumblr' },
  { name: 'Bluesky', slug: 'bluesky' },
  { name: 'CapCut', slug: 'capcut' },
  { name: 'Douyin', slug: 'douyin' },
  { name: 'Kuaishou', slug: 'kuaishou' },
  { name: 'Terabox', slug: 'terabox' },
];

interface Rating {
  id: string;
  score: number;
  comment: string | null;
  createdAt: string;
  user: { name: string; avatar: string | null } | null;
}

interface RatingStats {
  average: number;
  total: number;
}

export default function HomePage() {
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [ratingStats, setRatingStats] = useState<RatingStats>({ average: 0, total: 0 });
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    setIsLoggedIn(!!token);

    fetch(`${API_URL}/ratings/public?limit=6`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setRatings(data.data.ratings);
          setRatingStats(data.data.stats);
        }
      })
      .catch(() => {});
  }, []);

  const renderStars = (score: number, size = 'h-4 w-4') => (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <svg
          key={star}
          className={`${size} ${star <= score ? 'text-yellow-400 fill-yellow-400' : 'text-neutral-300'}`}
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
          />
        </svg>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-neutral-200/80 bg-white/80 backdrop-blur-lg">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-2">
              <img src="/logo.png" alt="NICE-API'HUB" className="h-9 w-9 rounded-xl shadow-lg" />
              <span className="font-semibold text-lg text-neutral-900 hidden sm:block">NICE-API&apos;HUB</span>
            </div>
            
            {/* Desktop Nav */}
            <nav className="hidden md:flex items-center gap-6">
              <Link href="/docs" className="text-neutral-600 hover:text-neutral-900 text-sm font-medium transition-colors">
                Documentation
              </Link>
              <Link href="/pricing" className="text-neutral-600 hover:text-neutral-900 text-sm font-medium transition-colors">
                Tarifs
              </Link>
              {isLoggedIn ? (
                <Link 
                  href="/dashboard" 
                  className="rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 transition-colors"
                >
                  Dashboard
                </Link>
              ) : (
                <Link 
                  href="/login" 
                  className="rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 transition-colors"
                >
                  Commencer
                </Link>
              )}
            </nav>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg hover:bg-neutral-100"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>

          {/* Mobile Menu */}
          {mobileMenuOpen && (
            <div className="md:hidden py-4 border-t border-neutral-100">
              <div className="flex flex-col gap-2">
                <Link href="/docs" className="px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-50 rounded-lg" onClick={() => setMobileMenuOpen(false)}>
                  Documentation
                </Link>
                <Link href="/pricing" className="px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-50 rounded-lg" onClick={() => setMobileMenuOpen(false)}>
                  Tarifs
                </Link>
                {isLoggedIn ? (
                  <Link href="/dashboard" className="px-3 py-2 text-sm font-medium text-primary-600" onClick={() => setMobileMenuOpen(false)}>
                    Dashboard
                  </Link>
                ) : (
                  <Link href="/login" className="px-3 py-2 text-sm font-medium text-primary-600" onClick={() => setMobileMenuOpen(false)}>
                    Commencer
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Announcement Banner - Fixed below header */}
      <div className="pt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
          <AnnouncementBanner target="public" />
        </div>
      </div>

      {/* Hero */}
      <section className="pt-8 pb-12 sm:pt-16 sm:pb-20 lg:pt-24 lg:pb-32 overflow-hidden relative">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center max-w-4xl mx-auto">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary-50 px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-medium text-primary-700 mb-4 sm:mb-6">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary-500"></span>
              </span>
              +20 plateformes supportées
            </div>
            <h1 className="text-3xl sm:text-5xl lg:text-7xl font-bold tracking-tight text-neutral-900">
              Téléchargez des médias
              <span className="relative inline-block mt-1 sm:mt-2">
                <span className="relative z-10 bg-gradient-to-r from-primary-600 to-primary-400 bg-clip-text text-transparent">
                  en une seule API
                </span>
                <svg className="absolute -bottom-2 left-0 w-full h-4 sm:h-6" viewBox="0 0 400 20" preserveAspectRatio="none">
                  <path d="M0,10 Q100,5 200,12 T400,8" stroke="#3b82f6" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.3"/>
                </svg>
              </span>
            </h1>
            <p className="mx-auto mt-4 sm:mt-6 max-w-2xl text-base sm:text-lg text-neutral-600 leading-relaxed px-4 sm:px-0">
              Une API REST simple et puissante pour télécharger des vidéos, images et audio 
              depuis TikTok, YouTube, Instagram et bien plus encore.
            </p>
            
            {ratingStats.total > 0 && (
              <div className="mt-6 sm:mt-8 flex items-center justify-center gap-2 sm:gap-3">
                {renderStars(Math.round(ratingStats.average), 'h-4 w-4 sm:h-5 sm:w-5')}
                <span className="text-xs sm:text-sm font-semibold text-neutral-900">{ratingStats.average.toFixed(1)}</span>
                <span className="text-xs sm:text-sm text-neutral-500">• {ratingStats.total} avis</span>
              </div>
            )}

            <div className="mt-8 sm:mt-10 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 px-4 sm:px-0">
              <Link
                href="/login"
                className="w-full sm:w-auto rounded-xl bg-neutral-900 px-6 sm:px-8 py-3 sm:py-4 text-sm sm:text-base font-medium text-white hover:bg-neutral-800 transition-all hover:scale-105 shadow-lg shadow-neutral-900/20"
              >
                Commencer gratuitement
              </Link>
              <Link
                href="/docs"
                className="w-full sm:w-auto rounded-xl border-2 border-neutral-200 bg-white px-6 sm:px-8 py-3 sm:py-4 text-sm sm:text-base font-medium text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50 transition-all"
              >
                Voir la documentation
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Platforms Marquee */}
      <section className="py-12 bg-neutral-50 border-y border-neutral-200 overflow-hidden">
        <div className="mb-6 text-center">
          <p className="text-sm font-medium text-neutral-500 uppercase tracking-wider">Plateformes supportées</p>
        </div>
        
        {/* Marquee Container */}
        <div className="relative">
          {/* Gradient Overlays */}
          <div className="absolute left-0 top-0 bottom-0 w-32 bg-gradient-to-r from-neutral-50 to-transparent z-10 pointer-events-none" />
          <div className="absolute right-0 top-0 bottom-0 w-32 bg-gradient-to-l from-neutral-50 to-transparent z-10 pointer-events-none" />
          
          {/* First Row - Left to Right */}
          <div className="flex gap-4 mb-4 animate-marquee">
            {[...platforms, ...platforms].map((platform, i) => (
              <div
                key={`row1-${i}`}
                className="flex-shrink-0 flex items-center gap-3 rounded-full bg-white border border-neutral-200 px-5 py-3 shadow-sm hover:shadow-md hover:border-neutral-300 transition-all"
              >
                <span className={platformColors[platform.slug] || 'text-neutral-700'}>
                  {platformIconsExtended[platform.slug]}
                </span>
                <span className="font-medium text-neutral-700 whitespace-nowrap">{platform.name}</span>
              </div>
            ))}
          </div>
          
          {/* Second Row - Right to Left */}
          <div className="flex gap-4 animate-marquee-reverse">
            {[...platforms.slice().reverse(), ...platforms.slice().reverse()].map((platform, i) => (
              <div
                key={`row2-${i}`}
                className="flex-shrink-0 flex items-center gap-3 rounded-full bg-white border border-neutral-200 px-5 py-3 shadow-sm hover:shadow-md hover:border-neutral-300 transition-all"
              >
                <span className={platformColors[platform.slug] || 'text-neutral-700'}>
                  {platformIconsExtended[platform.slug]}
                </span>
                <span className="font-medium text-neutral-700 whitespace-nowrap">{platform.name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 relative">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-neutral-900">
              Pourquoi NICE-API&apos;HUB ?
            </h2>
            <p className="mt-4 text-lg text-neutral-600">Tout ce dont vous avez besoin pour intégrer le téléchargement de médias</p>
          </div>
          <div className="grid gap-8 md:grid-cols-3">
            <div className="group rounded-2xl border border-neutral-200 bg-white p-8 hover:border-primary-200 hover:shadow-xl hover:shadow-primary-500/5 transition-all relative">
              <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-neutral-900 relative inline-block">
                Ultra Rapide
                <svg className="absolute -bottom-1 left-0 w-20 h-2" viewBox="0 0 80 8" preserveAspectRatio="none">
                  <path d="M0,4 Q20,2 40,5 T80,3" stroke="#10b981" strokeWidth="2" fill="none" opacity="0.3"/>
                </svg>
              </h3>
              <p className="mt-3 text-neutral-600 leading-relaxed">
                Temps de réponse moyen inférieur à 2 secondes. Infrastructure optimisée pour la performance.
              </p>
            </div>
            <div className="group rounded-2xl border border-neutral-200 bg-white p-8 hover:border-primary-200 hover:shadow-xl hover:shadow-primary-500/5 transition-all relative">
              <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-neutral-900 relative inline-block">
                Sécurisé
                <svg className="absolute -bottom-1 left-0 w-16 h-2" viewBox="0 0 64 8" preserveAspectRatio="none">
                  <path d="M0,4 L64,4" stroke="#3b82f6" strokeWidth="2" strokeDasharray="4,2" opacity="0.3"/>
                </svg>
              </h3>
              <p className="mt-3 text-neutral-600 leading-relaxed">
                Clés API chiffrées, environnements séparés dev/prod, et rate limiting intelligent.
              </p>
            </div>
            <div className="group rounded-2xl border border-neutral-200 bg-white p-8 hover:border-primary-200 hover:shadow-xl hover:shadow-primary-500/5 transition-all relative">
              <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-neutral-900 relative inline-block">
                Analytics
                <svg className="absolute -bottom-1 left-0 w-24 h-2" viewBox="0 0 96 8" preserveAspectRatio="none">
                  <path d="M0,6 Q24,2 48,5 T96,4" stroke="#a855f7" strokeWidth="2" fill="none" opacity="0.3"/>
                </svg>
              </h3>
              <p className="mt-3 text-neutral-600 leading-relaxed">
                Dashboard complet avec suivi en temps réel de vos requêtes et performances.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Code Example */}
      <section className="py-24 bg-neutral-900 relative overflow-hidden">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold text-white relative inline-block">
                Intégration en 5 minutes
                <svg className="absolute -bottom-2 left-0 w-full h-3" viewBox="0 0 200 12" preserveAspectRatio="none">
                  <path d="M0,6 Q50,2 100,8 T200,5" stroke="#10b981" strokeWidth="2" fill="none" opacity="0.4"/>
                </svg>
              </h2>
              <p className="mt-4 text-lg text-neutral-400 leading-relaxed">
                Une seule ligne de code pour télécharger des médias depuis n&apos;importe quelle plateforme supportée.
              </p>
              <ul className="mt-8 space-y-4">
                {['Documentation complète', 'Exemples en 5 langages', 'Support réactif'].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-neutral-300">
                    <svg className="h-5 w-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl bg-neutral-950 p-6 shadow-2xl">
              <div className="flex items-center gap-2 mb-4">
                <div className="h-3 w-3 rounded-full bg-red-500" />
                <div className="h-3 w-3 rounded-full bg-yellow-500" />
                <div className="h-3 w-3 rounded-full bg-green-500" />
              </div>
              <pre className="text-sm text-neutral-300 overflow-x-auto">
                <code>{`// Installation
npm install axios

// Utilisation
const response = await axios.get(
  'https://api.nice-api-hub.com/api/tiktok/download',
  {
    params: { url: 'VIDEO_URL' },
    headers: { 
      'Authorization': \`Bearer \${API_KEY}\` 
    }
  }
);

console.log(response.data);
// { success: true, data: { downloads: [...] } }`}</code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-24 bg-neutral-50 relative">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-neutral-900">
              Ce que disent nos utilisateurs
            </h2>
            <div className="mt-4 flex items-center justify-center gap-3">
              {renderStars(5, 'h-6 w-6')}
              <span className="text-xl font-bold text-neutral-900">5.0</span>
              <span className="text-neutral-500">• {ratings.length > 0 ? ratingStats.total : 3} avis</span>
            </div>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {ratings.length > 0 ? (
              ratings.map((rating) => (
                <div key={rating.id} className="rounded-2xl border border-neutral-200 bg-white p-6 hover:shadow-lg transition-shadow">
                  <div className="flex items-center gap-3 mb-4">
                    {rating.user?.avatar ? (
                      <img src={rating.user.avatar} alt="" className="h-12 w-12 rounded-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="h-12 w-12 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center">
                        <span className="font-semibold text-white">
                          {rating.user?.name?.charAt(0) || 'U'}
                        </span>
                      </div>
                    )}
                    <div>
                      <p className="font-semibold text-neutral-900">{rating.user?.name || 'Utilisateur'}</p>
                      {renderStars(rating.score)}
                    </div>
                  </div>
                  {rating.comment && (
                    <p className="text-neutral-600 leading-relaxed">&ldquo;{rating.comment}&rdquo;</p>
                  )}
                </div>
              ))
            ) : (
              <>
                {/* Avis de démonstration */}
                <div className="rounded-2xl border border-neutral-200 bg-white p-6 hover:shadow-lg transition-shadow">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-12 w-12 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center">
                      <span className="font-semibold text-white">M</span>
                    </div>
                    <div>
                      <p className="font-semibold text-neutral-900">Marc Dubois</p>
                      {renderStars(5)}
                    </div>
                  </div>
                  <p className="text-neutral-600 leading-relaxed">
                    &ldquo;API incroyablement rapide et facile à intégrer. J&apos;ai pu mettre en place le téléchargement de vidéos TikTok dans mon app en moins de 30 minutes. Excellent travail !&rdquo;
                  </p>
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-white p-6 hover:shadow-lg transition-shadow">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-12 w-12 rounded-full bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center">
                      <span className="font-semibold text-white">S</span>
                    </div>
                    <div>
                      <p className="font-semibold text-neutral-900">Sophie Martin</p>
                      {renderStars(5)}
                    </div>
                  </div>
                  <p className="text-neutral-600 leading-relaxed">
                    &ldquo;La meilleure API de téléchargement que j&apos;ai testée. Support de nombreuses plateformes, documentation claire et tarifs très compétitifs. Je recommande vivement !&rdquo;
                  </p>
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-white p-6 hover:shadow-lg transition-shadow">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-12 w-12 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center">
                      <span className="font-semibold text-white">A</span>
                    </div>
                    <div>
                      <p className="font-semibold text-neutral-900">Ahmed Benali</p>
                      {renderStars(5)}
                    </div>
                  </div>
                  <p className="text-neutral-600 leading-relaxed">
                    &ldquo;Parfait pour mon projet de sauvegarde de contenus. L&apos;API est stable, les temps de réponse excellents et le système de clés dev/prod est très pratique.&rdquo;
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 relative overflow-hidden">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <h2 className="text-4xl font-bold text-neutral-900 relative inline-block">
            Prêt à commencer ?
            <svg className="absolute -bottom-3 left-0 w-full h-4" viewBox="0 0 300 16" preserveAspectRatio="none">
              <path d="M0,8 Q75,4 150,10 T300,6" stroke="#3b82f6" strokeWidth="3" fill="none" opacity="0.2"/>
            </svg>
          </h2>
          <p className="mt-4 text-lg text-neutral-600">
            Créez votre compte gratuitement et obtenez 100 requêtes par jour.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/login"
              className="w-full sm:w-auto rounded-xl bg-neutral-900 px-8 py-4 text-base font-medium text-white hover:bg-neutral-800 transition-all hover:scale-105 shadow-lg shadow-neutral-900/20"
            >
              Créer un compte gratuit
            </Link>
            <Link
              href="/pricing"
              className="w-full sm:w-auto rounded-xl border-2 border-neutral-200 bg-white px-8 py-4 text-base font-medium text-neutral-700 hover:border-neutral-300 transition-all"
            >
              Voir les tarifs
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-neutral-200 bg-white py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <img src="/logo.png" alt="NICE-API'HUB" className="h-8 w-8 rounded-lg" />
              <span className="text-sm text-neutral-600">NICE-API&apos;HUB by NICE-DEV</span>
            </div>
            <div className="flex items-center gap-6">
              <Link href="/docs" className="text-sm text-neutral-500 hover:text-neutral-700">Documentation</Link>
              <Link href="/pricing" className="text-sm text-neutral-500 hover:text-neutral-700">Tarifs</Link>
            </div>
            <p className="text-sm text-neutral-500">© 2025 NICE-DEV. Tous droits réservés.</p>
          </div>
        </div>
      </footer>

      {/* CSS for Marquee Animation */}
      <style jsx>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @keyframes marquee-reverse {
          0% { transform: translateX(-50%); }
          100% { transform: translateX(0); }
        }
        .animate-marquee {
          animation: marquee 30s linear infinite;
        }
        .animate-marquee-reverse {
          animation: marquee-reverse 30s linear infinite;
        }
        .animate-marquee:hover,
        .animate-marquee-reverse:hover {
          animation-play-state: paused;
        }
      `}</style>
    </div>
  );
}
