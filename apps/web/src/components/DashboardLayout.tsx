/**
 * Dashboard Layout with Sidebar
 * Author: NICE-DEV
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import FeedbackModal from './FeedbackModal';
import RatingModal from './RatingModal';
import AnnouncementBanner from './AnnouncementBanner';

interface User {
  id: string;
  email: string;
  name: string | null;
  avatar: string | null;
  plan: string;
  role: string;
  isActive: boolean;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: 'home' },
  { name: 'Clés API', href: '/api-keys', icon: 'key' },
  { name: 'Documentation', href: '/docs', icon: 'doc' },
  { name: 'Tarifs', href: '/pricing', icon: 'pricing' },
];

const icons: Record<string, JSX.Element> = {
  home: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />,
  key: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />,
  doc: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
  pricing: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
  admin: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />,
};

interface Props {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      router.push('/login');
      return;
    }

    // D'abord vérifier le statut du compte (permet les comptes suspendus)
    fetch(`${API_URL}/user/status`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((res) => {
        if (res.success && res.data?.user) {
          const userData = res.data.user;
          
          // Vérifier si le compte est suspendu
          if (res.data.isSuspended || userData.isActive === false) {
            localStorage.setItem('userEmail', userData.email);
            router.push('/suspended');
            return;
          }
          
          setUser(userData);
        } else if (res.error?.code === 'ACCOUNT_SUSPENDED') {
          router.push('/suspended');
          return;
        } else {
          // Token invalide ou expiré
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          router.push('/login');
        }
      })
      .catch((err) => {
        console.error(err);
        router.push('/login');
      })
      .finally(() => setLoading(false));
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    router.push('/');
  };

  // Fermer la sidebar quand on change de page sur mobile
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50">
        <div className="text-center">
          <img src="/logo.png" alt="NICE-API'HUB" className="h-10 w-10 mx-auto rounded-lg animate-pulse" />
          <p className="mt-3 text-neutral-500">Chargement...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 lg:flex">
      {/* Mobile Header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b border-neutral-200 flex items-center justify-between px-4 z-40">
        <Link href="/" className="flex items-center gap-2">
          <img src="/logo.png" alt="NICE-API'HUB" className="h-8 w-8 rounded-lg" />
          <span className="font-semibold text-neutral-900">NICE-API&apos;HUB</span>
        </Link>
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-2 rounded-lg hover:bg-neutral-100"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {sidebarOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </header>

      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div 
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 w-64 bg-white border-r border-neutral-200 flex flex-col z-50
        transform transition-transform duration-200 ease-in-out
        lg:translate-x-0 lg:static lg:z-30
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Logo */}
        <div className="h-16 flex items-center px-6 border-b border-neutral-100">
          <Link href="/" className="flex items-center gap-2">
            <img src="/logo.png" alt="NICE-API'HUB" className="h-8 w-8 rounded-lg" />
            <span className="font-semibold text-neutral-900">NICE-API&apos;HUB</span>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-6 space-y-1">
          {navigation.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900'
                }`}
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  {icons[item.icon]}
                </svg>
                {item.name}
              </Link>
            );
          })}
          
          {user?.role === 'ADMIN' && (
            <Link
              href="/admin"
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                pathname?.startsWith('/admin')
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900'
              }`}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {icons.admin}
              </svg>
              Administration
            </Link>
          )}

          {/* Divider */}
          <div className="pt-4 mt-4 border-t border-neutral-100">
            <p className="px-3 text-xs font-medium text-neutral-400 uppercase mb-2">Feedback</p>
            <button
              onClick={() => setShowFeedback(true)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 transition-colors"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              Envoyer un feedback
            </button>
            <button
              onClick={() => setShowRating(true)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 transition-colors"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
              Donner un avis
            </button>
          </div>
        </nav>

        {/* Upgrade Card */}
        {user?.plan === 'FREE' && (
          <div className="px-4 pb-4">
            <div className="rounded-xl bg-gradient-to-br from-primary-600 to-primary-700 p-4 text-white">
              <p className="font-medium">Passez à Pro</p>
              <p className="mt-1 text-sm text-primary-100">Débloquez plus de requêtes.</p>
              <Link
                href="/pricing"
                className="mt-3 block w-full rounded-lg bg-white px-3 py-2 text-sm font-medium text-primary-700 hover:bg-primary-50 transition-colors text-center"
              >
                Voir les plans
              </Link>
            </div>
          </div>
        )}

        {/* User Profile */}
        <div className="border-t border-neutral-100 p-4">
          <div className="flex items-center gap-3">
            {user?.avatar ? (
              <img src={user.avatar} alt="" className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <div className="h-10 w-10 rounded-full bg-primary-100 flex items-center justify-center">
                <span className="font-medium text-primary-600">
                  {user?.name?.charAt(0) || user?.email?.charAt(0) || 'U'}
                </span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-neutral-900 truncate">{user?.name || 'Utilisateur'}</p>
              <p className="text-xs text-neutral-500 truncate">{user?.email}</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg text-neutral-400 hover:text-red-600 hover:bg-red-50 transition-colors"
              title="Se déconnecter"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 pt-16 lg:pt-0 lg:ml-0">
        {/* Announcement Banner */}
        <div className="px-4 sm:px-6 lg:px-8 pt-4 pb-0">
          <AnnouncementBanner target="users" />
        </div>
        {children}
      </main>

      {/* Modals */}
      <FeedbackModal isOpen={showFeedback} onClose={() => setShowFeedback(false)} />
      <RatingModal isOpen={showRating} onClose={() => setShowRating(false)} />
    </div>
  );
}
