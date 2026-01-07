# NICE-API'HUB Architecture Documentation
**Author: NICE-DEV**

## Overview

NICE-API'HUB is a professional API platform built with a modern, scalable, and maintainable architecture. This document outlines the complete system architecture, design decisions, and best practices.

## Technology Stack

### Frontend
- **Framework**: Next.js 15.1.3 (App Router)
- **Language**: TypeScript 5.7.2
- **UI Library**: React 19.0.0
- **Styling**: Tailwind CSS 3.4.17
- **Components**: Radix UI (accessible, unstyled components)
- **Charts**: Recharts 2.15.0
- **Animations**: Framer Motion 11.15.0
- **Icons**: Lucide React 0.469.0

### Backend
- **Runtime**: Node.js 18+
- **Framework**: Express 4.21.2
- **Language**: TypeScript 5.7.2
- **ORM**: Prisma 6.2.1
- **Database**: MongoDB (Atlas)
- **Cache**: Redis (ioredis 5.4.2)
- **Authentication**: Passport.js (Google OAuth 2.0)
- **Validation**: Zod 3.24.1
- **Logging**: Winston 3.17.0

### DevOps
- **Monorepo**: Turborepo 2.3.0
- **Package Manager**: npm
- **Containerization**: Docker + Docker Compose
- **Deployment**: Vercel (frontend + backend)

## Project Structure

```
nice-api-hub/
├── apps/
│   ├── api/                          # Backend API
│   │   ├── src/
│   │   │   ├── config/               # Configuration files
│   │   │   │   └── passport.ts       # Google OAuth config
│   │   │   ├── lib/                  # Shared libraries
│   │   │   │   ├── prisma.ts         # Prisma client
│   │   │   │   └── redis.ts          # Redis client
│   │   │   ├── middleware/           # Express middleware
│   │   │   │   ├── requireAuth.ts    # Auth middleware
│   │   │   │   ├── apiKeyAuth.ts     # API key validation
│   │   │   │   ├── rateLimiter.ts    # Rate limiting
│   │   │   │   ├── latencyTracker.ts # Latency monitoring
│   │   │   │   ├── errorHandler.ts   # Error handling
│   │   │   │   └── notFoundHandler.ts
│   │   │   ├── modules/              # Feature modules
│   │   │   │   ├── auth/             # Authentication
│   │   │   │   │   ├── auth.routes.ts
│   │   │   │   │   └── auth.controller.ts
│   │   │   │   ├── user/             # User management
│   │   │   │   │   ├── user.routes.ts
│   │   │   │   │   └── user.controller.ts
│   │   │   │   ├── api-keys/         # API key management
│   │   │   │   │   ├── apiKey.routes.ts
│   │   │   │   │   ├── apiKey.controller.ts
│   │   │   │   │   └── apiKey.service.ts
│   │   │   │   ├── admin/            # Admin dashboard
│   │   │   │   │   ├── admin.routes.ts
│   │   │   │   │   └── admin.controller.ts
│   │   │   │   ├── feedback/         # User feedback
│   │   │   │   │   ├── feedback.routes.ts
│   │   │   │   │   └── feedback.controller.ts
│   │   │   │   ├── rating/           # User ratings
│   │   │   │   │   ├── rating.routes.ts
│   │   │   │   │   └── rating.controller.ts
│   │   │   │   └── download/         # Download APIs
│   │   │   │       ├── download.routes.ts
│   │   │   │       └── controllers/
│   │   │   │           ├── tiktok.controller.ts
│   │   │   │           ├── youtube.controller.ts
│   │   │   │           └── ... (19 platforms)
│   │   │   ├── types/                # TypeScript types
│   │   │   ├── utils/                # Utility functions
│   │   │   │   ├── jwt.ts            # JWT helpers
│   │   │   │   ├── logger.ts         # Winston logger
│   │   │   │   └── hash.ts           # Hashing utilities
│   │   │   ├── app.ts                # Express app setup
│   │   │   └── index.ts              # Entry point
│   │   ├── prisma/
│   │   │   └── schema.prisma         # Database schema
│   │   ├── scripts/
│   │   │   └── set-admin.ts          # Admin setup script
│   │   ├── .env                      # Environment variables
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vercel.json
│   │
│   └── web/                          # Frontend
│       ├── src/
│       │   ├── app/                  # Next.js App Router
│       │   │   ├── (auth)/           # Auth pages
│       │   │   │   └── login/
│       │   │   ├── (dashboard)/      # Dashboard pages
│       │   │   │   ├── dashboard/
│       │   │   │   ├── api-keys/
│       │   │   │   ├── docs/
│       │   │   │   └── admin/        # Admin pages
│       │   │   │       ├── page.tsx           # Overview
│       │   │   │       ├── users/page.tsx     # Users
│       │   │   │       ├── analytics/page.tsx # Analytics
│       │   │   │       ├── monitoring/page.tsx# Monitoring
│       │   │   │       ├── feedbacks/page.tsx # Feedbacks
│       │   │   │       └── ratings/page.tsx   # Ratings
│       │   │   ├── pricing/
│       │   │   ├── layout.tsx
│       │   │   └── page.tsx          # Landing page
│       │   ├── components/           # React components
│       │   │   ├── DashboardLayout.tsx
│       │   │   ├── AdminLayout.tsx
│       │   │   ├── FeedbackModal.tsx
│       │   │   ├── RatingModal.tsx
│       │   │   └── PlatformIcons.tsx
│       │   └── styles/
│       ├── public/
│       ├── .env
│       ├── Dockerfile
│       ├── next.config.js
│       ├── package.json
│       ├── tailwind.config.ts
│       └── tsconfig.json
│
├── packages/
│   └── database/                     # Shared database package
│       ├── prisma/
│       │   └── schema.prisma
│       └── package.json
│
├── docs/
│   ├── GOOGLE_OAUTH_SETUP.md        # OAuth setup guide
│   ├── ADMIN_DASHBOARD.md           # Admin documentation
│   └── ARCHITECTURE.md              # This file
│
├── docker-compose.yml
├── turbo.json
├── package.json
└── README.md
```

