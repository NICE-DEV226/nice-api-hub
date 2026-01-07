# Changelog

All notable changes to NICE-API'HUB will be documented in this file.

**Author**: NICE-DEV

## [1.2.0] - 2026-01-07

### 🎉 New Features

#### Payment Integration (GeniusPay)
- Complete payment system with GeniusPay integration
- Support for Mobile Money (Orange, MTN, Moov, Wave) and Cards (Visa, Mastercard)
- Subscription management with automatic expiration handling
- Payment success/error pages
- Webhook handling with idempotency protection
- Plan upgrade/downgrade functionality

#### Enhanced Security
- Webhook signature verification (HMAC-SHA256)
- Timestamp validation (anti-replay attacks)
- Idempotency protection for webhooks
- Transaction-safe database operations

#### Subscription Management
- Automatic subscription expiration checker (hourly)
- Cancel subscription at period end
- Plan change history tracking
- Subscription status endpoint

#### Admin Improvements
- Subscriptions management page
- Subscription statistics
- Payment history view

### 🔧 Technical Improvements

- Added `subscriptionManager.service.ts` for background subscription tasks
- Improved error handling in payment flows
- Better TypeScript types for Express requests
- Updated docker-compose with health checks and production config

### 📚 Documentation

- Updated README with professional layout and logo
- Added docker-compose.prod.yml for production deployments
- Improved .gitignore with comprehensive exclusions

---

## [1.1.0] - 2026-01-06

### 🎉 Major Features

#### Comprehensive Admin Dashboard
Complete redesign of the admin panel with 6 dedicated pages:

1. **Overview Dashboard** (`/admin`)
   - Total users and active users statistics
   - Requests today and total requests
   - Average latency monitoring
   - Error rate tracking
   - Top 5 most used platforms with visual bars

2. **Users Management** (`/admin/users`)
   - Search users by name or email
   - Filter by plan (FREE, BASIC, PRO, ENTERPRISE)
   - Filter by status (active/suspended)
   - Suspend/activate user accounts
   - Delete users
   - View detailed user statistics (API keys, total requests)
   - Responsive design (table on desktop, cards on mobile)

3. **Analytics Dashboard** (`/admin/analytics`)
   - Period selector (24h, 7d, 30d)
   - Platform distribution pie chart
   - Requests by platform bar chart
   - Latency by platform bar chart
   - Success rate by platform bar chart
   - Detailed platform statistics table

4. **Monitoring Dashboard** (`/admin/monitoring`)
   - Latency metrics (Average, P50, P95, P99)
   - Total vs external latency comparison charts
   - Internal processing time analysis
   - API health status for all platforms
   - Error metrics and recent errors
   - Auto-refresh every 30 seconds

5. **Feedbacks Management** (`/admin/feedbacks`)
   - Filter by type (BUG, FEATURE, IMPROVEMENT, OTHER)
   - Filter by status (PENDING, REVIEWED, IN_PROGRESS, RESOLVED, CLOSED)
   - Update feedback status
   - Statistics overview (total, pending, in progress, resolved)

6. **Ratings Management** (`/admin/ratings`)
   - Filter by approval status
   - Approve/reject ratings for landing page display
   - Delete inappropriate ratings
   - Statistics overview (total, average score, approved, pending)

### 📦 Dependencies Updated

#### Root
- turbo: 2.0.0 → 2.3.0
- typescript: 5.3.0 → 5.7.2

#### Backend (apps/api)
- @prisma/client: 5.22.0 → 6.2.1
- prisma: 5.22.0 → 6.2.1
- axios: 1.6.8 → 1.7.9
- cheerio: 1.0.0-rc.12 → 1.0.0
- express: 4.18.2 → 4.21.2
- express-rate-limit: 7.1.5 → 7.5.0
- helmet: 7.1.0 → 8.0.0
- ioredis: 5.3.2 → 5.4.2
- qs: 6.11.2 → 6.13.1
- uuid: 9.0.1 → 11.0.3
- winston: 3.11.0 → 3.17.0
- zod: 3.22.4 → 3.24.1
- @types/express: 4.17.21 → 5.0.0
- @types/node: 20.10.0 → 22.10.5
- @types/passport-google-oauth20: 2.0.14 → 2.0.16
- @types/uuid: 9.0.7 → 10.0.0
- supertest: 6.3.3 → 7.0.0
- tsx: 4.6.2 → 4.19.2
- vitest: 1.0.4 → 2.1.8

