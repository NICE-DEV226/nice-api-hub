/**
 * Payment Error Page
 * Author: NICE-DEV
 */

'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

export default function PaymentErrorPage() {
  const searchParams = useSearchParams();
  const reason = searchParams.get('reason');

  const getErrorMessage = () => {
    switch (reason) {
      case 'cancelled':
        return 'Vous avez annulé le paiement.';
      case 'expired':
        return 'La session de paiement a expiré.';
      case 'declined':
        return 'Le paiement a été refusé par votre banque ou opérateur.';
      case 'insufficient_funds':
        return 'Fonds insuffisants sur votre compte.';
      default:
        return 'Une erreur est survenue lors du paiement.';
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-6">
            <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>

          <h1 className="text-2xl font-bold text-neutral-900 mb-2">Paiement échoué</h1>
          <p className="text-neutral-600 mb-6">{getErrorMessage()}</p>

          <div className="bg-neutral-50 rounded-lg p-4 mb-6 text-left">
            <h3 className="text-sm font-medium text-neutral-900 mb-2">Que faire ?</h3>
            <ul className="text-sm text-neutral-600 space-y-2">
              <li className="flex items-start gap-2">
                <span className="text-primary-600">•</span>
                Vérifiez que vous avez suffisamment de fonds
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary-600">•</span>
                Assurez-vous que votre numéro est correct
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary-600">•</span>
                Essayez un autre moyen de paiement
              </li>
            </ul>
          </div>

          <div className="space-y-3">
            <Link
              href="/pricing"
              className="block w-full rounded-lg bg-primary-600 px-4 py-3 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
            >
              Réessayer le paiement
            </Link>
            <Link
              href="/dashboard"
              className="block w-full rounded-lg border border-neutral-300 px-4 py-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
            >
              Retour au Dashboard
            </Link>
          </div>
        </div>

        <div className="mt-6 text-center">
          <p className="text-sm text-neutral-500 mb-2">
            Vous avez été débité mais le paiement a échoué ?
          </p>
          <a
            href="mailto:nicebot226@gmail.com"
            className="text-sm text-primary-600 hover:underline font-medium"
          >
            Contactez notre support : nicebot226@gmail.com
          </a>
        </div>
      </div>
    </div>
  );
}
