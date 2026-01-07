/**
 * API Keys Management Page
 * Author: NICE-DEV
 */

'use client';

import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { api } from '@/lib/api';
import { copyToClipboard, formatDate } from '@/lib/utils';

interface ApiKey {
  id: string;
  name: string;
  keyPreview: string;
  key?: string;
  environment: string;
  isActive: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export default function ApiKeysPage() {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyEnv, setNewKeyEnv] = useState('DEVELOPMENT');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchKeys = async () => {
    const res = await api.getApiKeys();
    if (res.success) setApiKeys(res.data?.apiKeys || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchKeys();
  }, []);

  const handleCreate = async () => {
    if (!newKeyName.trim()) return;
    const res = await api.createApiKey({ name: newKeyName, environment: newKeyEnv });
    if (res.success) {
      setCreatedKey(res.data.apiKey.key);
      setNewKeyName('');
      setShowCreate(false);
      fetchKeys();
    }
  };

  const handleCopy = async (key: string) => {
    await copyToClipboard(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = async (id: string) => {
    if (!confirm('Êtes-vous sûr de vouloir révoquer cette clé ?')) return;
    await api.revokeApiKey(id);
    fetchKeys();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette clé ?')) return;
    await api.deleteApiKey(id);
    fetchKeys();
  };

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 lg:p-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-neutral-900">Clés API</h1>
            <p className="mt-1 text-sm text-neutral-500">Gérez vos clés d&apos;accès à l&apos;API.</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="w-full sm:w-auto rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
          >
            + Nouvelle clé
          </button>
        </div>

        {/* Created Key Alert */}
        {createdKey && (
          <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-3 sm:p-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 h-8 w-8 rounded-full bg-green-100 items-center justify-center hidden sm:flex">
                <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-green-800 text-sm sm:text-base">Clé créée avec succès !</p>
                <p className="mt-1 text-xs sm:text-sm text-green-700">Copiez cette clé maintenant, elle ne sera plus affichée.</p>
                <div className="mt-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <code className="flex-1 rounded-lg bg-white px-3 py-2 text-xs sm:text-sm font-mono text-green-900 border border-green-200 break-all">
                    {createdKey}
                  </code>
                  <button
                    onClick={() => handleCopy(createdKey)}
                    className="flex-shrink-0 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
                  >
                    {copied ? '✓ Copié' : 'Copier'}
                  </button>
                </div>
              </div>
              <button
                onClick={() => setCreatedKey(null)}
                className="flex-shrink-0 text-green-500 hover:text-green-700"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Create Modal */}
        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50" onClick={() => setShowCreate(false)} />
            <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-4 sm:p-6">
              <h3 className="text-lg font-semibold text-neutral-900">Créer une clé API</h3>
              <div className="mt-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-neutral-700">Nom</label>
                  <input
                    type="text"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="Ex: Mon App Mobile"
                    className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700">Environnement</label>
                  <select
                    value={newKeyEnv}
                    onChange={(e) => setNewKeyEnv(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none"
                  >
                    <option value="DEVELOPMENT">Development (test)</option>
                    <option value="PRODUCTION">Production (live)</option>
                  </select>
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setShowCreate(false)}
                    className="flex-1 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={!newKeyName.trim()}
                    className="flex-1 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Créer
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Keys List */}
        <div className="mt-6 rounded-xl border border-neutral-200 bg-white overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-neutral-500">Chargement...</div>
          ) : apiKeys.length === 0 ? (
            <div className="p-8 sm:p-12 text-center">
              <div className="mx-auto h-12 w-12 rounded-full bg-neutral-100 flex items-center justify-center">
                <svg className="h-6 w-6 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
              </div>
              <p className="mt-4 font-medium text-neutral-900">Aucune clé API</p>
              <p className="mt-1 text-sm text-neutral-500">Créez votre première clé pour commencer.</p>
              <button
                onClick={() => setShowCreate(true)}
                className="mt-4 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
              >
                Créer une clé
              </button>
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
                      <th className="px-4 lg:px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase">Créée</th>
                      <th className="px-4 lg:px-6 py-3 text-right text-xs font-medium text-neutral-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {apiKeys.map((key) => (
                      <tr key={key.id} className="hover:bg-neutral-50">
                        <td className="px-4 lg:px-6 py-4 text-sm font-medium text-neutral-900">{key.name}</td>
                        <td className="px-4 lg:px-6 py-4 text-sm font-mono text-neutral-500">{key.keyPreview}</td>
                        <td className="px-4 lg:px-6 py-4">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            key.environment === 'PRODUCTION' 
                              ? 'bg-green-100 text-green-700' 
                              : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            {key.environment === 'PRODUCTION' ? 'Prod' : 'Dev'}
                          </span>
                        </td>
                        <td className="px-4 lg:px-6 py-4">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            key.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {key.isActive ? 'Active' : 'Révoquée'}
                          </span>
                        </td>
                        <td className="px-4 lg:px-6 py-4 text-sm text-neutral-500">{formatDate(key.createdAt)}</td>
                        <td className="px-4 lg:px-6 py-4 text-right">
                          <div className="flex justify-end gap-3">
                            {key.isActive && (
                              <button
                                onClick={() => handleRevoke(key.id)}
                                className="text-sm text-yellow-600 hover:text-yellow-700"
                              >
                                Révoquer
                              </button>
                            )}
                            <button
                              onClick={() => handleDelete(key.id)}
                              className="text-sm text-red-600 hover:text-red-700"
                            >
                              Supprimer
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden divide-y divide-neutral-200">
                {apiKeys.map((key) => (
                  <div key={key.id} className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-neutral-900">{key.name}</p>
                        <p className="mt-1 text-xs font-mono text-neutral-500 truncate">{key.keyPreview}</p>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          key.environment === 'PRODUCTION' 
                            ? 'bg-green-100 text-green-700' 
                            : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {key.environment === 'PRODUCTION' ? 'Prod' : 'Dev'}
                        </span>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          key.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {key.isActive ? 'Active' : 'Révoquée'}
                        </span>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <p className="text-xs text-neutral-500">{formatDate(key.createdAt)}</p>
                      <div className="flex gap-3">
                        {key.isActive && (
                          <button
                            onClick={() => handleRevoke(key.id)}
                            className="text-xs text-yellow-600 hover:text-yellow-700"
                          >
                            Révoquer
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(key.id)}
                          className="text-xs text-red-600 hover:text-red-700"
                        >
                          Supprimer
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Info */}
        <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-4 sm:p-6">
          <h3 className="font-medium text-neutral-900 text-sm sm:text-base">Comment utiliser votre clé API</h3>
          <p className="mt-2 text-xs sm:text-sm text-neutral-500">
            Incluez votre clé dans le header Authorization de chaque requête.
          </p>
          <div className="mt-4 rounded-lg bg-neutral-900 p-3 sm:p-4 overflow-x-auto">
            <pre className="text-xs sm:text-sm text-neutral-300">
              <code>{`curl -X GET "https://api.nice-api-hub.com/api/tiktok/download?url=VIDEO_URL" \\
  -H "Authorization: Bearer VOTRE_CLE_API"`}</code>
            </pre>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
