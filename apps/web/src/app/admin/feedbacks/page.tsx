/**
 * Admin Feedbacks Management Page
 * Author: NICE-DEV
 */

'use client';

import { useEffect, useState } from 'react';
import { MessageSquare, Filter } from 'lucide-react';
import { adminGet, adminPatch } from '@/lib/adminApi';

interface Feedback {
  id: string;
  userId: string;
  type: string;
  subject: string;
  message: string;
  status: string;
  createdAt: string;
}

export default function AdminFeedbacksPage() {
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  useEffect(() => {
    fetchFeedbacks();
  }, []);

  const fetchFeedbacks = async () => {
    try {
      const data = await adminGet('/feedback/admin');
      if (data.success) {
        setFeedbacks(data.data.feedbacks);
      }
    } catch (error) {
      console.error('Error fetching feedbacks:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      await adminPatch(`/feedback/admin/${id}`, { status });
      fetchFeedbacks();
    } catch (error) {
      console.error('Error updating feedback:', error);
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'BUG': return 'bg-red-500/20 text-red-400';
      case 'FEATURE': return 'bg-purple-500/20 text-purple-400';
      case 'IMPROVEMENT': return 'bg-blue-500/20 text-blue-400';
      case 'OTHER': return 'bg-neutral-600 text-neutral-300';
      default: return 'bg-neutral-600 text-neutral-300';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PENDING': return 'bg-yellow-500/20 text-yellow-400';
      case 'REVIEWED': return 'bg-blue-500/20 text-blue-400';
      case 'IN_PROGRESS': return 'bg-purple-500/20 text-purple-400';
      case 'RESOLVED': return 'bg-green-500/20 text-green-400';
      case 'CLOSED': return 'bg-neutral-600 text-neutral-300';
      default: return 'bg-neutral-600 text-neutral-300';
    }
  };

  const filteredFeedbacks = feedbacks.filter(f => {
    if (filterType && f.type !== filterType) return false;
    if (filterStatus && f.status !== filterStatus) return false;
    return true;
  });

  return (
    <>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-white">Gestion des feedbacks</h1>
        <p className="mt-2 text-neutral-400">Gérez les retours et suggestions des utilisateurs</p>
      </div>

      {/* Filters */}
      <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-4 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="h-4 w-4 text-neutral-500" />
          <span className="text-sm font-medium text-neutral-300">Filtres</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-4 py-2 bg-neutral-700 border border-neutral-600 rounded-lg text-sm text-white focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none"
          >
            <option value="">Tous les types</option>
            <option value="BUG">Bug</option>
            <option value="FEATURE">Fonctionnalité</option>
            <option value="IMPROVEMENT">Amélioration</option>
            <option value="OTHER">Autre</option>
          </select>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-4 py-2 bg-neutral-700 border border-neutral-600 rounded-lg text-sm text-white focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none"
          >
            <option value="">Tous les statuts</option>
            <option value="PENDING">En attente</option>
            <option value="REVIEWED">Examiné</option>
            <option value="IN_PROGRESS">En cours</option>
            <option value="RESOLVED">Résolu</option>
            <option value="CLOSED">Fermé</option>
          </select>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-4">
          <p className="text-sm text-neutral-400">Total</p>
          <p className="text-2xl font-bold text-white">{feedbacks.length}</p>
        </div>
        <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-4">
          <p className="text-sm text-neutral-400">En attente</p>
          <p className="text-2xl font-bold text-yellow-400">
            {feedbacks.filter(f => f.status === 'PENDING').length}
          </p>
        </div>
        <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-4">
          <p className="text-sm text-neutral-400">En cours</p>
          <p className="text-2xl font-bold text-purple-400">
            {feedbacks.filter(f => f.status === 'IN_PROGRESS').length}
          </p>
        </div>
        <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-4">
          <p className="text-sm text-neutral-400">Résolus</p>
          <p className="text-2xl font-bold text-green-400">
            {feedbacks.filter(f => f.status === 'RESOLVED').length}
          </p>
        </div>
      </div>

      {/* Feedbacks List */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-orange-500 border-r-transparent"></div>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredFeedbacks.length === 0 ? (
            <div className="text-center py-12 rounded-xl border border-neutral-700 bg-neutral-800">
              <MessageSquare className="h-12 w-12 text-neutral-600 mx-auto mb-3" />
              <p className="text-neutral-500">Aucun feedback trouvé</p>
            </div>
          ) : (
            filteredFeedbacks.map((feedback) => (
              <div key={feedback.id} className="bg-neutral-800 rounded-xl border border-neutral-700 p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${getTypeColor(feedback.type)}`}>
                        {feedback.type}
                      </span>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${getStatusColor(feedback.status)}`}>
                        {feedback.status}
                      </span>
                    </div>
                    <h3 className="text-base sm:text-lg font-semibold text-white mb-2">
                      {feedback.subject}
                    </h3>
                    <p className="text-sm text-neutral-400 mb-3">{feedback.message}</p>
                    <p className="text-xs text-neutral-500">
                      {new Date(feedback.createdAt).toLocaleString('fr-FR')}
                    </p>
                  </div>
                  <div className="flex sm:flex-col gap-2">
                    <select
                      value={feedback.status}
                      onChange={(e) => updateStatus(feedback.id, e.target.value)}
                      className="rounded-lg bg-neutral-700 border border-neutral-600 px-3 py-1.5 text-xs font-medium text-white focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none"
                    >
                      <option value="PENDING">En attente</option>
                      <option value="REVIEWED">Examiné</option>
                      <option value="IN_PROGRESS">En cours</option>
                      <option value="RESOLVED">Résolu</option>
                      <option value="CLOSED">Fermé</option>
                    </select>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </>
  );
}
