/**
 * Admin Analytics Page
 * Author: NICE-DEV
 */

'use client';

import { useEffect, useState } from 'react';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { adminGet } from '@/lib/adminApi';

interface PlatformStat {
  platform: string;
  requests: number;
  avgLatency: number;
  successRate: number;
}

const COLORS = ['#f97316', '#ef4444', '#8b5cf6', '#3b82f6', '#10b981', '#06b6d4', '#ec4899'];

export default function AdminAnalyticsPage() {
  const [period, setPeriod] = useState('7d');
  const [overview, setOverview] = useState<any>(null);
  const [platforms, setPlatforms] = useState<PlatformStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAnalytics();
  }, [period]);

  const fetchAnalytics = async () => {
    try {
      const [overviewData, platformsData] = await Promise.all([
        adminGet(`/admin/analytics/overview?period=${period}`),
        adminGet('/admin/analytics/platforms'),
      ]);

      if (overviewData.success) setOverview(overviewData.data);
      if (platformsData.success) setPlatforms(platformsData.data.platforms);
    } catch (error) {
      console.error('Error fetching analytics:', error);
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

  return (
    <>
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">Analytics</h1>
          <p className="mt-2 text-neutral-400">Analyse détaillée de l'utilisation</p>
        </div>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="px-4 py-2 bg-neutral-700 border border-neutral-600 rounded-lg text-sm text-white focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none"
        >
          <option value="24h">Dernières 24h</option>
          <option value="7d">7 derniers jours</option>
          <option value="30d">30 derniers jours</option>
        </select>
      </div>

      {/* Overview Stats */}
      {overview && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8">
          <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
            <p className="text-sm text-neutral-400 mb-1">Requêtes totales</p>
            <p className="text-2xl font-bold text-white">{overview.totalRequests.toLocaleString()}</p>
          </div>
          <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
            <p className="text-sm text-neutral-400 mb-1">Taux de succès</p>
            <p className="text-2xl font-bold text-green-400">{overview.successRate}%</p>
          </div>
          <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
            <p className="text-sm text-neutral-400 mb-1">Latence moyenne</p>
            <p className="text-2xl font-bold text-blue-400">{overview.avgLatency}ms</p>
          </div>
          <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
            <p className="text-sm text-neutral-400 mb-1">Utilisateurs uniques</p>
            <p className="text-2xl font-bold text-purple-400">{overview.uniqueUsers}</p>
          </div>
        </div>
      )}

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Platform Distribution */}
        <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Distribution par plateforme</h2>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={platforms.slice(0, 7)}
                dataKey="requests"
                nameKey="platform"
                cx="50%"
                cy="50%"
                outerRadius={100}
                label={(entry) => entry.platform}
                labelLine={{ stroke: '#525252' }}
              >
                {platforms.slice(0, 7).map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip 
                contentStyle={{ backgroundColor: '#262626', border: '1px solid #404040', borderRadius: '8px' }}
                labelStyle={{ color: '#fff' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Platform Requests */}
        <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Requêtes par plateforme</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={platforms.slice(0, 10)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#404040" />
              <XAxis dataKey="platform" angle={-45} textAnchor="end" height={80} tick={{ fill: '#a3a3a3', fontSize: 12 }} />
              <YAxis tick={{ fill: '#a3a3a3' }} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#262626', border: '1px solid #404040', borderRadius: '8px' }}
                labelStyle={{ color: '#fff' }}
              />
              <Bar dataKey="requests" fill="#f97316" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Platform Latency */}
        <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Latence par plateforme</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={platforms.slice(0, 10)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#404040" />
              <XAxis dataKey="platform" angle={-45} textAnchor="end" height={80} tick={{ fill: '#a3a3a3', fontSize: 12 }} />
              <YAxis tick={{ fill: '#a3a3a3' }} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#262626', border: '1px solid #404040', borderRadius: '8px' }}
                labelStyle={{ color: '#fff' }}
              />
              <Bar dataKey="avgLatency" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Success Rate */}
        <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Taux de succès par plateforme</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={platforms.slice(0, 10)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#404040" />
              <XAxis dataKey="platform" angle={-45} textAnchor="end" height={80} tick={{ fill: '#a3a3a3', fontSize: 12 }} />
              <YAxis domain={[0, 100]} tick={{ fill: '#a3a3a3' }} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#262626', border: '1px solid #404040', borderRadius: '8px' }}
                labelStyle={{ color: '#fff' }}
              />
              <Bar dataKey="successRate" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Platform Details Table */}
      <div className="mt-6 bg-neutral-800 rounded-xl border border-neutral-700 overflow-hidden">
        <div className="p-6 border-b border-neutral-700">
          <h2 className="text-lg font-semibold text-white">Détails des plateformes</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-neutral-700/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-neutral-400 uppercase">Plateforme</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-neutral-400 uppercase">Requêtes</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-neutral-400 uppercase">Latence moy.</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-neutral-400 uppercase">Taux de succès</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-700">
              {platforms.map((platform) => (
                <tr key={platform.platform} className="hover:bg-neutral-700/30">
                  <td className="px-6 py-4 font-medium text-white capitalize">{platform.platform}</td>
                  <td className="px-6 py-4 text-neutral-300">{platform.requests.toLocaleString()}</td>
                  <td className="px-6 py-4 text-neutral-300">{platform.avgLatency}ms</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                      platform.successRate >= 95 ? 'bg-green-500/20 text-green-400' :
                      platform.successRate >= 80 ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-red-500/20 text-red-400'
                    }`}>
                      {platform.successRate}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
