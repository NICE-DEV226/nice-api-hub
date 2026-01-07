/**
 * Admin Overview Dashboard
 * Author: NICE-DEV
 */

'use client';

import { useEffect, useState } from 'react';
import { Users, Activity, Zap, AlertCircle } from 'lucide-react';
import { adminGet } from '@/lib/adminApi';

interface DashboardStats {
  totalUsers: number;
  activeUsers: number;
  totalRequests: number;
  requestsToday: number;
  avgLatency: number;
  errorRate: number;
  topPlatforms: Array<{ platform: string; requests: number }>;
}

export default function AdminOverviewPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboard();
  }, []);

  const fetchDashboard = async () => {
    try {
      const data = await adminGet('/admin/dashboard');
      if (data.success) {
        setStats(data.data);
      }
    } catch (error) {
      console.error('Error fetching dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-orange-500 border-r-transparent"></div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="text-center py-12">
        <p className="text-neutral-500">Impossible de charger les statistiques</p>
      </div>
    );
  }

  const statCards = [
    {
      name: 'Utilisateurs totaux',
      value: stats.totalUsers.toLocaleString(),
      subtext: `${stats.activeUsers} actifs`,
      icon: Users,
      gradient: 'from-blue-500 to-blue-600',
    },
    {
      name: 'Requêtes aujourd\'hui',
      value: stats.requestsToday.toLocaleString(),
      subtext: `${stats.totalRequests.toLocaleString()} total`,
      icon: Activity,
      gradient: 'from-green-500 to-emerald-600',
    },
    {
      name: 'Latence moyenne',
      value: `${stats.avgLatency}ms`,
      subtext: 'Temps de réponse',
      icon: Zap,
      gradient: 'from-purple-500 to-violet-600',
    },
    {
      name: 'Taux d\'erreur',
      value: `${stats.errorRate}%`,
      subtext: 'Aujourd\'hui',
      icon: AlertCircle,
      gradient: stats.errorRate > 5 ? 'from-red-500 to-red-600' : 'from-yellow-500 to-orange-600',
    },
  ];

  return (
    <>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white">Vue d'ensemble</h1>
        <p className="mt-2 text-neutral-400">Statistiques et métriques de la plateforme</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.name} className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className={`bg-gradient-to-br ${stat.gradient} p-3 rounded-lg`}>
                  <Icon className="h-6 w-6 text-white" />
                </div>
              </div>
              <p className="text-sm text-neutral-400 mb-1">{stat.name}</p>
              <p className="text-2xl font-bold text-white">{stat.value}</p>
              <p className="text-xs text-neutral-500 mt-1">{stat.subtext}</p>
            </div>
          );
        })}
      </div>

      {/* Top Platforms */}
      <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Plateformes les plus utilisées</h2>
        <div className="space-y-4">
          {stats.topPlatforms.length === 0 ? (
            <p className="text-sm text-neutral-500">Aucune donnée disponible</p>
          ) : (
            stats.topPlatforms.map((platform, index) => {
              const maxRequests = stats.topPlatforms[0]?.requests || 1;
              const percentage = (platform.requests / maxRequests) * 100;
              
              return (
                <div key={platform.platform}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-neutral-300 capitalize">
                      {index + 1}. {platform.platform}
                    </span>
                    <span className="text-sm text-neutral-500">
                      {platform.requests.toLocaleString()} requêtes
                    </span>
                  </div>
                  <div className="w-full bg-neutral-700 rounded-full h-2">
                    <div
                      className="bg-gradient-to-r from-orange-500 to-red-500 h-2 rounded-full transition-all duration-500"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
