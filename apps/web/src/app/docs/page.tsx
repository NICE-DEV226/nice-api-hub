/**
 * API Documentation Page
 * Author: NICE-DEV
 */

'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const platforms = [
  { name: 'TikTok', slug: 'tiktok' },
  { name: 'YouTube', slug: 'youtube' },
  { name: 'Instagram', slug: 'instagram' },
  { name: 'Facebook', slug: 'facebook' },
  { name: 'Twitter/X', slug: 'twitter' },
  { name: 'Pinterest', slug: 'pinterest' },
  { name: 'Reddit', slug: 'reddit' },
  { name: 'Spotify', slug: 'spotify' },
  { name: 'SoundCloud', slug: 'soundcloud' },
];

type Lang = 'curl' | 'javascript' | 'python' | 'php' | 'go';

const codeExamples: Record<Lang, string> = {
  curl: `curl -X GET "https://api.nice-api-hub.com/api/tiktok/download?url=VIDEO_URL" \\
  -H "Authorization: Bearer $NICE_API_KEY"`,
  javascript: `// npm install axios
const axios = require('axios');

// ⚠️ Ne jamais exposer votre clé API côté client !
// Utilisez une variable d'environnement côté serveur
const API_KEY = process.env.NICE_API_KEY;

async function downloadTikTok(videoUrl) {
  const response = await axios.get(
    'https://api.nice-api-hub.com/api/tiktok/download',
    {
      params: { url: videoUrl },
      headers: { 'Authorization': \`Bearer \${API_KEY}\` }
    }
  );
  return response.data;
}

// Exemple d'utilisation
downloadTikTok('https://tiktok.com/@user/video/123')
  .then(data => console.log(data))
  .catch(err => console.error(err));`,
  python: `import os
import requests

# Chargez votre clé depuis les variables d'environnement
API_KEY = os.environ.get('NICE_API_KEY')

def download_tiktok(video_url):
    response = requests.get(
        'https://api.nice-api-hub.com/api/tiktok/download',
        params={'url': video_url},
        headers={'Authorization': f'Bearer {API_KEY}'}
    )
    return response.json()

# Exemple d'utilisation
result = download_tiktok('https://tiktok.com/@user/video/123')
print(result)`,
  php: `<?php
// Chargez votre clé depuis les variables d'environnement
$apiKey = getenv('NICE_API_KEY');

function downloadTikTok($videoUrl) {
    global $apiKey;
    
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => 'https://api.nice-api-hub.com/api/tiktok/download?url=' . urlencode($videoUrl),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $apiKey
        ]
    ]);
    
    $response = curl_exec($ch);
    curl_close($ch);
    
    return json_decode($response, true);
}

// Exemple d'utilisation
$result = downloadTikTok('https://tiktok.com/@user/video/123');
print_r($result);`,
  go: `package main

import (
    "encoding/json"
    "fmt"
    "net/http"
    "os"
)

func downloadTikTok(videoURL string) (map[string]interface{}, error) {
    apiKey := os.Getenv("NICE_API_KEY")
    
    req, _ := http.NewRequest("GET", 
        "https://api.nice-api-hub.com/api/tiktok/download?url="+videoURL, nil)
    req.Header.Set("Authorization", "Bearer "+apiKey)
    
    client := &http.Client{}
    resp, err := client.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    
    var result map[string]interface{}
    json.NewDecoder(resp.Body).Decode(&result)
    return result, nil
}

func main() {
    result, _ := downloadTikTok("https://tiktok.com/@user/video/123")
    fmt.Println(result)
}`,
};

