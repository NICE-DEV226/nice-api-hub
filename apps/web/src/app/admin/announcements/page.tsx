/**
 * Admin Announcements Management Page
 * Author: NICE-DEV
 */

'use client';

import { useEffect, useState } from 'react';
import { Plus, Megaphone, Trash2, Eye, EyeOff, Pin, Users, Globe, Edit2 } from 'lucide-react';
import { adminGet, adminPost, adminPatch, adminDelete } from '@/lib/adminApi';

interface Announcement {
  id: string;
  title: string;
  message: string;
  type: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR' | 'PROMO';
  target: 'PUBLIC' | 'USERS' | 'ALL';
  bgColor: string | null;
  textColor: string | null;
  isActive: boolean;
  isPinned: boolean;
  dismissible: boolean;
  startsAt: string;
  expiresAt: string | null;
  createdByEmail: string;
  createdAt: string;
}

const TYPE_COLORS = {
  INFO: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  SUCCESS: 'bg-green-500/20 text-green-400 border-green-500/30',
  WARNING: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  ERROR: 'bg-red-500/20 text-red-400 border-red-500/30',
  PROMO: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
};

const TARGET_LABELS = {
  PUBLIC: { label: 'Landing Page', icon: Globe, color: 'text-green-400' },
  USERS: { label: 'Dashboard', icon: Users, color: 'text-blue-400' },
  ALL: { label: 'Partout', icon: Megaphone, color: 'text-orange-400' },
};

