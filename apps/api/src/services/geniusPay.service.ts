/**
 * GeniusPay Payment Service
 * Integration with GeniusPay API for mobile money & card payments
 * Author: NICE-DEV
 */

import { logger } from '../utils/logger.js';
import crypto from 'crypto';

const GENIUSPAY_API_URL = 'https://pay.genius.ci/api/v1/merchant';
const API_KEY = process.env.GENIUSPAY_API_KEY || '';
const API_SECRET = process.env.GENIUSPAY_API_SECRET || '';
const WEBHOOK_SECRET = process.env.GENIUSPAY_WEBHOOK_SECRET || '';

interface CreatePaymentParams {
  amount: number;
  description: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  successUrl: string;
  errorUrl: string;
  metadata?: Record<string, any>;
}

interface PaymentResponse {
  success: boolean;
  data?: {
    id: number;
    reference: string;
    amount: number;
    currency: string;
    status: string;
    checkout_url: string;
    payment_url: string;
    environment: string;
    expires_at: string;
  };
  error?: string;
}

interface WebhookPayload {
  id: string;
  event: string;
  timestamp: number;
  created_at: string;
  data: {
    object: string;
    id: number;
    reference: string;
    amount: number;
    currency: string;
    fees: number;
    net_amount: number;
    status: string;
    payment_method: string;
    provider: string;
    customer_name: string;
    customer_phone: string;
    merchant_id: number;
    metadata: Record<string, any>;
  };
  environment: string;
  api_version: string;
}

/**
 * Create a payment and get checkout URL
 */
export async function createPayment(params: CreatePaymentParams): Promise<PaymentResponse> {
  try {
    const response = await fetch(`${GENIUSPAY_API_URL}/payments`, {
      method: 'POST',
      headers: {
        'X-API-Key': API_KEY,
        'X-API-Secret': API_SECRET,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: params.amount,
        currency: 'XOF',
        description: params.description,
        customer: {
          name: params.customerName,
          email: params.customerEmail,
          phone: params.customerPhone,
        },
        success_url: params.successUrl,
        error_url: params.errorUrl,
        metadata: params.metadata,
      }),
    });

    const data = await response.json() as { data?: PaymentResponse['data']; message?: string };

    if (!response.ok) {
      logger.error('[GeniusPay] Payment creation failed:', data);
      return { success: false, error: data.message || 'Payment creation failed' };
    }

    logger.info(`[GeniusPay] Payment created: ${data.data?.reference}`);
    return { success: true, data: data.data };
  } catch (error) {
    logger.error('[GeniusPay] Error creating payment:', error);
    return { success: false, error: 'Failed to connect to payment provider' };
  }
}

/**
 * Get payment details by reference
 */
export async function getPayment(reference: string): Promise<PaymentResponse> {
  try {
    const response = await fetch(`${GENIUSPAY_API_URL}/payments/${reference}`, {
      method: 'GET',
      headers: {
        'X-API-Key': API_KEY,
        'X-API-Secret': API_SECRET,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json() as { data?: PaymentResponse['data']; message?: string };

    if (!response.ok) {
      return { success: false, error: data.message || 'Payment not found' };
    }

    return { success: true, data: data.data };
  } catch (error) {
    logger.error('[GeniusPay] Error fetching payment:', error);
    return { success: false, error: 'Failed to fetch payment' };
  }
}

/**
 * Verify webhook signature
 */
export function verifyWebhookSignature(
  signature: string,
  timestamp: string,
  payload: any
): boolean {
  try {
    const data = timestamp + '.' + JSON.stringify(payload);
    const expectedSignature = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(data)
      .digest('hex');

    // Timing-safe comparison
    if (!crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    )) {
      return false;
    }

    // Check timestamp (5 minutes tolerance)
    const timestampNum = parseInt(timestamp, 10);
    if (Math.abs(Date.now() / 1000 - timestampNum) > 300) {
      logger.warn('[GeniusPay] Webhook timestamp too old');
      return false;
    }

    return true;
  } catch (error) {
    logger.error('[GeniusPay] Webhook signature verification failed:', error);
    return false;
  }
}

/**
 * Parse webhook payload
 */
export function parseWebhookPayload(body: any): WebhookPayload | null {
  try {
    return body as WebhookPayload;
  } catch {
    return null;
  }
}

/**
 * Get account balance
 */
export async function getAccountBalance() {
  try {
    const response = await fetch(`${GENIUSPAY_API_URL}/account/balance`, {
      method: 'GET',
      headers: {
        'X-API-Key': API_KEY,
        'X-API-Secret': API_SECRET,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json() as { success?: boolean; data?: unknown };
    return data.success ? data.data : null;
  } catch (error) {
    logger.error('[GeniusPay] Error fetching balance:', error);
    return null;
  }
}