export default function DocsPage() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [selectedLang, setSelectedLang] = useState<Lang>('curl');
  const [copied, setCopied] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  
  // Playground state
  const [playgroundUrl, setPlaygroundUrl] = useState('');
  const [playgroundPlatform, setPlaygroundPlatform] = useState('tiktok');
  const [playgroundKey, setPlaygroundKey] = useState('');
  const [playgroundResult, setPlaygroundResult] = useState<string | null>(null);
  const [playgroundLoading, setPlaygroundLoading] = useState(false);
  const [playgroundEnv, setPlaygroundEnv] = useState<'dev' | 'prod'>('dev');

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    setIsLoggedIn(!!token);
  }, []);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePlaygroundTest = async () => {
    if (!playgroundUrl || !playgroundKey) {
      setPlaygroundResult(JSON.stringify({ error: 'URL et clé API requises' }, null, 2));
      return;
    }

    // Vérifier que la clé correspond à l'environnement
    const isDevKey = playgroundKey.includes('_dev_') || playgroundKey.includes('_test_');
    const isProdKey = playgroundKey.includes('_live_') || playgroundKey.includes('_prod_');
    
    if (playgroundEnv === 'dev' && isProdKey) {
      setPlaygroundResult(JSON.stringify({ 
        error: 'Vous utilisez une clé de PRODUCTION en mode développement. Changez d\'environnement ou utilisez une clé de développement.' 
      }, null, 2));
      return;
    }
    
    if (playgroundEnv === 'prod' && isDevKey) {
      setPlaygroundResult(JSON.stringify({ 
        error: 'Vous utilisez une clé de DÉVELOPPEMENT en mode production. Changez d\'environnement ou utilisez une clé de production.' 
      }, null, 2));
      return;
    }

    setPlaygroundLoading(true);
    setPlaygroundResult(null);

    try {
      const response = await fetch(
        `${API_URL}/api/${playgroundPlatform}/download?url=${encodeURIComponent(playgroundUrl)}`,
        {
          headers: { Authorization: `Bearer ${playgroundKey}` },
        }
      );
      const data = await response.json();
      setPlaygroundResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setPlaygroundResult(JSON.stringify({ error: 'Erreur de connexion à l\'API' }, null, 2));
    } finally {
      setPlaygroundLoading(false);
    }
  };

  const SidebarContent = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Démarrage</h3>
        <ul className="mt-3 space-y-2">
          <li><a href="#introduction" className="text-sm text-neutral-600 hover:text-primary-600" onClick={() => setMobileSidebarOpen(false)}>Introduction</a></li>
          <li><a href="#authentication" className="text-sm text-neutral-600 hover:text-primary-600" onClick={() => setMobileSidebarOpen(false)}>Authentification</a></li>
          <li><a href="#security" className="text-sm text-neutral-600 hover:text-primary-600" onClick={() => setMobileSidebarOpen(false)}>Sécurité</a></li>
          <li><a href="#rate-limits" className="text-sm text-neutral-600 hover:text-primary-600" onClick={() => setMobileSidebarOpen(false)}>Rate Limits</a></li>
          <li><a href="#errors" className="text-sm text-neutral-600 hover:text-primary-600" onClick={() => setMobileSidebarOpen(false)}>Erreurs</a></li>
        </ul>
      </div>
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Exemples</h3>
        <ul className="mt-3 space-y-2">
          <li><a href="#code-examples" className="text-sm text-neutral-600 hover:text-primary-600" onClick={() => setMobileSidebarOpen(false)}>Code</a></li>
          <li><a href="#playground" className="text-sm text-neutral-600 hover:text-primary-600" onClick={() => setMobileSidebarOpen(false)}>Playground</a></li>
        </ul>
      </div>
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Endpoints</h3>
        <ul className="mt-3 space-y-2">
          {platforms.map((p) => (
            <li key={p.slug}>
              <a href={`#${p.slug}`} className="text-sm text-neutral-600 hover:text-primary-600" onClick={() => setMobileSidebarOpen(false)}>{p.name}</a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="border-b border-neutral-200 bg-white sticky top-0 z-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-primary-600 flex items-center justify-center">
                <span className="text-white font-bold text-sm">N</span>
              </div>
              <span className="font-semibold hidden sm:block">NICE-API&apos;HUB</span>
            </Link>
            
            {/* Desktop Nav */}
            <nav className="hidden md:flex items-center gap-4">
              <Link href="/pricing" className="text-sm text-neutral-600 hover:text-neutral-900">Tarifs</Link>
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

            {/* Mobile Menu Button */}
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

          {/* Mobile Menu */}
          {mobileMenuOpen && (
            <div className="md:hidden py-4 border-t border-neutral-100">
              <div className="flex flex-col gap-2">
                <Link href="/pricing" className="px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-50 rounded-lg" onClick={() => setMobileMenuOpen(false)}>Tarifs</Link>
                {isLoggedIn ? (
                  <Link href="/dashboard" className="px-3 py-2 text-sm font-medium text-primary-600" onClick={() => setMobileMenuOpen(false)}>Dashboard</Link>
                ) : (
                  <Link href="/login" className="px-3 py-2 text-sm font-medium text-primary-600" onClick={() => setMobileMenuOpen(false)}>Commencer</Link>
                )}
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        {/* Mobile Sidebar Toggle */}
        <button
          onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
          className="lg:hidden mb-4 flex items-center gap-2 text-sm font-medium text-neutral-600 hover:text-neutral-900"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
          </svg>
          Navigation
        </button>

        {/* Mobile Sidebar */}
        {mobileSidebarOpen && (
          <div className="lg:hidden mb-6 p-4 rounded-xl border border-neutral-200 bg-white">
            <SidebarContent />
          </div>
        )}

        <div className="lg:grid lg:grid-cols-4 lg:gap-8">
          {/* Desktop Sidebar */}
          <nav className="hidden lg:block">
            <div className="sticky top-24">
              <SidebarContent />
            </div>
          </nav>

          {/* Content */}
          <main className="lg:col-span-3 space-y-12 lg:space-y-16">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-neutral-900">Documentation API</h1>
              <p className="mt-4 text-base lg:text-lg text-neutral-600">
                Guide complet pour intégrer NICE-API&apos;HUB dans vos applications.
              </p>
            </div>

            {/* Introduction */}
            <section id="introduction">
              <h2 className="text-xl sm:text-2xl font-bold text-neutral-900">Introduction</h2>
              <p className="mt-4 text-sm sm:text-base text-neutral-600">
                NICE-API&apos;HUB est une API REST permettant de télécharger des médias depuis +20 plateformes sociales.
              </p>
              <div className="mt-4 rounded-lg bg-neutral-900 p-3 sm:p-4">
                <p className="text-xs text-neutral-400 mb-2">Base URL</p>
                <code className="text-xs sm:text-sm text-green-400 break-all">https://api.nice-api-hub.com</code>
              </div>
            </section>

            {/* Authentication */}
            <section id="authentication">
              <h2 className="text-xl sm:text-2xl font-bold text-neutral-900">Authentification</h2>
              <p className="mt-4 text-sm sm:text-base text-neutral-600">
                Toutes les requêtes nécessitent une clé API dans le header <code className="bg-neutral-100 px-1 rounded text-xs sm:text-sm">Authorization</code>.
              </p>
              <div className="mt-4 rounded-lg bg-neutral-900 p-3 sm:p-4">
                <code className="text-xs sm:text-sm text-neutral-300 break-all">Authorization: Bearer votre_cle_api</code>
              </div>
              <div className="mt-4 p-3 sm:p-4 rounded-lg border border-blue-200 bg-blue-50">
                <p className="text-xs sm:text-sm text-blue-800">
                  <strong>Types de clés :</strong>
                </p>
                <ul className="mt-2 text-xs sm:text-sm text-blue-700 space-y-1">
                  <li>• <code className="bg-blue-100 px-1 rounded">nicedev_dev_xxx</code> - Développement</li>
                  <li>• <code className="bg-blue-100 px-1 rounded">nicedev_live_xxx</code> - Production</li>
                </ul>
              </div>
            </section>

            {/* Security */}
            <section id="security">
              <h2 className="text-xl sm:text-2xl font-bold text-neutral-900">Sécurité</h2>
              <div className="mt-4 p-3 sm:p-4 rounded-lg border border-red-200 bg-red-50">
                <p className="text-xs sm:text-sm font-medium text-red-800">⚠️ Protégez vos clés API</p>
                <ul className="mt-2 text-xs sm:text-sm text-red-700 space-y-1">
                  <li>• Ne jamais exposer côté client</li>
                  <li>• Utilisez des variables d&apos;environnement</li>
                  <li>• Ne commitez jamais dans Git</li>
                </ul>
              </div>
              <div className="mt-4">
                <p className="text-xs sm:text-sm font-medium text-neutral-700 mb-2">Exemple .env :</p>
                <div className="rounded-lg bg-neutral-900 p-3 sm:p-4 overflow-x-auto">
                  <pre className="text-xs sm:text-sm text-neutral-300">{`# .env (ne pas commiter !)
NICE_API_KEY=nicedev_live_xxx

# .gitignore
.env
.env.local`}</pre>
                </div>
              </div>
            </section>

            {/* Rate Limits */}
            <section id="rate-limits">
              <h2 className="text-xl sm:text-2xl font-bold text-neutral-900">Rate Limits</h2>
              <div className="mt-4 overflow-x-auto rounded-lg border border-neutral-200">
                <table className="w-full min-w-[300px]">
                  <thead className="bg-neutral-50">
                    <tr>
                      <th className="px-3 sm:px-4 py-2 sm:py-3 text-left text-xs sm:text-sm font-medium text-neutral-900">Plan</th>
                      <th className="px-3 sm:px-4 py-2 sm:py-3 text-left text-xs sm:text-sm font-medium text-neutral-900">/min</th>
                      <th className="px-3 sm:px-4 py-2 sm:py-3 text-left text-xs sm:text-sm font-medium text-neutral-900">/jour</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200 bg-white">
                    <tr><td className="px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm">FREE</td><td className="px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm">5</td><td className="px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm">100</td></tr>
                    <tr><td className="px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm">BASIC</td><td className="px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm">20</td><td className="px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm">1,000</td></tr>
                    <tr><td className="px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm">PRO</td><td className="px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm">100</td><td className="px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm">10,000</td></tr>
                    <tr><td className="px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm">ENTERPRISE</td><td className="px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm">∞</td><td className="px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm">∞</td></tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* Errors */}
            <section id="errors">
              <h2 className="text-xl sm:text-2xl font-bold text-neutral-900">Gestion des Erreurs</h2>
              <div className="mt-4 rounded-lg bg-neutral-900 p-3 sm:p-4 overflow-x-auto">
                <pre className="text-xs sm:text-sm text-neutral-300">{`{
  "success": false,
  "error": {
    "message": "Rate limit exceeded",
    "code": "RATE_LIMIT_EXCEEDED"
  }
}`}</pre>
              </div>
              <div className="mt-4 overflow-x-auto rounded-lg border border-neutral-200">
                <table className="w-full min-w-[280px]">
                  <thead className="bg-neutral-50">
                    <tr>
                      <th className="px-3 sm:px-4 py-2 sm:py-3 text-left text-xs sm:text-sm font-medium text-neutral-900">Code</th>
                      <th className="px-3 sm:px-4 py-2 sm:py-3 text-left text-xs sm:text-sm font-medium text-neutral-900">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200 bg-white">
                    <tr><td className="px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm font-mono">400</td><td className="px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm">Requête invalide</td></tr>
                    <tr><td className="px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm font-mono">401</td><td className="px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm">Clé API invalide</td></tr>
                    <tr><td className="px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm font-mono">429</td><td className="px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm">Rate limit dépassé</td></tr>
                    <tr><td className="px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm font-mono">500</td><td className="px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm">Erreur serveur</td></tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* Code Examples */}
            <section id="code-examples">
              <h2 className="text-xl sm:text-2xl font-bold text-neutral-900">Exemples de Code</h2>
              <div className="mt-4">
                <div className="flex gap-1 sm:gap-2 border-b border-neutral-200 overflow-x-auto pb-px">
                  {(['curl', 'javascript', 'python', 'php', 'go'] as Lang[]).map((lang) => (
                    <button
                      key={lang}
                      onClick={() => setSelectedLang(lang)}
                      className={`px-2 sm:px-4 py-2 text-xs sm:text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                        selectedLang === lang
                          ? 'border-primary-600 text-primary-600'
                          : 'border-transparent text-neutral-500 hover:text-neutral-700'
                      }`}
                    >
                      {lang === 'curl' ? 'cURL' : lang.charAt(0).toUpperCase() + lang.slice(1)}
                    </button>
                  ))}
                </div>
                <div className="mt-4 relative">
                  <button
                    onClick={() => handleCopy(codeExamples[selectedLang])}
                    className="absolute top-3 right-3 px-2 sm:px-3 py-1 rounded bg-neutral-700 text-xs text-white hover:bg-neutral-600 z-10"
                  >
                    {copied ? '✓' : 'Copier'}
                  </button>
                  <div className="rounded-lg bg-neutral-900 p-3 sm:p-4 overflow-x-auto">
                    <pre className="text-xs sm:text-sm text-neutral-300">
                      <code>{codeExamples[selectedLang]}</code>
                    </pre>
                  </div>
                </div>
              </div>
            </section>

            {/* Playground */}
            <section id="playground">
              <h2 className="text-xl sm:text-2xl font-bold text-neutral-900">API Playground</h2>
              <p className="mt-2 text-sm sm:text-base text-neutral-600">Testez l&apos;API directement depuis cette page.</p>
              
              <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-4 sm:p-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1">Plateforme</label>
                    <select
                      value={playgroundPlatform}
                      onChange={(e) => setPlaygroundPlatform(e.target.value)}
                      className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                    >
                      {platforms.map((p) => (
                        <option key={p.slug} value={p.slug}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1">Environnement</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setPlaygroundEnv('dev')}
                        className={`flex-1 rounded-lg px-2 sm:px-3 py-2 text-xs sm:text-sm font-medium ${
                          playgroundEnv === 'dev'
                            ? 'bg-yellow-100 text-yellow-700 border border-yellow-300'
                            : 'bg-neutral-100 text-neutral-600'
                        }`}
                      >
                        Dev
                      </button>
                      <button
                        onClick={() => setPlaygroundEnv('prod')}
                        className={`flex-1 rounded-lg px-2 sm:px-3 py-2 text-xs sm:text-sm font-medium ${
                          playgroundEnv === 'prod'
                            ? 'bg-green-100 text-green-700 border border-green-300'
                            : 'bg-neutral-100 text-neutral-600'
                        }`}
                      >
                        Prod
                      </button>
                    </div>
                  </div>
                </div>
                
                <div className="mt-4">
                  <label className="block text-sm font-medium text-neutral-700 mb-1">URL du média</label>
                  <input
                    type="text"
                    value={playgroundUrl}
                    onChange={(e) => setPlaygroundUrl(e.target.value)}
                    placeholder="https://tiktok.com/@user/video/123456"
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                  />
                </div>
                
                <div className="mt-4">
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    Clé API ({playgroundEnv === 'dev' ? 'Dev' : 'Prod'})
                  </label>
                  <input
                    type="password"
                    value={playgroundKey}
                    onChange={(e) => setPlaygroundKey(e.target.value)}
                    placeholder={playgroundEnv === 'dev' ? 'nicedev_dev_xxx...' : 'nicedev_live_xxx...'}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
                
                <button
                  onClick={handlePlaygroundTest}
                  disabled={playgroundLoading}
                  className="mt-4 w-full rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {playgroundLoading ? 'Chargement...' : 'Tester l\'API'}
                </button>
                
                {playgroundResult && (
                  <div className="mt-4">
                    <label className="block text-sm font-medium text-neutral-700 mb-1">Réponse</label>
                    <div className="rounded-lg bg-neutral-900 p-3 sm:p-4 overflow-x-auto max-h-64 sm:max-h-96">
                      <pre className="text-xs sm:text-sm text-neutral-300">{playgroundResult}</pre>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* Endpoints */}
            {platforms.map((platform) => (
              <section key={platform.slug} id={platform.slug}>
                <h2 className="text-xl sm:text-2xl font-bold text-neutral-900">{platform.name}</h2>
                <div className="mt-4 rounded-lg border border-neutral-200 bg-white p-3 sm:p-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="rounded bg-green-100 px-2 py-1 text-xs font-medium text-green-700">GET</span>
                    <code className="text-xs sm:text-sm text-neutral-900 break-all">/api/{platform.slug}/download</code>
                  </div>
                </div>
                <div className="mt-4">
                  <h3 className="text-xs sm:text-sm font-medium text-neutral-700">Paramètres</h3>
                  <div className="mt-2 overflow-x-auto rounded-lg border border-neutral-200">
                    <table className="w-full min-w-[280px]">
                      <thead className="bg-neutral-50">
                        <tr>
                          <th className="px-3 sm:px-4 py-2 text-left text-xs font-medium text-neutral-500">Param</th>
                          <th className="px-3 sm:px-4 py-2 text-left text-xs font-medium text-neutral-500">Type</th>
                          <th className="px-3 sm:px-4 py-2 text-left text-xs font-medium text-neutral-500">Description</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white">
                        <tr>
                          <td className="px-3 sm:px-4 py-2 text-xs sm:text-sm font-mono">url</td>
                          <td className="px-3 sm:px-4 py-2 text-xs sm:text-sm">string</td>
                          <td className="px-3 sm:px-4 py-2 text-xs sm:text-sm">URL du média (requis)</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            ))}

            {/* CTA */}
            <section className="rounded-xl bg-primary-600 p-6 sm:p-8 text-center">
              {isLoggedIn ? (
                <>
                  <h2 className="text-xl sm:text-2xl font-bold text-white">Prêt à intégrer ?</h2>
                  <p className="mt-2 text-sm sm:text-base text-primary-100">Accédez à vos clés API.</p>
                  <Link
                    href="/api-keys"
                    className="mt-4 sm:mt-6 inline-block rounded-lg bg-white px-5 sm:px-6 py-2.5 sm:py-3 text-sm font-medium text-primary-600 hover:bg-primary-50"
                  >
                    Mes clés API
                  </Link>
                </>
              ) : (
                <>
                  <h2 className="text-xl sm:text-2xl font-bold text-white">Prêt à commencer ?</h2>
                  <p className="mt-2 text-sm sm:text-base text-primary-100">Créez votre compte gratuitement.</p>
                  <Link
                    href="/login"
                    className="mt-4 sm:mt-6 inline-block rounded-lg bg-white px-5 sm:px-6 py-2.5 sm:py-3 text-sm font-medium text-primary-600 hover:bg-primary-50"
                  >
                    Créer un compte
                  </Link>
                </>
              )}
            </section>
          </main>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-neutral-200 bg-white py-6 sm:py-8 mt-8 sm:mt-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <p className="text-center text-xs sm:text-sm text-neutral-500">© 2025 NICE-DEV. Tous droits réservés.</p>
        </div>
      </footer>
    </div>
  );
}
