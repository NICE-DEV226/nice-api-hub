/**
 * Admin Users Management Page
 * Author: NICE-DEV
 */

'use client';

import { useEffect, useState } from 'react';
import { Search, UserX, UserCheck, Trash2, Shield, Crown } from 'lucide-react';
import { adminGet, adminPost, adminPatch, adminDelete } from '@/lib/adminApi';

interface User {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  role: string;
  plan: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string;
  apiKeysCount: number;
  totalRequests: number;
}

interface PlanChangeModal {
  user: User;
  newPlan: string;
}

const PLANS = ['FREE', 'BASIC', 'PRO', 'ENTERPRISE'] as const;

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterPlan, setFilterPlan] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [editingPlan, setEditingPlan] = useState<string | null>(null);
  
  // Confirmation modal state
  const [planChangeModal, setPlanChangeModal] = useState<PlanChangeModal | null>(null);
  const [changeReason, setChangeReason] = useState('');
  const [changingPlan, setChangingPlan] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, [search, filterPlan, filterStatus]);

  const fetchUsers = async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (filterPlan) params.append('plan', filterPlan);
      if (filterStatus) params.append('status', filterStatus);

      const data = await adminGet(`/admin/users?${params}`);
      if (data.success) {
        setUsers(data.data.users);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleUserStatus = async (userId: string, isActive: boolean) => {
    const endpoint = isActive ? 'activate' : 'suspend';
    try {
      await adminPost(`/admin/users/${userId}/${endpoint}`);
      fetchUsers();
    } catch (error) {
      console.error('Error updating user status:', error);
    }
  };

  const openPlanChangeModal = (user: User, newPlan: string) => {
    if (newPlan === user.plan) {
      setEditingPlan(null);
      return;
    }
    setPlanChangeModal({ user, newPlan });
    setChangeReason('');
  };

  const confirmPlanChange = async () => {
    if (!planChangeModal) return;
    
    setChangingPlan(true);
    try {
      await adminPatch(`/admin/users/${planChangeModal.user.id}`, { 
        plan: planChangeModal.newPlan,
        reason: changeReason || null,
      });
      setPlanChangeModal(null);
      setEditingPlan(null);
      setChangeReason('');
      fetchUsers();
    } catch (error) {
      console.error('Error updating user plan:', error);
    } finally {
      setChangingPlan(false);
    }
  };

  const deleteUser = async (userId: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cet utilisateur ?')) return;
    try {
      await adminDelete(`/admin/users/${userId}`);
      fetchUsers();
    } catch (error) {
      console.error('Error deleting user:', error);
    }
  };

  const getPlanColor = (plan: string) => {
    switch (plan) {
      case 'FREE': return 'bg-neutral-600 text-neutral-300';
      case 'BASIC': return 'bg-blue-500/20 text-blue-400';
      case 'PRO': return 'bg-purple-500/20 text-purple-400';
      case 'ENTERPRISE': return 'bg-orange-500/20 text-orange-400';
      default: return 'bg-neutral-600 text-neutral-300';
    }
  };

  const getPlanLimits = (plan: string) => {
    switch (plan) {
      case 'FREE': return '100 req/jour';
      case 'BASIC': return '1 000 req/jour';
      case 'PRO': return '10 000 req/jour';
      case 'ENTERPRISE': return 'Illimité';
      default: return '-';
    }
  };

  return (
    <>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-white">Gestion des utilisateurs</h1>
        <p className="mt-2 text-neutral-400">Gérez les comptes et les permissions</p>
      </div>

      {/* Filters */}
      <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
            <input
              type="text"
              placeholder="Rechercher..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-neutral-700 border border-neutral-600 rounded-lg text-sm text-white placeholder-neutral-500 focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none"
            />
          </div>

          {/* Plan Filter */}
          <select
            value={filterPlan}
            onChange={(e) => setFilterPlan(e.target.value)}
            className="px-4 py-2 bg-neutral-700 border border-neutral-600 rounded-lg text-sm text-white focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none"
          >
            <option value="">Tous les plans</option>
            <option value="FREE">Free</option>
            <option value="BASIC">Basic</option>
            <option value="PRO">Pro</option>
            <option value="ENTERPRISE">Enterprise</option>
          </select>

          {/* Status Filter */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-4 py-2 bg-neutral-700 border border-neutral-600 rounded-lg text-sm text-white focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none"
          >
            <option value="">Tous les statuts</option>
            <option value="active">Actifs</option>
            <option value="suspended">Suspendus</option>
          </select>
        </div>
      </div>

      {/* Users Table */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-orange-500 border-r-transparent"></div>
        </div>
      ) : (
        <div className="bg-neutral-800 rounded-xl border border-neutral-700 overflow-hidden">
          {/* Desktop Table */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full">
              <thead className="bg-neutral-700/50 border-b border-neutral-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-neutral-400 uppercase">Utilisateur</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-neutral-400 uppercase">Plan</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-neutral-400 uppercase">Rôle</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-neutral-400 uppercase">Statut</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-neutral-400 uppercase">API Keys</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-neutral-400 uppercase">Requêtes</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-neutral-400 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-700">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-neutral-700/30">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {user.avatar ? (
                          <img src={user.avatar} alt="" className="h-10 w-10 rounded-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center">
                            <span className="font-semibold text-white text-sm">{user.name.charAt(0)}</span>
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-white">{user.name}</p>
                          <p className="text-xs text-neutral-500">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {editingPlan === user.id ? (
                        <div className="flex items-center gap-2">
                          <select
                            defaultValue={user.plan}
                            onChange={(e) => openPlanChangeModal(user, e.target.value)}
                            className="px-2 py-1 bg-neutral-700 border border-neutral-600 rounded text-xs text-white focus:border-orange-500 outline-none"
                          >
                            {PLANS.map((plan) => (
                              <option key={plan} value={plan}>{plan}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => setEditingPlan(null)}
                            className="text-neutral-500 hover:text-white"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setEditingPlan(user.id)}
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${getPlanColor(user.plan)} hover:opacity-80 transition-opacity`}
                          title={`Cliquer pour changer - ${getPlanLimits(user.plan)}`}
                        >
                          <Crown className="h-3 w-3" />
                          {user.plan}
                        </button>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1">
                        {user.role === 'ADMIN' && <Shield className="h-4 w-4 text-orange-500" />}
                        <span className="text-sm text-neutral-300">{user.role}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                        user.isActive ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                      }`}>
                        {user.isActive ? 'Actif' : 'Suspendu'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-neutral-300">{user.apiKeysCount}</td>
                    <td className="px-6 py-4 text-sm text-neutral-300">{user.totalRequests.toLocaleString()}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleUserStatus(user.id, !user.isActive)}
                          className={`p-2 rounded-lg transition-colors ${
                            user.isActive
                              ? 'hover:bg-red-500/20 text-red-400'
                              : 'hover:bg-green-500/20 text-green-400'
                          }`}
                          title={user.isActive ? 'Suspendre' : 'Activer'}
                        >
                          {user.isActive ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                        </button>
                        <button
                          onClick={() => deleteUser(user.id)}
                          className="p-2 rounded-lg hover:bg-red-500/20 text-red-400 transition-colors"
                          title="Supprimer"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="lg:hidden divide-y divide-neutral-700">
            {users.map((user) => (
              <div key={user.id} className="p-4">
                <div className="flex items-start gap-3 mb-3">
                  {user.avatar ? (
                    <img src={user.avatar} alt="" className="h-12 w-12 rounded-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="h-12 w-12 rounded-full bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center">
                      <span className="font-semibold text-white">{user.name.charAt(0)}</span>
                    </div>
                  )}
                  <div className="flex-1">
                    <p className="font-medium text-white">{user.name}</p>
                    <p className="text-sm text-neutral-500">{user.email}</p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <button
                        onClick={() => setEditingPlan(editingPlan === user.id ? null : user.id)}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${getPlanColor(user.plan)}`}
                      >
                        <Crown className="h-3 w-3" />
                        {user.plan}
                      </button>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        user.isActive ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                      }`}>
                        {user.isActive ? 'Actif' : 'Suspendu'}
                      </span>
                      {user.role === 'ADMIN' && (
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-orange-500/20 text-orange-400">
                          <Shield className="h-3 w-3" /> Admin
                        </span>
                      )}
                    </div>
                    {/* Plan selector for mobile */}
                    {editingPlan === user.id && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {PLANS.map((plan) => (
                          <button
                            key={plan}
                            onClick={() => openPlanChangeModal(user, plan)}
                            className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                              user.plan === plan 
                                ? 'bg-orange-500 text-white' 
                                : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                            }`}
                          >
                            {plan}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-neutral-500 mb-3">
                  <span>{user.apiKeysCount} clés API</span>
                  <span>{user.totalRequests.toLocaleString()} requêtes</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => toggleUserStatus(user.id, !user.isActive)}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                      user.isActive
                        ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                        : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                    }`}
                  >
                    {user.isActive ? 'Suspendre' : 'Activer'}
                  </button>
                  <button
                    onClick={() => deleteUser(user.id)}
                    className="px-3 py-2 rounded-lg bg-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/30 transition-colors"
                  >
                    Supprimer
                  </button>
                </div>
              </div>
            ))}
          </div>

          {users.length === 0 && (
            <div className="text-center py-12">
              <p className="text-neutral-500">Aucun utilisateur trouvé</p>
            </div>
          )}
        </div>
      )}

      {/* Plan Change Confirmation Modal */}
      {planChangeModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-neutral-800 rounded-2xl border border-neutral-700 w-full max-w-md">
            <div className="p-6 border-b border-neutral-700">
              <h2 className="text-xl font-bold text-white">Confirmer le changement de plan</h2>
            </div>
            <div className="p-6">
              {/* User Info */}
              <div className="flex items-center gap-3 mb-6 p-4 bg-neutral-700/50 rounded-lg">
                {planChangeModal.user.avatar ? (
                  <img 
                    src={planChangeModal.user.avatar} 
                    alt="" 
                    className="h-12 w-12 rounded-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="h-12 w-12 rounded-full bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center">
                    <span className="font-medium text-white">{planChangeModal.user.name.charAt(0)}</span>
                  </div>
                )}
                <div>
                  <p className="font-medium text-white">{planChangeModal.user.name}</p>
                  <p className="text-sm text-neutral-400">{planChangeModal.user.email}</p>
                </div>
              </div>

              {/* Plan Change Display */}
              <div className="flex items-center justify-center gap-4 mb-6">
                <div className="text-center">
                  <p className="text-xs text-neutral-500 mb-1">Actuel</p>
                  <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium ${getPlanColor(planChangeModal.user.plan)}`}>
                    <Crown className="h-4 w-4" />
                    {planChangeModal.user.plan}
                  </span>
                </div>
                <div className="text-2xl text-neutral-500">→</div>
                <div className="text-center">
                  <p className="text-xs text-neutral-500 mb-1">Nouveau</p>
                  <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium ${getPlanColor(planChangeModal.newPlan)}`}>
                    <Crown className="h-4 w-4" />
                    {planChangeModal.newPlan}
                  </span>
                </div>
              </div>

              {/* Reason Input */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-neutral-300 mb-2">
                  Raison du changement (optionnel)
                </label>
                <textarea
                  value={changeReason}
                  onChange={(e) => setChangeReason(e.target.value)}
                  placeholder="Ex: Cadeau, promotion, partenariat..."
                  rows={2}
                  className="w-full px-4 py-2 bg-neutral-700 border border-neutral-600 rounded-lg text-white placeholder-neutral-500 focus:border-orange-500 outline-none resize-none"
                />
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setPlanChangeModal(null);
                    setEditingPlan(null);
                    setChangeReason('');
                  }}
                  className="flex-1 px-4 py-2.5 bg-neutral-700 text-neutral-300 rounded-lg hover:bg-neutral-600 transition-colors"
                >
                  Annuler
                </button>
                <button
                  onClick={confirmPlanChange}
                  disabled={changingPlan}
                  className="flex-1 px-4 py-2.5 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {changingPlan ? 'Modification...' : 'Confirmer'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
