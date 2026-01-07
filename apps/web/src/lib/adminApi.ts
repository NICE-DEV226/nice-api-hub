/**
 * Admin API Helper - Includes admin session token in requests
 * Author: NICE-DEV
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export async function adminFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem('accessToken');
  const adminToken = localStorage.getItem('adminSessionToken');

  if (!token) {
    throw new Error('Not authenticated');
  }

  if (!adminToken) {
    throw new Error('Admin session required');
  }

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Admin-Token': adminToken,
    ...options.headers,
  };

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  });

  // If admin session expired, redirect to re-authenticate
  if (response.status === 401) {
    const data = await response.json();
    if (data.error?.code === 'ADMIN_SESSION_EXPIRED' || data.error?.code === 'ADMIN_SESSION_REQUIRED') {
      localStorage.removeItem('adminSessionToken');
      window.location.reload();
    }
  }

  return response;
}

export async function adminGet(endpoint: string): Promise<any> {
  const res = await adminFetch(endpoint, { method: 'GET' });
  return res.json();
}

export async function adminPost(endpoint: string, body?: any): Promise<any> {
  const res = await adminFetch(endpoint, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

export async function adminPatch(endpoint: string, body?: any): Promise<any> {
  const res = await adminFetch(endpoint, {
    method: 'PATCH',
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

export async function adminDelete(endpoint: string): Promise<any> {
  const res = await adminFetch(endpoint, { method: 'DELETE' });
  return res.json();
}