## Architecture Principles

### 1. Separation of Concerns
- **Frontend**: Presentation layer, user interactions
- **Backend**: Business logic, data access, external APIs
- **Database**: Data persistence
- **Cache**: Performance optimization

### 2. Modular Design
- Each feature is a self-contained module
- Clear boundaries between modules
- Easy to add, remove, or modify features

### 3. Scalability
- Horizontal scaling ready (stateless backend)
- Database indexing for performance
- Redis caching for rate limiting
- Pagination on all list endpoints

### 4. Security
- JWT-based authentication
- API keys hashed before storage (SHA256)
- Role-based access control (RBAC)
- Rate limiting per API key
- CORS configuration
- Helmet.js security headers
- Input validation with Zod

### 5. Maintainability
- TypeScript for type safety
- Consistent code structure
- Clear naming conventions
- Comprehensive documentation
- Error handling at all levels

## Data Flow

### Authentication Flow
```
User → Frontend → Google OAuth → Backend → JWT Token → Frontend → LocalStorage
```

### API Request Flow
```
Client → API Key → Rate Limiter → Auth Middleware → Controller → Service → Database → Response
```

### Latency Tracking Flow
```
Request Start → External API Call (tracked) → Internal Processing (tracked) → Total Time → Database
```

## Database Schema

### Core Models
- **User**: User accounts with Google OAuth
- **ApiKey**: API keys for developers
- **ApiUsage**: Request logs and analytics
- **ApiHealth**: Platform health monitoring
- **Subscription**: Payment provider agnostic
- **Feedback**: User feedback and bug reports
- **Rating**: User ratings for landing page

