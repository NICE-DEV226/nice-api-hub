# Configuration Google OAuth 2.0 pour NICE-API'HUB

## 📋 Guide Étape par Étape

### 1. Accéder à Google Cloud Console

1. Allez sur [Google Cloud Console](https://console.cloud.google.com/)
2. Connectez-vous avec votre compte Google

---

### 2. Créer un Nouveau Projet

1. Cliquez sur le sélecteur de projet en haut
2. Cliquez sur **"Nouveau Projet"**
3. Nom du projet : `NICE-API-HUB`
4. Cliquez sur **"Créer"**
5. Attendez la création et sélectionnez le projet

---

### 3. Configurer l'Écran de Consentement OAuth

1. Dans le menu latéral : **APIs & Services** → **OAuth consent screen**
2. Choisissez **"External"** (pour tous les utilisateurs Google)
3. Cliquez sur **"Créer"**

**Remplissez les informations :**

| Champ | Valeur |
|-------|--------|
| App name | `NICE-API'HUB` |
| User support email | `votre-email@gmail.com` |
| App logo | (optionnel) |
| App domain | `nice-api-hub.com` (ou laissez vide en dev) |
| Developer contact email | `votre-email@gmail.com` |

4. Cliquez sur **"Save and Continue"**

**Scopes (Permissions) :**
1. Cliquez sur **"Add or Remove Scopes"**
2. Sélectionnez :
   - `email` - Voir votre adresse email
   - `profile` - Voir vos informations personnelles
   - `openid` - Vous authentifier
3. Cliquez sur **"Update"** puis **"Save and Continue"**

**Test Users (en mode test) :**
1. Ajoutez votre email comme utilisateur test
2. Cliquez sur **"Save and Continue"**

---

### 4. Créer les Identifiants OAuth 2.0

1. Dans le menu : **APIs & Services** → **Credentials**
2. Cliquez sur **"+ Create Credentials"** → **"OAuth client ID"**

**Configuration :**

| Champ | Valeur |
|-------|--------|
| Application type | `Web application` |
| Name | `NICE-API-HUB Backend` |

**Authorized JavaScript origins :**
```
http://localhost:3000
http://localhost:3001
```

**Authorized redirect URIs (TRÈS IMPORTANT) :**
```
http://localhost:3001/auth/google/callback
```

3. Cliquez sur **"Create"**

---

### 5. Récupérer vos Identifiants

Après création, vous verrez :
- **Client ID** : `123456789-xxxxxxxxx.apps.googleusercontent.com`
- **Client Secret** : `GOCSPX-xxxxxxxxxxxxxxxxx`

**Copiez ces valeurs dans votre fichier `apps/api/.env` :**

```env
GOOGLE_CLIENT_ID=123456789-xxxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxx
GOOGLE_CALLBACK_URL=http://localhost:3001/auth/google/callback
```

---

## 🔧 Configuration pour la Production

Quand vous déployez sur Vercel, ajoutez ces URIs dans Google Console :

**Authorized JavaScript origins :**
```
https://nice-api-hub.com
https://api.nice-api-hub.com
https://nice-api-hub.vercel.app
https://api-nice-api-hub.vercel.app
```

**Authorized redirect URIs :**
```
https://api.nice-api-hub.com/auth/google/callback
https://api-nice-api-hub.vercel.app/auth/google/callback
```

**Mettez à jour votre `.env` de production :**
```env
GOOGLE_CALLBACK_URL=https://api.nice-api-hub.com/auth/google/callback
FRONTEND_URL=https://nice-api-hub.com
```

---

## 🔄 Flux d'Authentification

```
1. Utilisateur clique "Sign in with Google" sur le frontend
   ↓
2. Frontend redirige vers: GET /auth/google
   ↓
3. Backend redirige vers Google OAuth
   ↓
4. Utilisateur se connecte sur Google
   ↓
5. Google redirige vers: GET /auth/google/callback
   ↓
6. Backend crée/met à jour l'utilisateur en DB
   ↓
7. Backend génère JWT tokens
   ↓
8. Backend redirige vers: {FRONTEND_URL}/auth/callback?token=xxx&refresh=xxx
   ↓
9. Frontend stocke les tokens et redirige vers /dashboard
```

---

## ⚠️ Erreurs Courantes

### "redirect_uri_mismatch"
- L'URI de callback dans `.env` ne correspond pas à Google Console
- Vérifiez que c'est **exactement** la même URL (avec ou sans slash final)

### "invalid_client"
- Client ID ou Secret incorrect
- Vérifiez les espaces ou caractères invisibles

### "access_denied"
- L'utilisateur n'est pas dans la liste des testeurs (mode test)
- Ou l'app n'est pas publiée

---

## 📝 Checklist

- [ ] Projet créé dans Google Cloud Console
- [ ] Écran de consentement configuré
- [ ] Scopes `email`, `profile`, `openid` ajoutés
- [ ] Identifiants OAuth créés
- [ ] `http://localhost:3001/auth/google/callback` ajouté comme redirect URI
- [ ] Client ID et Secret copiés dans `.env`
- [ ] Votre email ajouté comme testeur (si en mode test)

---

## 🚀 Test

1. Lancez le backend : `npm run dev:api`
2. Ouvrez : `http://localhost:3001/auth/google`
3. Vous devriez être redirigé vers Google
4. Après connexion, vous serez redirigé vers le frontend

---

**Author:** NICE-DEV
