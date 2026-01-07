# 🚀 Guide de Déploiement NICE-API'HUB

**Author**: NICE-DEV

## Architecture de Production

```
┌─────────────────────────────────────────────────────────────┐
│                         UTILISATEURS                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    VERCEL (Frontend)                         │
│              nice-api-hub.vercel.app                         │
│                     Next.js 15                               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    RENDER (Backend)                          │
│            nice-api-hub-api.onrender.com                     │
│                   Express + Node.js                          │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  MongoDB Atlas  │ │  Redis (Upstash)│ │    GeniusPay    │
│    Database     │ │   Rate Limit    │ │    Payments     │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

---

## 1. Déploiement Backend sur Render

### Étape 1: Créer un compte Render
1. Aller sur [render.com](https://render.com)
2. Se connecter avec GitHub

### Étape 2: Créer un nouveau Web Service
1. Click "New" → "Web Service"
2. Connecter le repo GitHub
3. Configurer:
   - **Name**: `nice-api-hub-api`
   - **Region**: Frankfurt (EU) ou Oregon (US)
   - **Branch**: `main`
   - **Root Directory**: `apps/api`
   - **Runtime**: Node
   - **Build Command**: `npm install && npx prisma generate && npm run build`
   - **Start Command**: `npm start`

### Étape 3: Variables d'environnement
Ajouter dans Render Dashboard → Environment:

```env
NODE_ENV=production
PORT=3001
DATABASE_URL=mongodb+srv://...
REDIS_URL=redis://...  (optionnel, utiliser Upstash)
JWT_SECRET=votre_secret_32_chars_minimum
JWT_EXPIRES_IN=7d
FRONTEND_URL=https://nice-api-hub.vercel.app
GOOGLE_CLIENT_ID=votre_client_id
GOOGLE_CLIENT_SECRET=votre_client_secret
GOOGLE_CALLBACK_URL=https://nice-api-hub-api.onrender.com/auth/google/callback
GENIUSPAY_API_KEY=votre_api_key
GENIUSPAY_API_SECRET=votre_api_secret
GENIUSPAY_WEBHOOK_SECRET=votre_webhook_secret
```

### Étape 4: Déployer
Click "Create Web Service" - Render va automatiquement déployer.

**URL finale**: `https://nice-api-hub-api.onrender.com`

---

## 2. Déploiement Frontend sur Vercel

### Étape 1: Créer un compte Vercel
1. Aller sur [vercel.com](https://vercel.com)
2. Se connecter avec GitHub

### Étape 2: Importer le projet
1. Click "Add New" → "Project"
2. Importer le repo GitHub
3. Configurer:
   - **Framework Preset**: Next.js
   - **Root Directory**: `apps/web`
   - **Build Command**: `npm run build`
   - **Output Directory**: `.next`

### Étape 3: Variables d'environnement
```env
NEXT_PUBLIC_API_URL=https://nice-api-hub-api.onrender.com
```

### Étape 4: Configurer le domaine
1. Aller dans Settings → Domains
2. Le domaine par défaut sera: `nice-api-hub.vercel.app`

### Étape 5: Déployer
Click "Deploy" - Vercel va automatiquement déployer.

**URL finale**: `https://nice-api-hub.vercel.app`

---

## 3. Configuration Google OAuth (Production)

### Mettre à jour Google Cloud Console
1. Aller sur [console.cloud.google.com](https://console.cloud.google.com)
2. APIs & Services → Credentials
3. Modifier le OAuth Client ID
4. Ajouter les URIs autorisés:

**Authorized JavaScript origins:**
```
https://nice-api-hub.vercel.app
https://nice-api-hub-api.onrender.com
```

**Authorized redirect URIs:**
```
https://nice-api-hub-api.onrender.com/auth/google/callback
```

---

## 4. Configuration GeniusPay (Production)

### Webhook URL
Configurer dans le dashboard GeniusPay:
```
https://nice-api-hub-api.onrender.com/payments/webhook
```

---

## 5. Redis (Optionnel mais recommandé)

### Option: Upstash (Gratuit)
1. Créer un compte sur [upstash.com](https://upstash.com)
2. Créer une base Redis
3. Copier l'URL Redis
4. Ajouter dans Render: `REDIS_URL=redis://...`

---

## 6. Vérification Post-Déploiement

### Checklist
- [ ] Backend health check: `https://nice-api-hub-api.onrender.com/health`
- [ ] Frontend accessible: `https://nice-api-hub.vercel.app`
- [ ] Google OAuth fonctionne
- [ ] API endpoints répondent
- [ ] Paiements GeniusPay fonctionnent
- [ ] Admin dashboard accessible

### Test rapide
```bash
# Health check
curl https://nice-api-hub-api.onrender.com/health

# API info
curl https://nice-api-hub-api.onrender.com/
```

---

## 7. Monitoring

### Render
- Dashboard → Logs pour voir les logs en temps réel
- Dashboard → Metrics pour CPU/Memory

### Vercel
- Dashboard → Deployments pour l'historique
- Dashboard → Analytics pour les performances

---

## 8. Mise à jour

### Déploiement automatique
Les deux plateformes déploient automatiquement à chaque push sur `main`.

### Déploiement manuel
- **Render**: Dashboard → Manual Deploy
- **Vercel**: Dashboard → Redeploy

---

## Support

- **Email**: nicebot226@gmail.com
- **Documentation**: `/docs`

---

**Author**: NICE-DEV
