/**
 * Admin Plan Change History Page
 * Author: NICE-DEV
 */

'use client';

import { useEffect, useState } from 'react';
import { History, Crown, ArrowRight } from 'lucide-react';
import { adminGet } from '@/lib/adminApi';

interface PlanChange {
  id: string;
  userId: string;
  previousPlan: string;
  newPlan: string;
  changedBy: string;
  changedByEmail: string;
  reason: string | null;
  createdAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatar: string | null;
  } | null;
}

const PLAN_COLORS: Record<string, string> = {
  FREE: 'bg-neutral-600 text-neutral-300',
  BASIC: 'bg-blue-500/20 text-blue-400',
  PRO: 'bg-purple-500/20 text-purple-400',
  ENTERPRISE: 'bg-orange-500/20 text-orange-400',
};

export default function AdminPlanHistoryPage() {
  const [history, setHistory] = useState<PlanChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    fetchHistory();
  }, [page]);

  const fetchHistory = async () => {
    try {
      const data = await adminGet(`/admin/plan-history?page=${page}&limit=20`);
      if (data.success) {
        setHistory(data.data.history);
        setTotalPages(data.data.pagination.totalPages);
      }
    } catch (error) {
      console.error('Error fetching history:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-white">Historique des Plans</h1>
        <p className="mt-2 text-neutral-400">Suivi des changements de plan utilisateurs</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-4">
          <p className="text-sm text-neutral-400">Total changements</p>
          <p className="text-2xl font-bold text-white">{history.length > 0 ? totalPages * 20 : 0}</p>
        </div>
        <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-4">
          <p className="text-sm text-neutral-400">Upgrades</p>
          <p className="text-2xl font-bold text-green-400">
            {history.filter(h => {
              const plans = ['FREE', 'BASIC', 'PRO', 'ENTERPRISE'];
              return plans.indexOf(h.newPlan) > plans.indexOf(h.previousPlan);
            }).length}
          </p>
        </div>
        <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-4">
          <p className="text-sm text-neutral-400">Downgrades</p>
          <p className="text-2xl font-bold text-red-400">
            {history.filter(h => {
              const plans = ['FREE', 'BASIC', 'PRO', 'ENTERPRISE'];
              return plans.indexOf(h.newPlan) < plans.indexOf(h.previousPlan);
            }).length}
          </p>
        </div>
        <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-4">
          <p className="text-sm text-neutral-400">Cette page</p>
          <p className="text-2xl font-bold text-blue-400">{history.length}</p>
        </div>
      </div>

      {/* History List */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-orange-500 border-r-transparent"></div>
        </div>
      ) : (
        <div className="bg-neutral-800 rounded-xl border border-neutral-700 overflow-hidden">
          {history.length === 0 ? (
            <div className="text-center py-12">
              <History className="h-12 w-12 text-neutral-600 mx-auto mb-3" />
              <p className="text-neutral-500">Aucun changement de plan enregistré</p>
            </div>
          ) : (
            <>
              <div className="divide-y divide-neutral-700">
                {history.map((change) => (
                  <div key={change.id} className="p-4 sm:p-6 hover:bg-neutral-700/30 transition-colors">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                      {/* User Info */}
                      <div className="flex items-center gap-3 flex-1">
                        {change.user?.avatar ? (
                          <img 
                            src={change.user.avatar} 
                            alt="" 
                            className="h-10 w-10 rounded-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center">
                            <span className="font-medium text-white text-sm">
                              {change.user?.name?.charAt(0) || '?'}
                            </span>
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-white">{change.user?.name || 'Utilisateur supprimé'}</p>
                          <p className="text-xs text-neutral-500">{change.user?.email}</p>
                        </div>
                      </div>

                      {/* Plan Change */}
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${PLAN_COLORS[change.previousPlan]}`}>
                          <Crown className="h-3 w-3" />
                          {change.previousPlan}
                        </span>
                        <ArrowRight className="h-4 w-4 text-neutral-500" />
                        <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${PLAN_COLORS[change.newPlan]}`}>
                          <Crown className="h-3 w-3" />
                          {change.newPlan}
                        </span>
                      </div>

                      {/* Meta */}
                      <div className="text-right text-xs text-neutral-500">
                        <p>Par {change.changedByEmail}</p>
                        <p>{formatDate(change.createdAt)}</p>
                      </div>
                    </div>

                    {change.reason && (
                      <div className="mt-3 px-4 py-2 bg-neutral-700/50 rounded-lg">
                        <p className="text-sm text-neutral-400">
                          <span className="text-neutral-500">Raison:</span> {change.reason}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-6 py-4 border-t border-neutral-700">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-4 py-2 rounded-lg bg-neutral-700 text-neutral-300 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-neutral-600 transition-colors"
                  >
                    Précédent
                  </button>
                  <span className="text-sm text-neutral-400">
                    Page {page} sur {totalPages}
                  </span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-4 py-2 rounded-lg bg-neutral-700 text-neutral-300 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-neutral-600 transition-colors"
                  >
                    Suivant
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
