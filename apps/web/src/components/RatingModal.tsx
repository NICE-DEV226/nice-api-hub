/**
 * Rating Modal Component
 * Author: NICE-DEV
 */

'use client';

import { useState, useEffect } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function RatingModal({ isOpen, onClose }: Props) {
  const [score, setScore] = useState(0);
  const [hoverScore, setHoverScore] = useState(0);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [existingRating, setExistingRating] = useState<{ score: number; comment: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchExistingRating();
    }
  }, [isOpen]);

  const fetchExistingRating = async () => {
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`${API_URL}/ratings/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success && data.data.rating) {
        setExistingRating(data.data.rating);
        setScore(data.data.rating.score);
        setComment(data.data.rating.comment || '');
      }
    } catch {
      // Ignore
    }
  };

  const handleSubmit = async () => {
    if (score === 0) {
      setError('Veuillez sélectionner une note');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`${API_URL}/ratings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ score, comment }),
      });

      const data = await res.json();
      if (data.success) {
        setSuccess(true);
        setTimeout(() => {
          onClose();
          setSuccess(false);
        }, 2000);
      } else {
        setError(data.error?.message || 'Erreur lors de l\'envoi');
      }
    } catch {
      setError('Erreur de connexion');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6 mx-4">
        {success ? (
          <div className="text-center py-8">
            <div className="mx-auto h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
              <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="mt-4 text-lg font-medium text-neutral-900">Merci pour votre avis !</p>
            <p className="mt-1 text-neutral-500">Il sera visible après modération.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-neutral-900">
                {existingRating ? 'Modifier votre avis' : 'Donner votre avis'}
              </h3>
              <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mt-6 space-y-4">
              {/* Stars */}
              <div className="text-center">
                <p className="text-sm text-neutral-600 mb-3">Comment évaluez-vous NICE-API&apos;HUB ?</p>
                <div className="flex justify-center gap-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      onMouseEnter={() => setHoverScore(star)}
                      onMouseLeave={() => setHoverScore(0)}
                      onClick={() => setScore(star)}
                      className="p-1 transition-transform hover:scale-110"
                    >
                      <svg
                        className={`h-10 w-10 ${
                          star <= (hoverScore || score)
                            ? 'text-yellow-400 fill-yellow-400'
                            : 'text-neutral-300'
                        }`}
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.5}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                        />
                      </svg>
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-sm text-neutral-500">
                  {score === 1 && 'Très insatisfait'}
                  {score === 2 && 'Insatisfait'}
                  {score === 3 && 'Neutre'}
                  {score === 4 && 'Satisfait'}
                  {score === 5 && 'Très satisfait'}
                </p>
              </div>

              {/* Comment */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">
                  Commentaire (optionnel)
                </label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Partagez votre expérience..."
                  rows={3}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none resize-none"
                />
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={onClose}
                  className="flex-1 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  Annuler
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={loading || score === 0}
                  className="flex-1 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {loading ? 'Envoi...' : existingRating ? 'Modifier' : 'Envoyer'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