#### Frontend (apps/web)
- next: 14.0.4 → 15.1.3
- react: 18.2.0 → 19.0.0
- react-dom: 18.2.0 → 19.0.0
- @radix-ui/react-avatar: 1.0.4 → 1.1.2
- @radix-ui/react-dialog: 1.0.5 → 1.1.4
- @radix-ui/react-dropdown-menu: 2.0.6 → 2.1.4
- @radix-ui/react-label: 2.0.2 → 2.1.1
- @radix-ui/react-select: 2.0.0 → 2.1.4
- @radix-ui/react-slot: 1.0.2 → 1.1.1
- @radix-ui/react-tabs: 1.0.4 → 1.1.2
- @radix-ui/react-toast: 1.1.5 → 1.2.4
- class-variance-authority: 0.7.0 → 0.7.1
- clsx: 2.0.0 → 2.1.1
- framer-motion: 10.16.16 → 11.15.0
- lucide-react: 0.303.0 → 0.469.0
- recharts: 2.10.3 → 2.15.0
- tailwind-merge: 2.2.0 → 2.6.0
- @types/node: 20.10.0 → 22.10.5
- @types/react: 18.2.45 → 19.0.6
- @types/react-dom: 18.2.18 → 19.0.2
- autoprefixer: 10.4.16 → 10.4.20
- postcss: 8.4.32 → 8.4.49
- tailwindcss: 3.4.0 → 3.4.17

### 📚 Documentation

#### New Documentation Files
- `docs/ADMIN_DASHBOARD.md` - Complete admin dashboard documentation
- `docs/ARCHITECTURE.md` - Comprehensive architecture documentation
- `docs/MIGRATION_ADMIN.md` - Migration guide for admin dashboard
- `CHANGELOG.md` - This file

#### Updated Documentation
- `README.md` - Added admin dashboard information and updated features list

### 🎨 UI/UX Improvements

- **AdminLayout Component**: New sidebar layout for admin pages
- **Responsive Design**: All admin pages work perfectly on mobile, tablet, and desktop
- **Charts Integration**: Professional charts using Recharts library
- **Auto-refresh**: Monitoring page updates automatically every 30 seconds
- **Visual Feedback**: Loading states, empty states, and error states
- **Color-coded Status**: Visual indicators for health, status, and metrics

### 🏗️ Architecture Improvements

- **Modular Structure**: Each admin feature in its own page
- **Scalable Design**: Easy to add new admin features
- **Clean Separation**: Clear boundaries between concerns
- **Maintainable Code**: Consistent patterns and naming conventions
- **Type Safety**: Full TypeScript coverage

### 🔧 Technical Improvements

- **Performance**: Separate pages load faster with less data per page
- **Code Splitting**: Better bundle optimization
- **Efficient Queries**: Optimized database queries with proper indexing
- **Caching**: Smart data fetching and caching strategies

### 🔒 Security

- No security changes (existing security measures maintained)
- All admin routes protected by `requireAuth` and `requireAdmin` middleware
- Role-based access control (RBAC) enforced

### 🐛 Bug Fixes

- None (this is a feature release)

### ⚠️ Breaking Changes

- None (fully backward compatible)

### 📝 Notes

- All existing API endpoints remain unchanged
- Database schema unchanged
- No migration required for existing installations
- Simply pull latest code and run `npm install`

---

## [1.0.0] - 2025-12-XX

### Initial Release

- 20+ platform support for media downloading
- Google OAuth authentication
- API key management
- Rate limiting
- Professional latency tracking
- User dashboard
- Basic admin page
- Feedback system
- Rating system
- Documentation page
- Pricing page
- Landing page with testimonials

---

**Author**: NICE-DEV  
**Repository**: https://github.com/nice-dev/nice-api-hub
