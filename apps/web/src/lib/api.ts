/**
 * API Client
 * Author: NICE-DEV
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: { message: string; code: string };
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private getToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('accessToken');
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const token = this.getToken();
    
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    };

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Request failed');
      }

      return data;
    } catch (error: any) {
      return {
        success: false,
        error: { message: error.message, code: 'REQUEST_FAILED' },
      };
    }
  }

  // Auth
  async getMe() {
    return this.request('/auth/me');
  }

  // User
  async getProfile() {
    return this.request('/user/profile');
  }

  async getUsageStats() {
    return this.request('/user/usage');
  }

  async getUsageHistory(params?: { page?: number; limit?: number }) {
    const query = new URLSearchParams(params as any).toString();
    return this.request(`/user/usage/history?${query}`);
  }

  // API Keys
  async getApiKeys() {
    return this.request('/api-keys');
  }

  async createApiKey(data: { name: string; environment?: string }) {
    return this.request('/api-keys', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteApiKey(id: string) {
    return this.request(`/api-keys/${id}`, { method: 'DELETE' });
  }

  async revokeApiKey(id: string) {
    return this.request(`/api-keys/${id}/revoke`, { method: 'POST' });
  }

  // Admin
  async getAdminDashboard() {
    return this.request('/admin/dashboard');
  }

  async getAdminUsers(params?: { page?: number; search?: string }) {
    const query = new URLSearchParams(params as any).toString();
    return this.request(`/admin/users?${query}`);
  }

  async getAdminAnalytics(period?: string) {
    return this.request(`/admin/analytics/overview?period=${period || '7d'}`);
  }

  async getAdminPlatforms() {
    return this.request('/admin/analytics/platforms');
  }

  async getAdminLatency() {
    return this.request('/admin/monitoring/latency');
  }

  async getAdminHealth() {
    return this.request('/admin/monitoring/health');
  }

  async getAdminLogs(params?: { page?: number; platform?: string }) {
    const query = new URLSearchParams(params as any).toString();
    return this.request(`/admin/logs?${query}`);
  }

  async suspendUser(id: string) {
    return this.request(`/admin/users/${id}/suspend`, { method: 'POST' });
  }

  async activateUser(id: string) {
    return this.request(`/admin/users/${id}/activate`, { method: 'POST' });
  }
}

export const api = new ApiClient(API_URL);
export default api;
