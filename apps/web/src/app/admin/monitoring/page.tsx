/**
 * Admin Monitoring Page
 * Author: NICE-DEV
 */

'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { adminGet } from '@/lib/adminApi';

interface LatencyMetrics {
  overall: {
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  };
  byPlatform: Array<{
    platform: string;
    avgTotal: number;
    avgExternal: number;
  }>;
}

interface ApiHealth {
  platform: string;
  isHealthy: boolean;
  avgLatency: number;
  p95Latency: number;
  successRate: number;
  totalRequests: number;
}

interface ErrorMetrics {
  totalErrors: number;
  errorRate: number;
  byEndpoint: Array<{ endpoint: string; count: number }>;
  recent: Array<{
    endpoint: string;
    statusCode: number;
    errorMessage: string | null;
    timestamp: string;
  }>;
}

export default function AdminMonitoringPage() {
  const [latency, setLatency] = useState<LatencyMetrics | null>(null);
  const [health, setHealth] = useState<ApiHealth[]>([]);
  const [errors, setErrors] = useState<ErrorMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  useEffect(() => {
    fetchMonitoring();
    const interval = setInterval(fetchMonitoring, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchMonitoring = async () => {
    try {
      const [latencyData, healthData, errorsData] = await Promise.all([
        adminGet('/admin/monitoring/latency'),
        adminGet('/admin/monitoring/health'),
        adminGet('/admin/monitoring/errors'),
      ]);

      if (latencyData.success) setLatency(latencyData.data);
      if (healthData.success) setHealth(healthData.data.platforms);
      if (errorsData.success) setErrors(errorsData.data);
      setLastUpdate(new Date());
    } catch (error) {
      console.error('Error fetching monitoring data:', error);
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
          <h1 className="text-2xl sm:text-3xl font-bold text-white">Monitoring</h1>
          <p className="mt-2 text-neutral-400">Surveillance en temps réel de la plateforme</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-neutral-500">
            Mis à jour: {lastUpdate.toLocaleTimeString('fr-FR')}
          </span>
          <button
            onClick={fetchMonitoring}
            className="p-2 rounded-lg bg-neutral-700 text-neutral-400 hover:text-white hover:bg-neutral-600 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Latency Overview */}
      {latency && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8">
          <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
            <p className="text-sm text-neutral-400 mb-1">Latence moyenne</p>
            <p className="text-2xl font-bold text-white">{latency.overall.avg}ms</p>
          </div>
          <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
            <p className="text-sm text-neutral-400 mb-1">P50 (Médiane)</p>
            <p className="text-2xl font-bold text-blue-400">{latency.overall.p50}ms</p>
          </div>
          <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
            <p className="text-sm text-neutral-400 mb-1">P95</p>
            <p className="text-2xl font-bold text-yellow-400">{latency.overall.p95}ms</p>
          </div>
          <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
            <p className="text-sm text-neutral-400 mb-1">P99</p>
            <p className="text-2xl font-bold text-red-400">{latency.overall.p99}ms</p>
          </div>
        </div>
      )}

      {/* Latency Charts */}
      {latency && latency.byPlatform.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Total vs External Latency */}
          <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Latence totale vs externe</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={latency.byPlatform.slice(0, 10)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#404040" />
                <XAxis dataKey="platform" angle={-45} textAnchor="end" height={80} tick={{ fill: '#a3a3a3', fontSize: 12 }} />
                <YAxis tick={{ fill: '#a3a3a3' }} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#262626', border: '1px solid #404040', borderRadius: '8px' }}
                  labelStyle={{ color: '#fff' }}
                />
                <Legend wrapperStyle={{ color: '#a3a3a3' }} />
                <Bar dataKey="avgTotal" fill="#f97316" name="Total" radius={[4, 4, 0, 0]} />
                <Bar dataKey="avgExternal" fill="#8b5cf6" name="Externe" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Internal Processing Time */}
          <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Temps de traitement interne</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={latency.byPlatform.slice(0, 10).map(p => ({
                platform: p.platform,
                internal: Math.max(0, p.avgTotal - p.avgExternal)
              }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#404040" />
                <XAxis dataKey="platform" angle={-45} textAnchor="end" height={80} tick={{ fill: '#a3a3a3', fontSize: 12 }} />
                <YAxis tick={{ fill: '#a3a3a3' }} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#262626', border: '1px solid #404040', borderRadius: '8px' }}
                  labelStyle={{ color: '#fff' }}
                />
                <Bar dataKey="internal" fill="#10b981" name="Interne" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* API Health Status */}
      {health.length > 0 && (
        <div className="bg-neutral-800 rounded-xl border border-neutral-700 mb-8">
          <div className="p-6 border-b border-neutral-700">
            <h2 className="text-lg font-semibold text-white">État de santé des APIs</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-neutral-700/50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-neutral-400 uppercase">Plateforme</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-neutral-400 uppercase">Statut</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-neutral-400 uppercase">Latence moy.</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-neutral-400 uppercase">P95</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-neutral-400 uppercase">Taux succès</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-neutral-400 uppercase">Requêtes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-700">
                {health.map((api) => (
                  <tr key={api.platform} className="hover:bg-neutral-700/30">
                    <td className="px-6 py-4 font-medium text-white capitalize">{api.platform}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {api.isHealthy ? (
                          <>
                            <CheckCircle className="h-5 w-5 text-green-400" />
                            <span className="text-sm text-green-400">Opérationnel</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="h-5 w-5 text-red-400" />
                            <span className="text-sm text-red-400">Problème</span>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-neutral-300">{Math.round(api.avgLatency)}ms</td>
                    <td className="px-6 py-4 text-neutral-300">{Math.round(api.p95Latency)}ms</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                        api.successRate >= 95 ? 'bg-green-500/20 text-green-400' :
                        api.successRate >= 80 ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>
                        {api.successRate.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-6 py-4 text-neutral-300">{api.totalRequests.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Error Metrics */}
      {errors && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Error Overview */}
          <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 rounded-lg bg-red-500/20">
                <AlertTriangle className="h-6 w-6 text-red-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Erreurs aujourd'hui</h2>
                <p className="text-sm text-neutral-500">Taux d'erreur: {errors.errorRate}%</p>
              </div>
            </div>
            <p className="text-3xl font-bold text-red-400">{errors.totalErrors.toLocaleString()}</p>
          </div>

          {/* Top Error Endpoints */}
          <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Endpoints avec le plus d'erreurs</h2>
            <div className="space-y-3">
              {errors.byEndpoint.length === 0 ? (
                <p className="text-sm text-neutral-500">Aucune erreur 🎉</p>
              ) : (
                errors.byEndpoint.slice(0, 5).map((item, index) => (
                  <div key={item.endpoint}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-neutral-300 truncate">
                        {index + 1}. {item.endpoint}
                      </span>
                      <span className="text-sm text-red-400">{item.count}</span>
                    </div>
                    <div className="w-full bg-neutral-700 rounded-full h-2">
                      <div
                        className="bg-red-500 h-2 rounded-full"
                        style={{ width: `${(item.count / errors.byEndpoint[0].count) * 100}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Recent Errors */}
      {errors && errors.recent.length > 0 && (
        <div className="mt-6 bg-neutral-800 rounded-xl border border-neutral-700">
          <div className="p-6 border-b border-neutral-700">
            <h2 className="text-lg font-semibold text-white">Erreurs récentes</h2>
          </div>
          <div className="divide-y divide-neutral-700">
            {errors.recent.slice(0, 10).map((error, index) => (
              <div key={index} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-white truncate">{error.endpoint}</p>
                    {error.errorMessage && (
                      <p className="text-sm text-red-400 mt-1 truncate">{error.errorMessage}</p>
                    )}
                    <p className="text-xs text-neutral-500 mt-1">
                      {new Date(error.timestamp).toLocaleString('fr-FR')}
                    </p>
                  </div>
                  <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                    error.statusCode >= 500 ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'
                  }`}>
                    {error.statusCode}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
