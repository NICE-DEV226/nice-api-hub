/**
 * Admin Platform Health Page
 * Author: NICE-DEV
 */

'use client';

import { useEffect, useState } from 'react';
import { 
  Activity, 
  CheckCircle, 
  AlertTriangle, 
  XCircle, 
  Wrench,
  RefreshCw,
  TrendingUp,
  Clock
} from 'lucide-react';
import { adminGet, adminPost } from '@/lib/adminApi';

interface PlatformHealth {
  id: string;
  platform: string;
  endpoint: string;
  status: 'HEALTHY' | 'DEGRADED' | 'UNSTABLE' | 'DOWN' | 'MAINTENANCE';
  successRate: number;
  avgLatency: number;
  totalRequests: number;
  failedRequests: number;
  consecutiveErrors: number;
  lastError: string | null;
  lastCheckedAt: string;
  statusChangedAt: string | null;
}

const STATUS_CONFIG = {
  HEALTHY: {
    label: 'Opérationnel',
    color: 'text-green-400',
    bg: 'bg-green-500/20',
    icon: CheckCircle,
  },
  DEGRADED: {
    label: 'Dégradé',
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/20',
    icon: AlertTriangle,
  },
  UNSTABLE: {
    label: 'Instable',
    color: 'text-orange-400',
    bg: 'bg-orange-500/20',
    icon: AlertTriangle,
  },
  DOWN: {
    label: 'Hors service',
    color: 'text-red-400',
    bg: 'bg-red-500/20',
    icon: XCircle,
  },
  MAINTENANCE: {
    label: 'Maintenance',
    color: 'text-blue-400',
    bg: 'bg-blue-500/20',
    icon: Wrench,
  },
};

