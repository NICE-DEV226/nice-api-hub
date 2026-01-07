/**
 * User Dashboard Page
 * Author: NICE-DEV
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import DashboardLayout from '@/components/DashboardLayout';

interface UsageStats {
  totalRequests: number;
  requestsToday: number;
  requestsThisMonth: number;
  dailyLimit: number;
  remainingQuota: number;
  plan: string;
}

interface ApiKey {
  id: string;
  name: string;
  keyPreview: string;
  environment: string;
  isActive: boolean;
}

interface User {
  name: string | null;
  plan: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Bonjour';
  if (hour >= 12 && hour < 18) return 'Bon après-midi';
  if (hour >= 18 && hour < 22) return 'Bonsoir';
  return 'Bonne nuit';
}

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) return;

    Promise.all([
      fetch(`${API_URL}/user/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json()),
      fetch(`${API_URL}/user/usage`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json()),
      fetch(`${API_URL}/api-keys`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json()),
    ])
      .then(([profileRes, usageRes, keysRes]) => {
        if (profileRes.success && profileRes.data?.user) {
          setUser(profileRes.data.user);
        }
        if (usageRes.success) setStats(usageRes.data);
        if (keysRes.success) setApiKeys(keysRes.data?.apiKeys || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const planColors: Record<string, string> = {
    FREE: 'bg-neutral-100 text-neutral-700',
    BASIC: 'bg-blue-100 text-blue-700',
    PRO: 'bg-purple-100 text-purple-700',
    ENTERPRISE: 'bg-amber-100 text-amber-700',
  };

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-neutral-900">
              {loading ? 'Chargement...' : `${getGreeting()}, ${user?.name || 'Développeur'}`}
            </h1>
            <p className="mt-1 text-sm text-neutral-500">Voici un aperçu de votre utilisation.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`rounded-full px-3 py-1 text-sm font-medium ${planColors[user?.plan || 'FREE']}`}>
              {user?.plan || 'FREE'}
            </span>
            {user?.plan !== 'ENTERPRISE' && (
              <Link href="/pricing" className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700">
                Upgrade
              </Link>
            )}
          </div>
        </div>

        <div className="mt-6 sm:mt-8 grid gap-4 grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-neutral-200 bg-white p-4 sm:p-5">
            <p className="text-xs sm:text-sm text-neutral-500">Aujourd&apos;hui</p>
            <p className="mt-2 text-2xl sm:text-3xl font-bold text-neutral-900">{stats?.requestsToday || 0}</p>
            <div className="mt-2 h-1.5 rounded-full bg-neutral-100 overflow-hidden">
              <div 
                className="h-full bg-primary-500 rounded-full"
                style={{ width: `${Math.min(100, ((stats?.requestsToday || 0) / (stats?.dailyLimit || 100)) * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-neutral-500">
              {stats?.dailyLimit === -1 ? 'Illimité' : `${stats?.remainingQuota || 0} restantes`}
            </p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4 sm:p-5">
            <p className="text-xs sm:text-sm text-neutral-500">Ce mois</p>
            <p className="mt-2 text-2xl sm:text-3xl font-bold text-neutral-900">{stats?.requestsThisMonth || 0}</p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4 sm:p-5">
            <p className="text-xs sm:text-sm text-neutral-500">Total</p>
            <p className="mt-2 text-2xl sm:text-3xl font-bold text-neutral-900">{stats?.totalRequests || 0}</p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4 sm:p-5">
            <p className="text-xs sm:text-sm text-neutral-500">Clés API</p>
            <p className="mt-2 text-2xl sm:text-3xl font-bold text-neutral-900">{apiKeys.length}</p>
          </div>
        </div>

        <div className="mt-6 sm:mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-base sm:text-lg font-semibold text-neutral-900">Vos clés API</h2>
            <Link href="/api-keys" className="text-sm text-primary-600 hover:underline">Gérer →</Link>
          </div>
          <div className="mt-4 rounded-xl border border-neutral-200 bg-white overflow-hidden">
            {apiKeys.length === 0 ? (
              <div className="p-6 sm:p-8 text-center">
                <p className="font-medium text-neutral-900">Aucune clé API</p>
                <Link href="/api-keys" className="mt-4 inline-block rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700">
                  Créer une clé
                </Link>
              </div>
            ) : (
              <>
                {/* Desktop Table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-neutral-50 border-b border-neutral-200">
                      <tr>
                        <th className="px-4 lg:px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase">Nom</th>
                        <th className="px-4 lg:px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase">Clé</th>
                        <th className="px-4 lg:px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase">Env</th>
                        <th className="px-4 lg:px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase">Statut</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-200">
                      {apiKeys.slice(0, 3).map((key) => (
                        <tr key={key.id} className="hover:bg-neutral-50">
                          <td className="px-4 lg:px-6 py-4 text-sm font-medium text-neutral-900">{key.name}</td>
                          <td className="px-4 lg:px-6 py-4 text-sm font-mono text-neutral-500">{key.keyPreview}</td>
                          <td className="px-4 lg:px-6 py-4">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${key.environment === 'PRODUCTION' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                              {key.environment === 'PRODUCTION' ? 'Prod' : 'Dev'}
                            </span>
                          </td>
                          <td className="px-4 lg:px-6 py-4">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${key.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                              {key.isActive ? 'Active' : 'Révoquée'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Cards */}
                <div className="md:hidden divide-y divide-neutral-200">
                  {apiKeys.slice(0, 3).map((key) => (
                    <div key={key.id} className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-neutral-900 text-sm">{key.name}</p>
                          <p className="mt-1 text-xs font-mono text-neutral-500 truncate">{key.keyPreview}</p>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${key.environment === 'PRODUCTION' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                            {key.environment === 'PRODUCTION' ? 'Prod' : 'Dev'}
                          </span>
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${key.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {key.isActive ? 'Active' : 'Révoquée'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="mt-6 sm:mt-8 rounded-xl border border-neutral-200 bg-white p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-semibold text-neutral-900">Démarrage rapide</h2>
          <div className="mt-4 rounded-lg bg-neutral-900 p-3 sm:p-4 overflow-x-auto">
            <pre className="text-xs sm:text-sm text-neutral-300">
              <code>{`curl -X GET "${API_URL}/api/tiktok/download?url=VIDEO_URL" \\
  -H "Authorization: Bearer VOTRE_CLE_API"`}</code>
            </pre>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
