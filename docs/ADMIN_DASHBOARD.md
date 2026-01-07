# Admin Dashboard Documentation
**Author: NICE-DEV**

## Overview

The NICE-API'HUB admin dashboard provides comprehensive management and monitoring capabilities for platform administrators.

## Access

1. Set your account as admin using the script:
   ```bash
   cd apps/api
   npx tsx scripts/set-admin.ts your-email@example.com
   ```

2. Login to the platform and access the admin panel from the sidebar (visible only to admin users)

## Admin Pages

### 1. Overview (`/admin`)
Main dashboard with key metrics:
- Total users and active users
- Requests today and total requests
- Average latency
- Error rate
- Top 5 most used platforms

### 2. Users Management (`/admin/users`)
Complete user management interface:
- View all users with pagination
- Search by name or email
- Filter by plan (FREE, BASIC, PRO, ENTERPRISE)
- Filter by status (active/suspended)
- Suspend/activate user accounts
- Delete users
- View user statistics (API keys count, total requests)
- Responsive design (table on desktop, cards on mobile)

### 3. Analytics (`/admin/analytics`)
Detailed usage analytics with charts:
- Overview stats (total requests, success rate, avg latency, unique users)
- Period selector (24h, 7d, 30d)
- Platform distribution (pie chart)
- Requests by platform (bar chart)
- Latency by platform (bar chart)
- Success rate by platform (bar chart)
- Detailed platform statistics table

### 4. Monitoring (`/admin/monitoring`)
Real-time platform monitoring:
- Latency metrics (avg, P50, P95, P99)
- Total vs external latency comparison
- Internal processing time analysis
- API health status for all platforms
- Error metrics and recent errors
- Auto-refresh every 30 seconds

### 5. Feedbacks (`/admin/feedbacks`)
User feedback management:
- View all user feedbacks
- Filter by type (BUG, FEATURE, IMPROVEMENT, OTHER)
- Filter by status (PENDING, REVIEWED, IN_PROGRESS, RESOLVED, CLOSED)
- Update feedback status
- Statistics overview

### 6. Ratings (`/admin/ratings`)
User ratings moderation:
- View all user ratings
- Approve/reject ratings for landing page display
- Delete inappropriate ratings
- View average score
- Statistics overview

## API Endpoints

All admin endpoints require authentication and admin role.

### Dashboard
- `GET /admin/dashboard` - Get overview statistics

### Users
- `GET /admin/users` - List all users (with pagination, search, filters)
- `GET /admin/users/:id` - Get user details
- `PATCH /admin/users/:id` - Update user (plan, role)
- `DELETE /admin/users/:id` - Delete user
- `POST /admin/users/:id/suspend` - Suspend user
- `POST /admin/users/:id/activate` - Activate user

### Analytics
- `GET /admin/analytics/overview?period=7d` - Get analytics overview
- `GET /admin/analytics/usage` - Get usage analytics
- `GET /admin/analytics/platforms` - Get platform analytics
- `GET /admin/analytics/geographic` - Get geographic analytics

### Monitoring
- `GET /admin/monitoring/latency` - Get latency metrics
- `GET /admin/monitoring/health` - Get API health status
- `GET /admin/monitoring/errors` - Get error metrics

### Logs
- `GET /admin/logs` - Get API usage logs (with pagination, filters)
- `GET /admin/logs/realtime` - Get realtime logs (SSE)

### Feedbacks
- `GET /feedback/admin` - Get all feedbacks
- `GET /feedback/admin/stats` - Get feedback statistics
- `PATCH /feedback/admin/:id` - Update feedback status

### Ratings
- `GET /ratings/admin` - Get all ratings
- `PATCH /ratings/admin/:id` - Approve/reject rating
- `DELETE /ratings/admin/:id` - Delete rating

## Architecture

### Frontend Structure
```
apps/web/src/
├── app/(dashboard)/admin/
│   ├── page.tsx              # Overview
│   ├── users/page.tsx        # Users management
│   ├── analytics/page.tsx    # Analytics with charts
│   ├── monitoring/page.tsx   # Monitoring dashboard
│   ├── feedbacks/page.tsx    # Feedbacks management
│   └── ratings/page.tsx      # Ratings management
└── components/
    └── AdminLayout.tsx       # Admin layout with sidebar
```

### Backend Structure
```
apps/api/src/modules/
├── admin/
│   ├── admin.routes.ts       # Admin routes
│   └── admin.controller.ts   # Admin controllers
├── feedback/
│   ├── feedback.routes.ts
│   └── feedback.controller.ts
└── rating/
    ├── rating.routes.ts
    └── rating.controller.ts
```

## Features

### Responsive Design
- Desktop: Full tables and charts
- Tablet: Optimized layouts
- Mobile: Card-based views, collapsible menus

### Real-time Updates
- Monitoring page auto-refreshes every 30 seconds
- Manual refresh available on all pages

### Data Visualization
- Charts powered by Recharts library
- Pie charts for distribution
- Bar charts for comparisons
- Line charts for trends

### Professional Metrics
- Latency tracking (total, external, internal)
- Success rates
- Error tracking
- Geographic analytics
- Platform-specific metrics

## Security

- All admin routes protected by `requireAuth` and `requireAdmin` middleware
- JWT token validation
- Role-based access control (RBAC)
- Only users with `role: ADMIN` can access admin panel

## Performance

- Pagination on all list views
- Efficient database queries with Prisma
- Indexed fields for fast searches
- Aggregated statistics for quick loading

## Scalability

- Modular architecture
- Separate pages for each concern
- Reusable components
- Clean separation of concerns
- Easy to extend with new features

## Dependencies Updated

All dependencies have been updated to latest versions:
- Next.js: 15.1.3
- React: 19.0.0
- Recharts: 2.15.0
- TypeScript: 5.7.2
- Prisma: 6.2.1
- Express: 4.21.2
- And more...

## Future Enhancements

Potential additions:
- Export data to CSV/Excel
- Advanced filtering and sorting
- Bulk operations
- Email notifications for critical events
- Webhook management
- API rate limit configuration UI
- Custom dashboard widgets
- Dark mode support
