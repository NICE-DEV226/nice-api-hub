/**
 * Pricing Page with GeniusPay Integration
 * Author: NICE-DEV
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const plans = [
  {
    id: 'FREE',
    name: 'FREE',
    monthlyPrice: 0,
    yearlyPrice: 0,
    description: 'Pour découvrir et tester',
    features: [
      '100 requêtes / jour',
      '5 requêtes / minute',
      '1 clé API',
      'Toutes les plateformes',
      'Support communautaire',
    ],
    cta: 'Commencer gratuitement',
    popular: false,
  },
  {
    id: 'BASIC',
    name: 'BASIC',
    monthlyPrice: 5000,
    yearlyPrice: 50000,
    description: 'Pour les projets personnels',
    features: [
      '1,000 requêtes / jour',
      '20 requêtes / minute',
      '5 clés API',
      'Toutes les plateformes',
      'Support email',
      'Analytics basiques',
    ],
    cta: 'Choisir Basic',
    popular: false,
  },
  {
    id: 'PRO',
    name: 'PRO',
    monthlyPrice: 15000,
    yearlyPrice: 150000,
    description: 'Pour les applications en production',
    features: [
      '10,000 requêtes / jour',
      '100 requêtes / minute',
      '20 clés API',
      'Toutes les plateformes',
      'Support prioritaire',
      'Analytics avancés',
      'Webhooks',
    ],
    cta: 'Choisir Pro',
    popular: true,
  },
  {
    id: 'ENTERPRISE',
    name: 'ENTERPRISE',
    monthlyPrice: 50000,
    yearlyPrice: 500000,
    description: 'Pour les grandes entreprises',
    features: [
      'Requêtes illimitées',
      'Rate limits personnalisés',
      'Clés API illimitées',
      'Toutes les plateformes',
      'Support dédié 24/7',
      'SLA garanti',
      'API privée',
    ],
    cta: 'Choisir Enterprise',
    popular: false,
  },
];

export default function PricingPage() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentPlan, setCurrentPlan] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    setIsLoggedIn(!!token);
    
    if (token) {
      fetch(`${API_URL}/user/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(r => r.json())
        .then(data => {
          if (data.success) setCurrentPlan(data.data.user.plan);
        })
        .catch(() => {});
    }
  }, []);

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('fr-FR').format(price);
  };

  const handleSubscribe = async (planId: string) => {
    if (!isLoggedIn) {
      window.location.href = '/login?redirect=/pricing';
      return;
    }

    if (planId === 'FREE') return;

    setLoading(planId);
    setError(null);

    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch(`${API_URL}/payments/initiate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          plan: planId,
          billing: billingPeriod,
        }),
      });

      const data = await response.json();

      if (data.success && data.data.checkoutUrl) {
        // Redirect to GeniusPay checkout
        window.location.href = data.data.checkoutUrl;
      } else {
        setError(data.error?.message || 'Erreur lors de l\'initialisation du paiement');
      }
    } catch (err) {
      setError('Erreur de connexion au serveur');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="border-b border-neutral-200 bg-white sticky top-0 z-50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <img src="/logo.png" alt="NICE-API'HUB" className="h-8 w-8 rounded-lg" />
              <span className="font-semibold hidden sm:block">NICE-API&apos;HUB</span>
            </Link>
            
            <nav className="hidden md:flex items-center gap-4">
              <Link href="/docs" className="text-sm text-neutral-600 hover:text-neutral-900">Documentation</Link>
              {isLoggedIn ? (
                <Link href="/dashboard" className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700">
                  Dashboard
                </Link>
              ) : (
                <Link href="/login" className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700">
                  Commencer
                </Link>
              )}
            </nav>

            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg hover:bg-neutral-100"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>

          {mobileMenuOpen && (
            <div className="md:hidden py-4 border-t border-neutral-100">
              <div className="flex flex-col gap-2">
                <Link href="/docs" className="px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-50 rounded-lg">Documentation</Link>
                {isLoggedIn ? (
                  <Link href="/dashboard" className="px-3 py-2 text-sm font-medium text-primary-600">Dashboard</Link>
                ) : (
                  <Link href="/login" className="px-3 py-2 text-sm font-medium text-primary-600">Commencer</Link>
                )}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Hero */}
      <section className="py-12 sm:py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold text-neutral-900">Tarifs simples et transparents</h1>
          <p className="mt-4 text-base sm:text-lg text-neutral-600 max-w-2xl mx-auto">
            Choisissez le plan adapté à vos besoins. Évoluez à tout moment.
          </p>

          {/* Billing Toggle */}
          <div className="mt-8 flex items-center justify-center gap-4">
            <span className={`text-sm ${billingPeriod === 'monthly' ? 'text-neutral-900 font-medium' : 'text-neutral-500'}`}>
              Mensuel
            </span>
            <button
              onClick={() => setBillingPeriod(billingPeriod === 'monthly' ? 'yearly' : 'monthly')}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                billingPeriod === 'yearly' ? 'bg-primary-600' : 'bg-neutral-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  billingPeriod === 'yearly' ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <span className={`text-sm ${billingPeriod === 'yearly' ? 'text-neutral-900 font-medium' : 'text-neutral-500'}`}>
              Annuel
              <span className="ml-1 text-xs text-green-600 font-medium">-17%</span>
            </span>
          </div>
        </div>
      </section>

      {/* Error Message */}
      {error && (
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 mb-6">
          <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-center">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        </div>
      )}

      {/* Plans */}
      <section className="pb-16 sm:pb-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-6 sm:gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {plans.map((plan) => {
              const price = billingPeriod === 'yearly' ? plan.yearlyPrice : plan.monthlyPrice;
              const isCurrentPlan = currentPlan === plan.id;
              const isLoading = loading === plan.id;

              return (
                <div
                  key={plan.id}
                  className={`relative rounded-2xl border bg-white p-6 sm:p-8 ${
                    plan.popular ? 'border-primary-500 shadow-lg ring-1 ring-primary-500' : 'border-neutral-200'
                  }`}
                >
                  {plan.popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="rounded-full bg-primary-600 px-3 py-1 text-xs font-medium text-white">
                        Populaire
                      </span>
                    </div>
                  )}
                  
                  <div className="text-center">
                    <h3 className="text-lg font-semibold text-neutral-900">{plan.name}</h3>
                    <p className="mt-1 text-sm text-neutral-500">{plan.description}</p>
                    <div className="mt-4">
                      {price === 0 ? (
                        <span className="text-3xl sm:text-4xl font-bold text-neutral-900">Gratuit</span>
                      ) : (
                        <>
                          <span className="text-3xl sm:text-4xl font-bold text-neutral-900">
                            {formatPrice(price)}
                          </span>
                          <span className="text-neutral-500"> XOF</span>
                          <span className="text-neutral-400 text-sm">
                            /{billingPeriod === 'yearly' ? 'an' : 'mois'}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <ul className="mt-6 sm:mt-8 space-y-3">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2">
                        <svg className="h-5 w-5 flex-shrink-0 text-green-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="text-sm text-neutral-600">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-6 sm:mt-8">
                    {isCurrentPlan ? (
                      <button
                        disabled
                        className="w-full rounded-lg border border-neutral-300 bg-neutral-100 px-4 py-2.5 text-sm font-medium text-neutral-500 cursor-not-allowed"
                      >
                        Plan actuel
                      </button>
                    ) : plan.id === 'FREE' ? (
                      <Link
                        href="/login"
                        className="block w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-center text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
                      >
                        {plan.cta}
                      </Link>
                    ) : (
                      <button
                        onClick={() => handleSubscribe(plan.id)}
                        disabled={isLoading}
                        className={`w-full rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                          plan.popular
                            ? 'bg-primary-600 text-white hover:bg-primary-700'
                            : 'border border-neutral-300 text-neutral-700 hover:bg-neutral-50'
                        }`}
                      >
                        {isLoading ? (
                          <span className="flex items-center justify-center gap-2">
                            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            Chargement...
                          </span>
                        ) : (
                          plan.cta
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>


      {/* Payment Methods */}
      <section className="border-t border-neutral-200 bg-white py-12 sm:py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-xl sm:text-2xl font-bold text-neutral-900 text-center">Moyens de paiement acceptés</h2>
          <p className="mt-2 text-center text-neutral-500">Payez avec votre méthode préférée via GeniusPay</p>
          
          <div className="mt-8 sm:mt-10">
            {/* Mobile Money */}
            <div className="mb-8">
              <p className="text-sm font-medium text-neutral-500 text-center mb-4">Mobile Money</p>
              <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6">
                <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
                  <div className="h-8 w-8 rounded-full bg-orange-500 flex items-center justify-center">
                    <span className="text-white font-bold text-xs">OM</span>
                  </div>
                  <span className="text-sm font-medium text-neutral-700">Orange Money</span>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
                  <div className="h-8 w-8 rounded-full bg-yellow-400 flex items-center justify-center">
                    <span className="text-black font-bold text-xs">MTN</span>
                  </div>
                  <span className="text-sm font-medium text-neutral-700">MTN MoMo</span>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
                  <div className="h-8 w-8 rounded-full bg-blue-600 flex items-center justify-center">
                    <span className="text-white font-bold text-xs">M</span>
                  </div>
                  <span className="text-sm font-medium text-neutral-700">Moov Money</span>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
                  <div className="h-8 w-8 rounded-full bg-cyan-500 flex items-center justify-center">
                    <span className="text-white font-bold text-xs">W</span>
                  </div>
                  <span className="text-sm font-medium text-neutral-700">Wave</span>
                </div>
              </div>
            </div>

            {/* Cards */}
            <div>
              <p className="text-sm font-medium text-neutral-500 text-center mb-4">Cartes bancaires</p>
              <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6">
                <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
                  <svg className="h-8 w-12" viewBox="0 0 48 32" fill="none">
                    <rect width="48" height="32" rx="4" fill="#1A1F71"/>
                    <path d="M18.5 21.5L20.5 10.5H23.5L21.5 21.5H18.5Z" fill="white"/>
                    <path d="M31 10.5C30.3 10.2 29.2 10 27.8 10C24.5 10 22.2 11.7 22.2 14.1C22.2 15.9 23.8 16.9 25 17.5C26.2 18.1 26.6 18.5 26.6 19.1C26.6 19.9 25.6 20.3 24.7 20.3C23.4 20.3 22.7 20.1 21.6 19.6L21.1 19.4L20.6 22.3C21.4 22.7 22.9 23 24.5 23C28 23 30.2 21.3 30.2 18.8C30.2 17.4 29.3 16.3 27.5 15.4C26.4 14.8 25.7 14.4 25.7 13.8C25.7 13.2 26.4 12.6 27.8 12.6C29 12.6 29.9 12.8 30.5 13.1L30.8 13.2L31.3 10.5H31Z" fill="white"/>
                    <path d="M35.5 10.5H33.2C32.4 10.5 31.8 10.7 31.5 11.5L26.5 21.5H30L30.7 19.5H34.8L35.2 21.5H38.5L35.5 10.5ZM31.7 17.2C32 16.4 33.2 13.3 33.2 13.3C33.2 13.3 33.5 12.5 33.7 12L34 13.2C34 13.2 34.7 16.3 34.9 17.2H31.7Z" fill="white"/>
                    <path d="M16.5 10.5L13.2 18L12.8 16.2C12.2 14.3 10.4 12.2 8.5 11.1L11.5 21.5H15L20 10.5H16.5Z" fill="white"/>
                    <path d="M10.5 10.5H5L5 10.7C9 11.7 11.7 14.2 12.8 16.2L11.6 11.5C11.4 10.7 10.8 10.5 10.5 10.5Z" fill="#F9A533"/>
                  </svg>
                  <span className="text-sm font-medium text-neutral-700">Visa</span>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
                  <svg className="h-8 w-12" viewBox="0 0 48 32" fill="none">
                    <rect width="48" height="32" rx="4" fill="#F5F5F5"/>
                    <circle cx="18" cy="16" r="10" fill="#EB001B"/>
                    <circle cx="30" cy="16" r="10" fill="#F79E1B"/>
                    <path d="M24 8.5C26.4 10.3 28 13 28 16C28 19 26.4 21.7 24 23.5C21.6 21.7 20 19 20 16C20 13 21.6 10.3 24 8.5Z" fill="#FF5F00"/>
                  </svg>
                  <span className="text-sm font-medium text-neutral-700">Mastercard</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-neutral-200 bg-neutral-50 py-12 sm:py-16">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-xl sm:text-2xl font-bold text-neutral-900 text-center">Questions fréquentes</h2>
          <div className="mt-8 space-y-6">
            <div className="rounded-xl border border-neutral-200 bg-white p-5">
              <h3 className="font-medium text-neutral-900">Puis-je changer de plan à tout moment ?</h3>
              <p className="mt-2 text-sm text-neutral-600">
                Oui, vous pouvez upgrader ou downgrader votre plan à tout moment. Les changements prennent effet immédiatement.
              </p>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-white p-5">
              <h3 className="font-medium text-neutral-900">Que se passe-t-il si je dépasse mes limites ?</h3>
              <p className="mt-2 text-sm text-neutral-600">
                Vos requêtes seront temporairement bloquées jusqu&apos;à la réinitialisation de votre quota. Vous recevrez une erreur 429.
              </p>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-white p-5">
              <h3 className="font-medium text-neutral-900">Y a-t-il un engagement ?</h3>
              <p className="mt-2 text-sm text-neutral-600">
                Non, tous nos plans sont sans engagement. Vous pouvez annuler à tout moment.
              </p>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-white p-5">
              <h3 className="font-medium text-neutral-900">Comment fonctionne le paiement Mobile Money ?</h3>
              <p className="mt-2 text-sm text-neutral-600">
                Sélectionnez votre opérateur (Orange, MTN, Moov, Wave), entrez votre numéro et validez le paiement depuis votre téléphone.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-neutral-200 bg-white py-8">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <p className="text-center text-sm text-neutral-500">
            © 2025 NICE-DEV. Tous droits réservés.
          </p>
        </div>
      </footer>
    </div>
  );
}