export default function AdminAnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  
  // Form state
  const [form, setForm] = useState({
    title: '',
    message: '',
    type: 'INFO' as const,
    target: 'USERS' as const,
    dismissible: true,
    isPinned: false,
    expiresAt: '',
  });

  useEffect(() => {
    fetchAnnouncements();
  }, []);

  const fetchAnnouncements = async () => {
    try {
      const data = await adminGet('/announcements');
      if (data.success) {
        setAnnouncements(data.data.announcements);
      }
    } catch (error) {
      console.error('Error fetching announcements:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingAnnouncement) {
        await adminPatch(`/announcements/${editingAnnouncement.id}`, form);
      } else {
        await adminPost('/announcements', {
          ...form,
          expiresAt: form.expiresAt || null,
        });
      }
      setShowModal(false);
      resetForm();
      fetchAnnouncements();
    } catch (error) {
      console.error('Error saving announcement:', error);
    }
  };

  const toggleActive = async (id: string) => {
    try {
      await adminPost(`/announcements/${id}/toggle`);
      fetchAnnouncements();
    } catch (error) {
      console.error('Error toggling announcement:', error);
    }
  };

  const deleteAnnouncement = async (id: string) => {
    if (!confirm('Supprimer cette annonce ?')) return;
    try {
      await adminDelete(`/announcements/${id}`);
      fetchAnnouncements();
    } catch (error) {
      console.error('Error deleting announcement:', error);
    }
  };

  const openEditModal = (announcement: Announcement) => {
    setEditingAnnouncement(announcement);
    setForm({
      title: announcement.title,
      message: announcement.message,
      type: announcement.type,
      target: announcement.target,
      dismissible: announcement.dismissible,
      isPinned: announcement.isPinned,
      expiresAt: announcement.expiresAt ? announcement.expiresAt.split('T')[0] : '',
    });
    setShowModal(true);
  };

  const resetForm = () => {
    setEditingAnnouncement(null);
    setForm({
      title: '',
      message: '',
      type: 'INFO',
      target: 'USERS',
      dismissible: true,
      isPinned: false,
      expiresAt: '',
    });
  };

  const activeCount = announcements.filter(a => a.isActive).length;

  return (
    <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">Annonces & Bannières</h1>
          <p className="mt-2 text-neutral-400">Gérez les messages affichés sur la plateforme</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowModal(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
        >
          <Plus className="h-5 w-5" />
          Nouvelle annonce
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-4">
          <p className="text-sm text-neutral-400">Total</p>
          <p className="text-2xl font-bold text-white">{announcements.length}</p>
        </div>
        <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-4">
          <p className="text-sm text-neutral-400">Actives</p>
          <p className="text-2xl font-bold text-green-400">{activeCount}</p>
        </div>
        <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-4">
          <p className="text-sm text-neutral-400">Landing Page</p>
          <p className="text-2xl font-bold text-blue-400">
            {announcements.filter(a => a.isActive && ['PUBLIC', 'ALL'].includes(a.target)).length}
          </p>
        </div>
        <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-4">
          <p className="text-sm text-neutral-400">Dashboard</p>
          <p className="text-2xl font-bold text-purple-400">
            {announcements.filter(a => a.isActive && ['USERS', 'ALL'].includes(a.target)).length}
          </p>
        </div>
      </div>

      {/* Announcements List */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-orange-500 border-r-transparent"></div>
        </div>
      ) : (
        <div className="space-y-4">
          {announcements.length === 0 ? (
            <div className="text-center py-12 rounded-xl border border-neutral-700 bg-neutral-800">
              <Megaphone className="h-12 w-12 text-neutral-600 mx-auto mb-3" />
              <p className="text-neutral-500">Aucune annonce</p>
              <button
                onClick={() => setShowModal(true)}
                className="mt-4 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
              >
                Créer une annonce
              </button>
            </div>
          ) : (
            announcements.map((announcement) => {
              const TargetIcon = TARGET_LABELS[announcement.target].icon;
              return (
                <div
                  key={announcement.id}
                  className={`bg-neutral-800 rounded-xl border p-4 sm:p-6 ${
                    announcement.isActive ? 'border-neutral-700' : 'border-neutral-800 opacity-60'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        {announcement.isPinned && (
                          <Pin className="h-4 w-4 text-orange-400" />
                        )}
                        <span className={`px-2 py-0.5 rounded text-xs font-medium border ${TYPE_COLORS[announcement.type]}`}>
                          {announcement.type}
                        </span>
                        <span className={`flex items-center gap-1 text-xs ${TARGET_LABELS[announcement.target].color}`}>
                          <TargetIcon className="h-3 w-3" />
                          {TARGET_LABELS[announcement.target].label}
                        </span>
                        {!announcement.isActive && (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-neutral-700 text-neutral-400">
                            Inactive
                          </span>
                        )}
                      </div>
                      <h3 className="font-semibold text-white text-lg">{announcement.title}</h3>
                      <p className="text-neutral-400 mt-1">{announcement.message}</p>
                      <div className="flex flex-wrap gap-4 mt-3 text-xs text-neutral-500">
                        <span>Par {announcement.createdByEmail}</span>
                        <span>{new Date(announcement.createdAt).toLocaleDateString('fr-FR')}</span>
                        {announcement.expiresAt && (
                          <span className="text-yellow-500">
                            Expire le {new Date(announcement.expiresAt).toLocaleDateString('fr-FR')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex sm:flex-col gap-2">
                      <button
                        onClick={() => toggleActive(announcement.id)}
                        className={`p-2 rounded-lg transition-colors ${
                          announcement.isActive
                            ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                            : 'bg-neutral-700 text-neutral-400 hover:bg-neutral-600'
                        }`}
                        title={announcement.isActive ? 'Désactiver' : 'Activer'}
                      >
                        {announcement.isActive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                      </button>
                      <button
                        onClick={() => openEditModal(announcement)}
                        className="p-2 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors"
                        title="Modifier"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => deleteAnnouncement(announcement.id)}
                        className="p-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                        title="Supprimer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-neutral-800 rounded-2xl border border-neutral-700 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-neutral-700">
              <h2 className="text-xl font-bold text-white">
                {editingAnnouncement ? 'Modifier l\'annonce' : 'Nouvelle annonce'}
              </h2>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-1">Titre</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full px-4 py-2 bg-neutral-700 border border-neutral-600 rounded-lg text-white focus:border-orange-500 outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-1">Message</label>
                <textarea
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-2 bg-neutral-700 border border-neutral-600 rounded-lg text-white focus:border-orange-500 outline-none resize-none"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-neutral-300 mb-1">Type</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value as any })}
                    className="w-full px-4 py-2 bg-neutral-700 border border-neutral-600 rounded-lg text-white focus:border-orange-500 outline-none"
                  >
                    <option value="INFO">Info</option>
                    <option value="SUCCESS">Succès</option>
                    <option value="WARNING">Attention</option>
                    <option value="ERROR">Erreur</option>
                    <option value="PROMO">Promo</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-300 mb-1">Cible</label>
                  <select
                    value={form.target}
                    onChange={(e) => setForm({ ...form, target: e.target.value as any })}
                    className="w-full px-4 py-2 bg-neutral-700 border border-neutral-600 rounded-lg text-white focus:border-orange-500 outline-none"
                  >
                    <option value="PUBLIC">Landing Page (visiteurs)</option>
                    <option value="USERS">Dashboard (utilisateurs)</option>
                    <option value="ALL">Partout</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-1">Date d'expiration (optionnel)</label>
                <input
                  type="date"
                  value={form.expiresAt}
                  onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                  className="w-full px-4 py-2 bg-neutral-700 border border-neutral-600 rounded-lg text-white focus:border-orange-500 outline-none"
                />
              </div>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.dismissible}
                    onChange={(e) => setForm({ ...form, dismissible: e.target.checked })}
                    className="w-4 h-4 rounded border-neutral-600 bg-neutral-700 text-orange-500 focus:ring-orange-500"
                  />
                  <span className="text-sm text-neutral-300">Peut être fermée</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.isPinned}
                    onChange={(e) => setForm({ ...form, isPinned: e.target.checked })}
                    className="w-4 h-4 rounded border-neutral-600 bg-neutral-700 text-orange-500 focus:ring-orange-500"
                  />
                  <span className="text-sm text-neutral-300">Épinglée en haut</span>
                </label>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); resetForm(); }}
                  className="flex-1 px-4 py-2 bg-neutral-700 text-neutral-300 rounded-lg hover:bg-neutral-600 transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
                >
                  {editingAnnouncement ? 'Enregistrer' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
