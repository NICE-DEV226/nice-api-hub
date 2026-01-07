/**
 * Account Suspended Page
 * Author: NICE-DEV
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function SuspendedPage() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    // Récupérer l'email stocké
    const email = localStorage.getItem('userEmail');
    setUserEmail(email);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('userEmail');
    router.push('/');
  };

  const checkStatus = async () => {
    setChecking(true);
    const token = localStorage.getItem('accessToken');
    
    if (!token) {
      router.push('/login');
      return;
    }

    try {
      const res = await fetch(`${API_URL}/user/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      if (data.success && data.data?.user) {
        if (!data.data.isSuspended && data.data.user.isActive) {
          // Compte réactivé !
          router.push('/dashboard');
        }
      }
    } catch (error) {
      console.error('Error checking status:', error);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2">
            <img src="/logo.png" alt="NICE-API'HUB" className="h-12 w-12 rounded-xl shadow-lg" />
          </Link>
        </div>

        {/* Card */}
        <div className="bg-neutral-800 rounded-2xl border border-neutral-700 p-8 text-center">
          {/* Icon */}
          <div className="mx-auto w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center mb-6">
            <svg className="h-10 w-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>

          {/* Title */}
          <h1 className="text-2xl font-bold text-white mb-2">
            Compte suspendu
          </h1>

          {/* Description */}
          <p className="text-neutral-400 mb-6">
            Votre compte a été temporairement suspendu par un administrateur.
          </p>

          {/* User Email */}
          {userEmail && (
            <div className="bg-neutral-700/50 rounded-lg px-4 py-3 mb-6">
              <p className="text-sm text-neutral-500">Compte</p>
              <p className="text-white font-medium">{userEmail}</p>
            </div>
          )}

          {/* Reasons */}
          <div className="bg-neutral-700/30 rounded-xl p-4 mb-6 text-left">
            <p className="text-sm font-medium text-neutral-300 mb-3">Raisons possibles :</p>
            <ul className="space-y-2 text-sm text-neutral-400">
              <li className="flex items-start gap-2">
                <svg className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>Violation des conditions d&apos;utilisation</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>Activité suspecte détectée</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>Abus de l&apos;API ou dépassement des limites</span>
              </li>
              <li className="flex items-start gap-2">
                <svg className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>Paiement en attente ou refusé</span>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 mb-6">
            <p className="text-sm text-blue-400">
              Si vous pensez qu&apos;il s&apos;agit d&apos;une erreur, contactez-nous à{' '}
              <a href="mailto:nicebot226@gmail.com" className="underline hover:text-blue-300">
                nicebot226@gmail.com
              </a>
            </p>
          </div>

          {/* Actions */}
          <div className="space-y-3">
            <button
              onClick={checkStatus}
              disabled={checking}
              className="w-full px-4 py-3 rounded-xl bg-orange-500 text-white font-medium hover:bg-orange-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {checking ? (
                <>
                  <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Vérification...
                </>
              ) : (
                <>
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Vérifier mon statut
                </>
              )}
            </button>

            <button
              onClick={handleLogout}
              className="w-full px-4 py-3 rounded-xl bg-neutral-700 text-neutral-300 font-medium hover:bg-neutral-600 transition-colors"
            >
              Se déconnecter
            </button>

            <Link
              href="/"
              className="block w-full px-4 py-3 rounded-xl border border-neutral-600 text-neutral-400 font-medium hover:bg-neutral-700/50 transition-colors"
            >
              Retour à l&apos;accueil
            </Link>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-sm text-neutral-600 mt-6">
          © 2025 NICE-API&apos;HUB by NICE-DEV
        </p>
      </div>
    </div>
  );
}
