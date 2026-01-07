/**
 * Admin Layout - Completely Separate from Dashboard
 * Author: NICE-DEV
 */

'use client';

import { useEffect, useState, ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { 
  LayoutDashboard, 
  Users, 
  BarChart3, 
  MessageSquare, 
  Star, 
  Activity,
  Menu,
  X,
  LogOut,
  ArrowLeft,
  Lock,
  Shield,
  Megaphone,
  History,
  HeartPulse
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface User {
  id: string;
  email: string;
  name: string | null;
  avatar: string | null;
  role: string;
}

interface PinStatus {
  hasPinSetup: boolean;
  isLocked: boolean;
  lockoutEndsAt: string | null;
  hasValidSession: boolean;
  sessionExpiresAt: string | null;
}

const navigation = [
  { name: 'Vue d\'ensemble', href: '/admin', icon: LayoutDashboard },
  { name: 'Utilisateurs', href: '/admin/users', icon: Users },
  { name: 'Santé APIs', href: '/admin/health', icon: HeartPulse },
  { name: 'Annonces', href: '/admin/announcements', icon: Megaphone },
  { name: 'Historique Plans', href: '/admin/plan-history', icon: History },
  { name: 'Analytics', href: '/admin/analytics', icon: BarChart3 },
  { name: 'Monitoring', href: '/admin/monitoring', icon: Activity },
  { name: 'Feedbacks', href: '/admin/feedbacks', icon: MessageSquare },
  { name: 'Avis', href: '/admin/ratings', icon: Star },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  // PIN Security State
  const [pinStatus, setPinStatus] = useState<PinStatus | null>(null);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [pinLoading, setPinLoading] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      router.push('/login');
      return;
    }

    try {
      // Get user profile
      const profileRes = await fetch(`${API_URL}/user/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const profileData = await profileRes.json();

      if (!profileData.success || !profileData.data?.user) {
        router.push('/login');
        return;
      }

      if (profileData.data.user.role !== 'ADMIN') {
        router.push('/dashboard');
        return;
      }

      setUser(profileData.data.user);

      // Check PIN status
      const pinRes = await fetch(`${API_URL}/admin/pin/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const pinData = await pinRes.json();

      if (pinData.success) {
        setPinStatus(pinData.data);
        
        // Check if we have a valid session stored
        const adminToken = localStorage.getItem('adminSessionToken');
        if (adminToken && pinData.data.hasValidSession) {
          // Session is valid, proceed
          setShowPinModal(false);
        } else if (!pinData.data.hasPinSetup) {
          // Need to set up PIN
          setIsSettingUp(true);
          setShowPinModal(true);
        } else {
          // Need to verify PIN
          setShowPinModal(true);
        }
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      router.push('/login');
    } finally {
      setLoading(false);
    }
  };

  const handlePinSubmit = async () => {
    if (pinInput.length !== 6) {
      setPinError('Le PIN doit contenir 6 chiffres');
      return;
    }

    setPinLoading(true);
    setPinError('');

    const token = localStorage.getItem('accessToken');
    if (!token) return;

    try {
      const endpoint = isSettingUp ? '/admin/pin/setup' : '/admin/pin/verify';
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ pin: pinInput }),
      });

      const data = await res.json();

      if (data.success) {
        if (isSettingUp) {
          // PIN set up, now verify it
          setIsSettingUp(false);
          setPinInput('');
          setPinError('');
          // Re-check status
          checkAuth();
        } else {
          // Store admin session token
          localStorage.setItem('adminSessionToken', data.data.adminSessionToken);
          setShowPinModal(false);
        }
      } else {
        setPinError(data.error?.message || 'Erreur de vérification');
      }
    } catch (error) {
      setPinError('Erreur de connexion');
    } finally {
      setPinLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('adminSessionToken');
    router.push('/');
  };

  // Fonction pour déconnecter la session admin (garde la session utilisateur)
  const handleAdminLogout = () => {
    localStorage.removeItem('adminSessionToken');
    setShowPinModal(true);
    setPinInput('');
  };

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-900">
        <div className="text-center">
          <img src="/logo.png" alt="NICE-API'HUB" className="h-12 w-12 mx-auto rounded-xl animate-pulse" />
          <p className="mt-4 text-neutral-400">Vérification admin...</p>
        </div>
      </div>
    );
  }

  if (!user || user.role !== 'ADMIN') {
    return null;
  }

  // PIN Modal
  if (showPinModal) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-900 p-4">
        <div className="w-full max-w-md">
          <div className="bg-neutral-800 rounded-2xl border border-neutral-700 p-8">
            <div className="text-center mb-8">
              <img src="/logo.png" alt="NICE-API'HUB" className="h-16 w-16 mx-auto rounded-2xl mb-4" />
              <h1 className="text-2xl font-bold text-white">
                {isSettingUp ? 'Configurer votre PIN' : 'Accès Admin Sécurisé'}
              </h1>
              <p className="text-neutral-400 mt-2">
                {isSettingUp 
                  ? 'Créez un PIN à 6 chiffres pour sécuriser l\'accès admin'
                  : 'Entrez votre PIN à 6 chiffres pour continuer'
                }
              </p>
            </div>

            {pinStatus?.isLocked && (
              <div className="mb-6 p-4 rounded-lg bg-red-500/20 border border-red-500/30">
                <p className="text-red-400 text-sm text-center">
                  Compte verrouillé. Réessayez plus tard.
                </p>
              </div>
            )}

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-2">
                  PIN à 6 chiffres
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={pinInput}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '');
                    setPinInput(value);
                    setPinError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && pinInput.length === 6) {
                      handlePinSubmit();
                    }
                  }}
                  disabled={pinStatus?.isLocked || pinLoading}
                  className="w-full px-4 py-3 bg-neutral-700 border border-neutral-600 rounded-lg text-white text-center text-2xl tracking-[0.5em] font-mono placeholder-neutral-500 focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none disabled:opacity-50"
                  placeholder="••••••"
                  autoFocus
                />
              </div>

              {pinError && (
                <p className="text-red-400 text-sm text-center">{pinError}</p>
              )}

              <button
                onClick={handlePinSubmit}
                disabled={pinInput.length !== 6 || pinStatus?.isLocked || pinLoading}
                className="w-full py-3 px-4 rounded-lg bg-gradient-to-r from-orange-500 to-red-600 text-white font-medium hover:from-orange-600 hover:to-red-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {pinLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Vérification...
                  </span>
                ) : isSettingUp ? (
                  'Configurer le PIN'
                ) : (
                  'Accéder à l\'admin'
                )}
              </button>

              <button
                onClick={() => router.push('/dashboard')}
                className="w-full py-2 text-neutral-400 text-sm hover:text-white transition-colors"
              >
                Retour au dashboard
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-900">
      {/* Mobile Header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-neutral-800 border-b border-neutral-700 flex items-center justify-between px-4 z-50">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="NICE-API'HUB" className="h-9 w-9 rounded-lg" />
          <span className="font-semibold text-white">Admin Panel</span>
        </div>
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-2 rounded-lg text-neutral-400 hover:bg-neutral-700"
        >
          {sidebarOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </header>

      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div 
          className="lg:hidden fixed inset-0 bg-black/60 z-40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 w-64 bg-neutral-800 border-r border-neutral-700 flex flex-col z-50
        transform transition-transform duration-200 ease-in-out
        lg:translate-x-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Logo */}
        <div className="h-16 flex items-center px-6 border-b border-neutral-700">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="NICE-API'HUB" className="h-9 w-9 rounded-lg" />
            <div>
              <span className="font-semibold text-white block">Admin Panel</span>
              <span className="text-xs text-neutral-500">NICE-API'HUB</span>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navigation.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-orange-500/20 text-orange-400'
                    : 'text-neutral-400 hover:bg-neutral-700 hover:text-white'
                }`}
              >
                <Icon className="h-5 w-5" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* Back to Dashboard */}
        <div className="p-3 border-t border-neutral-700">
          <Link
            href="/dashboard"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
            Retour au Dashboard
          </Link>
          <button
            onClick={handleAdminLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-neutral-400 hover:bg-neutral-700 hover:text-yellow-400 transition-colors mt-1"
          >
            <Lock className="h-5 w-5" />
            Verrouiller Admin
          </button>
        </div>

        {/* User Profile */}
        <div className="p-3 border-t border-neutral-700">
          <div className="flex items-center gap-3 px-3 py-2">
            {user.avatar ? (
              <img src={user.avatar} alt="" className="h-9 w-9 rounded-full object-cover" />
            ) : (
              <div className="h-9 w-9 rounded-full bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center">
                <span className="font-medium text-white text-sm">
                  {user.name?.charAt(0) || 'A'}
                </span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user.name || 'Admin'}</p>
              <p className="text-xs text-neutral-500 truncate">{user.email}</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg text-neutral-500 hover:text-red-400 hover:bg-neutral-700 transition-colors"
              title="Se déconnecter"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="lg:pl-64 pt-16 lg:pt-0 min-h-screen">
        <div className="p-4 sm:p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
