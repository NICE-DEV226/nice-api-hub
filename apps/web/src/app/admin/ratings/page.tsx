/**
 * Admin Ratings Management Page
 * Author: NICE-DEV
 */

'use client';

import { useEffect, useState } from 'react';
import { Star, Trash2, Check, X } from 'lucide-react';
import { adminGet, adminPatch, adminDelete } from '@/lib/adminApi';

interface Rating {
  id: string;
  userId: string;
  score: number;
  comment: string | null;
  isPublic: boolean;
  isApproved: boolean;
  createdAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatar: string | null;
  } | null;
}

export default function AdminRatingsPage() {
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterApproval, setFilterApproval] = useState('');

  useEffect(() => {
    fetchRatings();
  }, []);

  const fetchRatings = async () => {
    try {
      const data = await adminGet('/ratings/admin');
      if (data.success) {
        setRatings(data.data.ratings);
      }
    } catch (error) {
      console.error('Error fetching ratings:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleApproval = async (id: string, isApproved: boolean) => {
    try {
      await adminPatch(`/ratings/admin/${id}`, { isApproved });
      fetchRatings();
    } catch (error) {
      console.error('Error updating rating:', error);
    }
  };

  const deleteRating = async (id: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cet avis ?')) return;
    try {
      await adminDelete(`/ratings/admin/${id}`);
      fetchRatings();
    } catch (error) {
      console.error('Error deleting rating:', error);
    }
  };

  const renderStars = (score: number) => (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`h-5 w-5 ${star <= score ? 'text-yellow-400 fill-yellow-400' : 'text-neutral-600'}`}
        />
      ))}
    </div>
  );

  const filteredRatings = ratings.filter(r => {
    if (filterApproval === 'approved' && !r.isApproved) return false;
    if (filterApproval === 'pending' && r.isApproved) return false;
    return true;
  });

  const avgScore = ratings.length > 0
    ? (ratings.reduce((sum, r) => sum + r.score, 0) / ratings.length).toFixed(1)
    : '0.0';

  return (
    <>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-white">Gestion des avis</h1>
        <p className="mt-2 text-neutral-400">Modérez les avis des utilisateurs</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-4">
          <p className="text-sm text-neutral-400">Total</p>
          <p className="text-2xl font-bold text-white">{ratings.length}</p>
        </div>
        <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-4">
          <p className="text-sm text-neutral-400">Note moyenne</p>
          <div className="flex items-center gap-2">
            <p className="text-2xl font-bold text-yellow-400">{avgScore}</p>
            <Star className="h-5 w-5 text-yellow-400 fill-yellow-400" />
          </div>
        </div>
        <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-4">
          <p className="text-sm text-neutral-400">Approuvés</p>
          <p className="text-2xl font-bold text-green-400">
            {ratings.filter(r => r.isApproved).length}
          </p>
        </div>
        <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-4">
          <p className="text-sm text-neutral-400">En attente</p>
          <p className="text-2xl font-bold text-yellow-400">
            {ratings.filter(r => !r.isApproved).length}
          </p>
        </div>
      </div>

      {/* Filter */}
      <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-4 mb-6">
        <select
          value={filterApproval}
          onChange={(e) => setFilterApproval(e.target.value)}
          className="w-full sm:w-auto px-4 py-2 bg-neutral-700 border border-neutral-600 rounded-lg text-sm text-white focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none"
        >
          <option value="">Tous les avis</option>
          <option value="approved">Approuvés</option>
          <option value="pending">En attente</option>
        </select>
      </div>

      {/* Ratings List */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-orange-500 border-r-transparent"></div>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredRatings.length === 0 ? (
            <div className="text-center py-12 rounded-xl border border-neutral-700 bg-neutral-800">
              <Star className="h-12 w-12 text-neutral-600 mx-auto mb-3" />
              <p className="text-neutral-500">Aucun avis trouvé</p>
            </div>
          ) : (
            filteredRatings.map((rating) => (
              <div key={rating.id} className="bg-neutral-800 rounded-xl border border-neutral-700 p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                  <div className="flex-1">
                    {/* User Info */}
                    <div className="flex items-center gap-3 mb-4">
                      {rating.user?.avatar ? (
                        <img 
                          src={rating.user.avatar} 
                          alt={rating.user.name} 
                          className="h-10 w-10 rounded-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center">
                          <span className="font-medium text-white text-sm">
                            {rating.user?.name?.charAt(0) || '?'}
                          </span>
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-white">{rating.user?.name || 'Utilisateur'}</p>
                        <p className="text-xs text-neutral-500">{rating.user?.email}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3 mb-3">
                      {renderStars(rating.score)}
                      {rating.isApproved ? (
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-green-500/20 text-green-400">
                          <Check className="h-3 w-3" /> Approuvé
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-yellow-500/20 text-yellow-400">
                          <X className="h-3 w-3" /> En attente
                        </span>
                      )}
                    </div>
                    {rating.comment && (
                      <p className="text-sm text-neutral-300 mb-3">&ldquo;{rating.comment}&rdquo;</p>
                    )}
                    <p className="text-xs text-neutral-500">
                      {new Date(rating.createdAt).toLocaleString('fr-FR')}
                    </p>
                  </div>
                  <div className="flex sm:flex-col gap-2">
                    <button
                      onClick={() => toggleApproval(rating.id, !rating.isApproved)}
                      className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
                        rating.isApproved
                          ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30'
                          : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                      }`}
                    >
                      {rating.isApproved ? 'Retirer' : 'Approuver'}
                    </button>
                    <button
                      onClick={() => deleteRating(rating.id)}
                      className="px-4 py-2 rounded-lg bg-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/30 transition-colors flex items-center justify-center"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
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