### Relationships
- User → ApiKey (1:N)
- User → ApiUsage (1:N)
- User → Subscription (1:1)
- User → Rating (1:1)
- ApiKey → ApiUsage (1:N)

### Indexes
- User: email, googleId
- ApiKey: key, userId
- ApiUsage: userId, apiKeyId, timestamp, platform, endpoint
- Rating: userId

## API Design

### RESTful Principles
- Resource-based URLs
- HTTP methods (GET, POST, PATCH, DELETE)
- Status codes (200, 201, 400, 401, 403, 404, 500)
- JSON responses

### Response Format
```json
{
  "success": true,
  "data": { ... },
  "message": "Optional message"
}
```

### Error Format
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message"
  }
}
```

## Performance Optimizations

### Frontend
- Next.js App Router for optimal performance
- Server-side rendering (SSR) where beneficial
- Client-side caching
- Lazy loading components
- Image optimization
- Code splitting

### Backend
- Redis caching for rate limits
- Database query optimization
- Pagination on all lists
- Efficient aggregations
- Connection pooling

### Database
- Indexed fields for fast queries
- Aggregation pipelines
- Efficient data models

## Monitoring & Observability

### Metrics Tracked
- **Latency**: Total, external, internal processing time
- **Success Rate**: Per platform, per endpoint
- **Error Rate**: Overall and by endpoint
- **Usage**: Requests per user, per platform
- **Health**: API availability and performance

### Logging
- Winston logger with multiple transports
- Log levels: error, warn, info, http, debug
- Structured logging for easy parsing
- Request/response logging

## Security Measures

### Authentication
- Google OAuth 2.0 for user authentication
- JWT tokens with expiration
- Refresh token mechanism
- Secure token storage

### Authorization
- Role-based access control (USER, ADMIN)
- API key authentication for API endpoints
- Middleware-based protection

### Data Protection
- API keys hashed before storage
- Environment variables for secrets
- HTTPS in production
- CORS configuration
- Rate limiting to prevent abuse

## Deployment

### Development
```bash
npm run dev          # All services
npm run dev:api      # Backend only
npm run dev:web      # Frontend only
```

### Production (Vercel)
- Separate deployments for frontend and backend
- Environment variables configured in Vercel
- Automatic deployments on git push
- Preview deployments for PRs

### Docker
```bash
docker-compose up -d  # Start all services
docker-compose down   # Stop all services
```

## Testing Strategy

### Unit Tests
- Test individual functions and utilities
- Mock external dependencies
- Use Vitest for testing

### Integration Tests
- Test API endpoints
- Test database operations
- Use Supertest for HTTP testing

### E2E Tests (Future)
- Test complete user flows
- Use Playwright or Cypress

## Future Enhancements

### Technical
- [ ] WebSocket support for real-time updates
- [ ] GraphQL API option
- [ ] Microservices architecture
- [ ] Kubernetes deployment
- [ ] CI/CD pipeline
- [ ] Automated testing
- [ ] Performance monitoring (Sentry, DataDog)

### Features
- [ ] Webhook support
- [ ] API versioning
- [ ] Custom rate limits per user
- [ ] Advanced analytics dashboard
- [ ] Email notifications
- [ ] Two-factor authentication
- [ ] API usage alerts
- [ ] Export data to CSV/Excel

## Best Practices

### Code Style
- Use TypeScript strict mode
- Follow ESLint rules
- Use Prettier for formatting
- Write self-documenting code
- Add comments for complex logic

### Git Workflow
- Feature branches
- Descriptive commit messages
- Pull request reviews
- Semantic versioning

### Documentation
- Keep README up to date
- Document API endpoints
- Add inline code comments
- Maintain architecture docs

## Conclusion

NICE-API'HUB is built with modern best practices, focusing on scalability, maintainability, and security. The architecture supports rapid feature development while maintaining code quality and performance.

---

**Author**: NICE-DEV  
**Last Updated**: January 2026
