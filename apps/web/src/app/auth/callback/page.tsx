/**
 * OAuth Callback Page
 * Author: NICE-DEV
 */

'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const token = searchParams.get('token');
    const refresh = searchParams.get('refresh');
    const error = searchParams.get('error');

    if (error) {
      router.push(`/login?error=${error}`);
      return;
    }

    if (token && refresh) {
      // Store tokens
      localStorage.setItem('accessToken', token);
      localStorage.setItem('refreshToken', refresh);
      
      // Redirect to dashboard
      router.push('/dashboard');
    } else {
      router.push('/login?error=no_token');
    }
  }, [router, searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50">
      <div className="text-center">
        <div className="h-12 w-12 mx-auto rounded-xl bg-primary-600 flex items-center justify-center animate-pulse">
          <span className="text-white font-bold text-xl">N</span>
        </div>
        <p className="mt-4 text-neutral-600">Connexion en cours...</p>
      </div>
    </div>
  );
}

export default function CallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-neutral-50">
        <div className="text-center">
          <div className="h-12 w-12 mx-auto rounded-xl bg-primary-600 flex items-center justify-center animate-pulse">
            <span className="text-white font-bold text-xl">N</span>
          </div>
          <p className="mt-4 text-neutral-600">Chargement...</p>
        </div>
      </div>
    }>
      <CallbackContent />
    </Suspense>
  );
}