export default function AdminHealthPage() {
  const [platforms, setPlatforms] = useState<PlatformHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    fetchHealth();
  }, []);

  const fetchHealth = async () => {
    try {
      const data = await adminGet('/admin/monitoring/health/detailed');
      if (data.success) {
        setPlatforms(data.data.platforms);
      }
    } catch (error) {
      console.error('Error fetching health:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleMaintenance = async (platform: string, currentStatus: string) => {
    setActionLoading(platform);
    try {
      const enabled = currentStatus !== 'MAINTENANCE';
      await adminPost(`/admin/monitoring/health/${platform}/maintenance`, { enabled });
      fetchHealth();
    } catch (error) {
      console.error('Error toggling maintenance:', error);
    } finally {
      setActionLoading(null);
    }
  };

  const resetHealth = async (platform: string) => {
    if (!confirm(`Réinitialiser les métriques de ${platform} ?`)) return;
    setActionLoading(platform);
    try {
      await adminPost(`/admin/monitoring/health/${platform}/reset`);
      fetchHealth();
    } catch (error) {
      console.error('Error resetting health:', error);
    } finally {
      setActionLoading(null);
    }
  };

  const getOverallStatus = () => {
    if (platforms.some(p => p.status === 'DOWN')) return 'DOWN';
    if (platforms.some(p => p.status === 'UNSTABLE')) return 'UNSTABLE';
    if (platforms.some(p => p.status === 'DEGRADED' || p.status === 'MAINTENANCE')) return 'DEGRADED';
    return 'HEALTHY';
  };

  const overallStatus = getOverallStatus();
  const OverallIcon = STATUS_CONFIG[overallStatus].icon;

  return (
    <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">Santé des APIs</h1>
          <p className="mt-2 text-neutral-400">Monitoring en temps réel des endpoints</p>
        </div>
        <button
          onClick={fetchHealth}
          className="flex items-center gap-2 px-4 py-2 bg-neutral-700 text-white rounded-lg hover:bg-neutral-600 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          Actualiser
        </button>
      </div>

      {/* Overall Status */}
      <div className={`rounded-xl border p-6 mb-6 ${STATUS_CONFIG[overallStatus].bg} border-neutral-700`}>
        <div className="flex items-center gap-4">
          <OverallIcon className={`h-12 w-12 ${STATUS_CONFIG[overallStatus].color}`} />
          <div>
            <p className="text-sm text-neutral-400">Statut global</p>
            <p className={`text-2xl font-bold ${STATUS_CONFIG[overallStatus].color}`}>
              {STATUS_CONFIG[overallStatus].label}
            </p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-sm text-neutral-400">Plateformes</p>
            <p className="text-2xl font-bold text-white">{platforms.length}</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-4">
          <div className="flex items-center gap-2 text-green-400 mb-2">
            <CheckCircle className="h-5 w-5" />
            <span className="text-sm">Healthy</span>
          </div>
          <p className="text-2xl font-bold text-white">
            {platforms.filter(p => p.status === 'HEALTHY').length}
          </p>
        </div>
        <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-4">
          <div className="flex items-center gap-2 text-yellow-400 mb-2">
            <AlertTriangle className="h-5 w-5" />
            <span className="text-sm">Dégradé</span>
          </div>
          <p className="text-2xl font-bold text-white">
            {platforms.filter(p => ['DEGRADED', 'UNSTABLE'].includes(p.status)).length}
          </p>
        </div>
        <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-4">
          <div className="flex items-center gap-2 text-red-400 mb-2">
            <XCircle className="h-5 w-5" />
            <span className="text-sm">Down</span>
          </div>
          <p className="text-2xl font-bold text-white">
            {platforms.filter(p => p.status === 'DOWN').length}
          </p>
        </div>
        <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-4">
          <div className="flex items-center gap-2 text-blue-400 mb-2">
            <Wrench className="h-5 w-5" />
            <span className="text-sm">Maintenance</span>
          </div>
          <p className="text-2xl font-bold text-white">
            {platforms.filter(p => p.status === 'MAINTENANCE').length}
          </p>
        </div>
      </div>

      {/* Platforms List */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-orange-500 border-r-transparent"></div>
        </div>
      ) : (
        <div className="space-y-4">
          {platforms.length === 0 ? (
            <div className="text-center py-12 rounded-xl border border-neutral-700 bg-neutral-800">
              <Activity className="h-12 w-12 text-neutral-600 mx-auto mb-3" />
              <p className="text-neutral-500">Aucune donnée de santé disponible</p>
              <p className="text-sm text-neutral-600 mt-1">Les métriques apparaîtront après les premières requêtes API</p>
            </div>
          ) : (
            platforms.map((platform) => {
              const config = STATUS_CONFIG[platform.status];
              const StatusIcon = config.icon;
              const isLoading = actionLoading === platform.platform;

              return (
                <div
                  key={platform.id}
                  className="bg-neutral-800 rounded-xl border border-neutral-700 p-4 sm:p-6"
                >
                  <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                    {/* Platform Info */}
                    <div className="flex items-center gap-4 flex-1">
                      <div className={`h-12 w-12 rounded-xl ${config.bg} flex items-center justify-center`}>
                        <StatusIcon className={`h-6 w-6 ${config.color}`} />
                      </div>
                      <div>
                        <h3 className="font-bold text-white text-lg capitalize">{platform.platform}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${config.bg} ${config.color}`}>
                            {config.label}
                          </span>
                          {platform.consecutiveErrors > 0 && (
                            <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-400">
                              {platform.consecutiveErrors} erreurs consécutives
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Metrics */}
                    <div className="grid grid-cols-3 gap-4 lg:gap-8">
                      <div className="text-center">
                        <div className="flex items-center justify-center gap-1 text-neutral-400 mb-1">
                          <TrendingUp className="h-4 w-4" />
                          <span className="text-xs">Succès</span>
                        </div>
                        <p className={`text-lg font-bold ${
                          platform.successRate >= 95 ? 'text-green-400' :
                          platform.successRate >= 80 ? 'text-yellow-400' :
                          platform.successRate >= 50 ? 'text-orange-400' : 'text-red-400'
                        }`}>
                          {platform.successRate.toFixed(1)}%
                        </p>
                      </div>
                      <div className="text-center">
                        <div className="flex items-center justify-center gap-1 text-neutral-400 mb-1">
                          <Clock className="h-4 w-4" />
                          <span className="text-xs">Latence</span>
                        </div>
                        <p className={`text-lg font-bold ${
                          platform.avgLatency < 2000 ? 'text-green-400' :
                          platform.avgLatency < 5000 ? 'text-yellow-400' : 'text-red-400'
                        }`}>
                          {platform.avgLatency}ms
                        </p>
                      </div>
                      <div className="text-center">
                        <div className="flex items-center justify-center gap-1 text-neutral-400 mb-1">
                          <Activity className="h-4 w-4" />
                          <span className="text-xs">Requêtes</span>
                        </div>
                        <p className="text-lg font-bold text-white">
                          {platform.totalRequests.toLocaleString()}
                        </p>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => toggleMaintenance(platform.platform, platform.status)}
                        disabled={isLoading}
                        className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
                          platform.status === 'MAINTENANCE'
                            ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                            : 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30'
                        }`}
                      >
                        {platform.status === 'MAINTENANCE' ? 'Réactiver' : 'Maintenance'}
                      </button>
                      <button
                        onClick={() => resetHealth(platform.platform)}
                        disabled={isLoading}
                        className="px-3 py-2 rounded-lg bg-neutral-700 text-neutral-300 text-xs font-medium hover:bg-neutral-600 transition-colors disabled:opacity-50"
                      >
                        <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                  </div>

                  {/* Last Error */}
                  {platform.lastError && (
                    <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                      <p className="text-xs text-red-400">
                        <span className="font-medium">Dernière erreur:</span> {platform.lastError}
                      </p>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </>
  );
}
