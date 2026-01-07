/**
 * Payment Success Page
 * Author: NICE-DEV
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function PaymentSuccessPage() {
  const searchParams = useSearchParams();
  const reference = searchParams.get('reference');
  const [status, setStatus] = useState<'loading' | 'success' | 'pending' | 'error'>('loading');
  const [paymentInfo, setPaymentInfo] = useState<any>(null);

  useEffect(() => {
    if (reference) {
      verifyPayment(reference);
    } else {
      setStatus('success'); // Assume success if no reference (webhook already processed)
    }
  }, [reference]);

  const verifyPayment = async (ref: string) => {
    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch(`${API_URL}/payments/verify/${ref}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (data.success) {
        setPaymentInfo(data.data);
        if (data.data.status === 'completed' || data.data.status === 'success') {
          setStatus('success');
        } else if (data.data.status === 'pending') {
          setStatus('pending');
        } else {
          setStatus('error');
        }
      } else {
        setStatus('success'); // Assume success if verification fails (webhook may have processed)
      }
    } catch (error) {
      setStatus('success'); // Assume success on error
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
          {status === 'loading' ? (
            <>
              <div className="mx-auto w-16 h-16 rounded-full bg-neutral-100 flex items-center justify-center mb-6">
                <svg className="animate-spin h-8 w-8 text-primary-600" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-neutral-900 mb-2">Vérification en cours...</h1>
              <p className="text-neutral-600">Nous vérifions votre paiement</p>
            </>
          ) : status === 'success' ? (
            <>
              <div className="mx-auto w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-6">
                <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-neutral-900 mb-2">Paiement réussi !</h1>
              <p className="text-neutral-600 mb-6">
                Votre abonnement a été activé avec succès. Vous pouvez maintenant profiter de toutes les fonctionnalités de votre nouveau plan.
              </p>
              {paymentInfo && (
                <div className="bg-neutral-50 rounded-lg p-4 mb-6 text-left">
                  <p className="text-sm text-neutral-500">Référence</p>
                  <p className="font-mono text-sm text-neutral-900">{paymentInfo.reference}</p>
                </div>
              )}
              <div className="space-y-3">
                <Link
                  href="/dashboard"
                  className="block w-full rounded-lg bg-primary-600 px-4 py-3 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
                >
                  Accéder au Dashboard
                </Link>
                <Link
                  href="/dashboard/api-keys"
                  className="block w-full rounded-lg border border-neutral-300 px-4 py-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
                >
                  Gérer mes clés API
                </Link>
              </div>
            </>
          ) : status === 'pending' ? (
            <>
              <div className="mx-auto w-16 h-16 rounded-full bg-yellow-100 flex items-center justify-center mb-6">
                <svg className="h-8 w-8 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-neutral-900 mb-2">Paiement en attente</h1>
              <p className="text-neutral-600 mb-6">
                Votre paiement est en cours de traitement. Vous recevrez une confirmation par email une fois le paiement validé.
              </p>
              <div className="space-y-3">
                <Link
                  href="/dashboard"
                  className="block w-full rounded-lg bg-primary-600 px-4 py-3 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
                >
                  Retour au Dashboard
                </Link>
              </div>
            </>
          ) : (
            <>
              <div className="mx-auto w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-6">
                <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-neutral-900 mb-2">Erreur de vérification</h1>
              <p className="text-neutral-600 mb-6">
                Nous n&apos;avons pas pu vérifier votre paiement. Si vous avez été débité, contactez notre support.
              </p>
              <div className="space-y-3">
                <Link
                  href="/pricing"
                  className="block w-full rounded-lg bg-primary-600 px-4 py-3 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
                >
                  Réessayer
                </Link>
                <a
                  href="mailto:nicebot226@gmail.com"
                  className="block w-full rounded-lg border border-neutral-300 px-4 py-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
                >
                  Contacter le support
                </a>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-sm text-neutral-500 mt-6">
          Besoin d&apos;aide ? <a href="mailto:nicebot226@gmail.com" className="text-primary-600 hover:underline">nicebot226@gmail.com</a>
        </p>
      </div>
    </div>
  );
}
