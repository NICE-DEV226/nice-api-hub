/**
 * TypeScript type definitions
 * Author: NICE-DEV
 */

// API Response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code: string;
    stack?: string;
  };
}

// Download response types
export interface DownloadItem {
  text: string;
  url: string;
  quality?: string;
  format?: string;
}

export interface BaseDownloadData {
  title: string | null;
  thumbnail: string | null;
}

export interface TikTokDownloadData extends BaseDownloadData {
  status: string;
  downloads: DownloadItem[];
}

export interface YouTubeFormat {
  type: string;
  quality: string;
  extension: string;
  url: string;
}

export interface YouTubeDownloadData extends BaseDownloadData {
  duration: number;
  formats: YouTubeFormat[];
}

// User types
export interface UserInfo {
  id: string;
  email: string;
  name: string;
  role: 'USER' | 'ADMIN';
  plan: 'FREE' | 'BASIC' | 'PRO' | 'ENTERPRISE';
}

// API Key types
export interface ApiKeyInfo {
  id: string;
  userId: string;
  name: string;
  environment: 'DEVELOPMENT' | 'PRODUCTION';
  permissions: string[];
}

// Latency data
export interface LatencyData {
  total: number;
  external: number;
  internal: number;
}

// Analytics types
export interface UsageStats {
  totalRequests: number;
  requestsToday: number;
  requestsThisMonth: number;
  remainingQuota: number;
}

export interface PlatformStats {
  platform: string;
  requests: number;
  successRate: number;
  avgLatency: number;
}

export interface LatencyMetrics {
  avg: number;
  p50: number;
  p95: number;
  p99: number;
}

// Pagination
export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
