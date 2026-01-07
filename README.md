<p align="center">
  <img src="apps/web/public/logo.png" alt="NICE-API'HUB Logo" width="120" height="120">
</p>

<h1 align="center">NICE-API'HUB</h1>

<p align="center">
  <strong>Universal Media Downloader API Platform</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#tech-stack">Tech Stack</a> •
  <a href="#getting-started">Getting Started</a> •
  <a href="#api-documentation">API Docs</a> •
  <a href="#deployment">Deployment</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=next.js&logoColor=white" alt="Next.js">
  <img src="https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express">
  <img src="https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white" alt="MongoDB">
  <img src="https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white" alt="Redis">
</p>

---

## ✨ Features

- **20+ Platforms Supported** - TikTok, YouTube, Instagram, Twitter, Facebook, Spotify, and more
- **RESTful API** - Clean, well-documented endpoints
- **Multiple Plans** - FREE, BASIC, PRO, ENTERPRISE with different rate limits
- **API Key Management** - Generate and manage multiple API keys
- **Real-time Analytics** - Track usage, latency, and errors
- **Admin Dashboard** - Complete platform management with PIN security
- **Payment Integration** - GeniusPay (Mobile Money & Cards)
- **Health Monitoring** - Automatic endpoint health tracking
- **Rate Limiting** - Redis-based with per-plan limits

## 🛠 Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 15, React 19, TypeScript, Tailwind CSS |
| **Backend** | Express.js, TypeScript, Node.js |
| **Database** | MongoDB Atlas, Prisma ORM |
| **Cache** | Redis |
| **Auth** | Google OAuth 2.0, JWT |
| **Payments** | GeniusPay |
| **Monorepo** | Turborepo |

## 📁 Project Structure

```
nice-api-hub/
├── apps/
│   ├── api/          # Express backend
│   │   ├── src/
│   │   │   ├── modules/      # Feature modules
│   │   │   ├── middleware/   # Express middleware
│   │   │   ├── services/     # Business logic
│   │   │   └── utils/        # Utilities
│   │   └── prisma/           # Database schema
│   └── web/          # Next.js frontend
│       └── src/
│           ├── app/          # App router pages
│           └── components/   # React components
├── packages/
│   └── database/     # Shared Prisma client
└── docs/             # Documentation
```

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- MongoDB Atlas account
- Redis (local or cloud)
- Google Cloud Console project (for OAuth)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/nice-api-hub.git
cd nice-api-hub

# Install dependencies
npm install

# Setup environment variables
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

# Generate Prisma client
npm run db:generate

# Push database schema
npm run db:push

# Start development servers
npm run dev
```

### Environment Variables

#### Backend (`apps/api/.env`)

```env
# Server
NODE_ENV=development
PORT=3001

# Database
DATABASE_URL=mongodb+srv://...

# Redis
REDIS_URL=redis://localhost:6379

# Google OAuth
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_CALLBACK_URL=http://localhost:3001/auth/google/callback

# JWT
JWT_SECRET=your_super_secret_key
JWT_EXPIRES_IN=7d

# Frontend
FRONTEND_URL=http://localhost:3000

# GeniusPay (Payments)
GENIUSPAY_API_KEY=your_api_key
GENIUSPAY_API_SECRET=your_api_secret
GENIUSPAY_WEBHOOK_SECRET=your_webhook_secret
```

#### Frontend (`apps/web/.env`)

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

## 📖 API Documentation

### Authentication

All API endpoints require an API key in the header:

```bash
curl -H "X-API-Key: nicedev_live_xxxxx" \
  https://api.nice-api-hub.com/api/tiktok/download?url=...
```

### Endpoints

| Platform | Endpoint | Method |
|----------|----------|--------|
| TikTok | `/api/tiktok/download` | GET |
| YouTube | `/api/youtube/download` | GET |
| Instagram | `/api/instagram/download` | GET |
| Twitter | `/api/twitter/download` | GET |
| Facebook | `/api/facebook/download` | GET |
| Spotify | `/api/spotify/download` | GET |
| ... | ... | ... |

### Rate Limits

| Plan | Requests/Day | Requests/Min | API Keys |
|------|--------------|--------------|----------|
| FREE | 100 | 5 | 1 |
| BASIC | 1,000 | 20 | 5 |
| PRO | 10,000 | 100 | 20 |
| ENTERPRISE | Unlimited | Custom | Unlimited |

## 🐳 Docker Deployment

```bash
# Development
docker-compose up -d

# Production
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

## 🔐 Admin Access

1. Login with a Google account that has ADMIN role
2. Navigate to `/admin`
3. Setup your 6-digit PIN on first access
4. PIN is required for each admin session

## 💳 Payment Integration

Payments are handled via GeniusPay supporting:
- Orange Money
- MTN MoMo
- Moov Money
- Wave
- Visa/Mastercard

Webhook URL: `https://your-api-domain.com/payments/webhook`

## 📊 Monitoring

- **Health Check**: `GET /health`
- **API Status**: `GET /status`
- **Admin Dashboard**: `/admin` (authenticated)

## 🤝 Support

- **Email**: nicebot226@gmail.com
- **Documentation**: `/docs`

## 📄 License

MIT © NICE-DEV

---

<p align="center">
  Made with ❤️ by <strong>NICE-DEV</strong>
</p>
