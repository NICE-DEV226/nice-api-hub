# 🚀 Guide de Déploiement NICE-API'HUB

**Author**: NICE-DEV

## Architecture de Production

```
┌─────────────────────────────────────────────────────────────┐
│                         UTILISATEURS                         │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────────┐ ┌─────────────────────────────┐
│     VERCEL (Frontend)       │ │     VERCEL (Backend)        │
│  nice-api-hub.vercel.app    │ │ nice-api-hub-api.vercel.app │
│        Next.js 15           │ │    Express (Serverless)     │
└─────────────────────────────┘ └─────────────────────────────┘
                                              │
              ┌───────────────┬───────────────┼───────────────┐
              ▼               ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────┐ ┌─────────────┐
│  MongoDB Atlas  │ │ Upstash Redis   │ │  GeniusPay  │ │ Google OAuth│
│    Database     │ │  Rate Limit     │ │  Payments   │ │    Auth     │
└─────────────────┘ └─────────────────┘ └─────────────┘ └─────────────┘
```

---

## URLs de Production

| Service | URL |
|---------|-----|
| **Frontend** | `https://nice-api-hub.vercel.app` |
| **Backend API** | `https://nice-api-hub-api.vercel.app` |

---

## 1. Déploiement Backend sur Vercel

### Étape 1: Créer un nouveau projet
1. Va sur [vercel.com](https://vercel.com)
2. Click "Add New" → "Project"
3. Importe le repo `nice-api-hub`

### Étape 2: Configuration
- **Project Name**: `nice-api-hub-api`
- **Framework Preset**: Other
- **Root Directory**: `apps/api`
- **Build Command**: `npm install && npx prisma generate && npm run build`
- **Output Directory**: `dist`
- **Install Command**: `npm install`

### Étape 3: Variables d'environnement
Ajoute ces variables dans Vercel Dashboard → Settings → Environment Variables:

```env
NODE_ENV=production
DATABASE_URL=mongodb+srv://...
REDIS_URL=redis://... (Upstash)
JWT_SECRET=ton_secret_32_chars_minimum
JWT_EXPIRES_IN=7d
FRONTEND_URL=https://nice-api-hub.vercel.app
GOOGLE_CLIENT_ID=ton_client_id
GOOGLE_CLIENT_SECRET=ton_client_secret
GOOGLE_CALLBACK_URL=https://nice-api-hub-api.vercel.app/auth/google/callback
GENIUSPAY_API_KEY=ton_api_key
GENIUSPAY_API_SECRET=ton_api_secret
GENIUSPAY_WEBHOOK_SECRET=ton_webhook_secret
API_KEY_PREFIX=nicedev
```

### Étape 4: Déployer
Click "Deploy"

---

## 2. Déploiement Frontend sur Vercel

### Étape 1: Créer un nouveau projet
1. Click "Add New" → "Project"
2. Importe le même repo `nice-api-hub`

### Étape 2: Configuration
- **Project Name**: `nice-api-hub`
- **Framework Preset**: Next.js
- **Root Directory**: `apps/web`

### Étape 3: Variables d'environnement
```env
NEXT_PUBLIC_API_URL=https://nice-api-hub-api.vercel.app
```

### Étape 4: Déployer
Click "Deploy"

---

## 3. Configuration Google OAuth

### Mettre à jour Google Cloud Console
1. Va sur [console.cloud.google.com](https://console.cloud.google.com)
2. APIs & Services → Credentials
3. Modifie ton OAuth Client ID

**Authorized JavaScript origins:**
```
https://nice-api-hub.vercel.app
https://nice-api-hub-api.vercel.app
```

**Authorized redirect URIs:**
```
https://nice-api-hub-api.vercel.app/auth/google/callback
```

---

## 4. Configuration Redis (Upstash)

### Créer une base Redis gratuite
1. Va sur [upstash.com](https://upstash.com)
2. Crée un compte
3. Create Database → Choisir région proche
4. Copie l'URL Redis (format: `redis://default:xxx@xxx.upstash.io:6379`)
5. Ajoute dans Vercel: `REDIS_URL=redis://...`

---

## 5. Configuration GeniusPay

### Webhook URL
Configure dans le dashboard GeniusPay:
```
https://nice-api-hub-api.vercel.app/payments/webhook
```

---

## 6. Vérification Post-Déploiement

### Checklist
- [ ] Backend health: `https://nice-api-hub-api.vercel.app/health`
- [ ] Frontend: `https://nice-api-hub.vercel.app`
- [ ] Google OAuth login fonctionne
- [ ] API endpoints répondent
- [ ] Paiements GeniusPay fonctionnent

### Test rapide
```bash
# Health check
curl https://nice-api-hub-api.vercel.app/health

# API info
curl https://nice-api-hub-api.vercel.app/
```

---

## 7. Limitations Serverless

⚠️ **Important**: En mode serverless sur Vercel:
- Pas de WebSocket/SSE (les logs realtime admin ne fonctionneront pas)
- Pas de tâches background (le subscription checker ne tourne pas automatiquement)
- Timeout max de 30 secondes par requête

### Solution pour les tâches background
Utilise Vercel Cron Jobs ou un service externe comme:
- **Vercel Cron**: Ajoute dans `vercel.json` pour checker les subscriptions expirées
- **Upstash QStash**: Pour les tâches planifiées

---

## Support

- **Email**: nicebot226@gmail.com

---

**Author**: NICE-DEV
